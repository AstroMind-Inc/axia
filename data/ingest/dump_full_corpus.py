"""Dump every collection used by Axia from a source MongoDB into gzipped JSONL.

Used by the paper authors to extract the full 51 450-source corpus from the
production Atlas cluster ahead of publishing it on Hugging Face Datasets.
End users do not need to run this — they will instead use the (forthcoming)
`load_from_huggingface.py` script.

Output layout:

    <out>/
      sources.jsonl.gz              # filedata.51k_v2_shuffled (corpus)
      raw_events.jsonl.gz           # filedata.raw_events       (full catalog)
      metadata_records.json         # metadata.metadata_records (registry)
      atlas_indexes/
        pca_64_vector_search.json   # vector-search index definition
      manifest.json                 # counts, byte sizes, sha256, provenance

Each JSONL file has one source document per line, with the following
sanitisation applied:

  - ObjectId -> str
  - datetime -> ISO-8601 str
  - float('nan'), float('inf'), float('-inf') -> null
  - qna / extended_qna fields dropped by default (training-only;
    add --include-qna to keep them)

Usage:

    MONGODB_URI=mongodb+srv://... python dump_full_corpus.py
    MONGODB_URI=mongodb+srv://... python dump_full_corpus.py --limit 100
    MONGODB_URI=mongodb+srv://... python dump_full_corpus.py --include-qna
    MONGODB_URI=mongodb+srv://... python dump_full_corpus.py \
        --collections sources --out /tmp/axia-dump

Env vars:
    MONGODB_URI                    (required) connection string
    ATLAS_SOURCE_DB                default: filedata
    ATLAS_SOURCES_COLLECTION       default: 51k_v2_shuffled
    ATLAS_RAW_EVENTS_COLLECTION    default: raw_events
    ATLAS_METADATA_DB              default: metadata
    ATLAS_METADATA_COLLECTION      default: metadata_records
"""

from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import math
import os
import shutil
import sys
import time
from datetime import datetime
from pathlib import Path
from typing import Any, Iterable

from bson import ObjectId
from pymongo import MongoClient
from pymongo.collection import Collection

try:
    from tqdm import tqdm
except ImportError:  # tqdm is optional
    def tqdm(iterable, **_kwargs):  # type: ignore
        return iterable


# ---------------------------------------------------------------------------
# Sanitisation
# ---------------------------------------------------------------------------

TRAINING_ONLY_FIELDS = ("qna", "extended_qna")


def _clean(value: Any) -> Any:
    """Recursively convert BSON-only types into JSON-friendly values."""
    if isinstance(value, ObjectId):
        return str(value)
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, float):
        if math.isnan(value) or math.isinf(value):
            return None
        return value
    if isinstance(value, list):
        return [_clean(v) for v in value]
    if isinstance(value, dict):
        return {k: _clean(v) for k, v in value.items()}
    return value


def _strip_training_fields(doc: dict) -> dict:
    for k in TRAINING_ONLY_FIELDS:
        doc.pop(k, None)
    return doc


# ---------------------------------------------------------------------------
# Streaming JSONL writer
# ---------------------------------------------------------------------------

class JsonlGzipWriter:
    """Streaming JSONL.gz writer with running byte-count + sha256."""

    def __init__(self, path: Path) -> None:
        self._path = path
        self._raw_bytes = 0
        self._gz = gzip.open(path, "wt", encoding="utf-8", compresslevel=6)
        self._sha = hashlib.sha256()
        self._n = 0

    def write(self, doc: dict) -> None:
        line = json.dumps(doc, separators=(",", ":"), ensure_ascii=False)
        self._raw_bytes += len(line.encode("utf-8")) + 1
        self._sha.update(line.encode("utf-8"))
        self._sha.update(b"\n")
        self._gz.write(line + "\n")
        self._n += 1

    def close(self) -> dict:
        self._gz.close()
        return {
            "path": str(self._path.name),
            "n_docs": self._n,
            "uncompressed_bytes": self._raw_bytes,
            "compressed_bytes": self._path.stat().st_size,
            "sha256_uncompressed": self._sha.hexdigest(),
        }


# ---------------------------------------------------------------------------
# Per-collection dump
# ---------------------------------------------------------------------------

def _dump_collection(
    coll: Collection,
    out_path: Path,
    *,
    limit: int | None,
    include_training: bool,
    label: str,
) -> dict:
    print(f"\n[{label}] estimated {coll.estimated_document_count():,} docs in {coll.full_name}")
    writer = JsonlGzipWriter(out_path)
    cursor = coll.find({}, batch_size=200, no_cursor_timeout=False)
    if limit:
        cursor = cursor.limit(limit)
    started = time.time()
    try:
        iterator = tqdm(cursor, desc=label, unit="docs", smoothing=0.05)
        for raw in iterator:
            doc = _clean(raw)
            if not include_training:
                doc = _strip_training_fields(doc)
            writer.write(doc)
    finally:
        cursor.close()
    stats = writer.close()
    elapsed = time.time() - started
    print(
        f"[{label}] wrote {stats['n_docs']:,} docs in {elapsed:.1f}s -> "
        f"{out_path.name} ({stats['compressed_bytes'] / 1e6:.1f} MB compressed, "
        f"{stats['uncompressed_bytes'] / 1e6:.1f} MB raw)"
    )
    return stats


def _dump_metadata(coll: Collection, out_path: Path) -> dict:
    docs = [_clean(d) for d in coll.find({})]
    out_path.write_text(json.dumps(docs, indent=2, ensure_ascii=False))
    return {
        "path": str(out_path.name),
        "n_docs": len(docs),
        "uncompressed_bytes": out_path.stat().st_size,
        "compressed_bytes": out_path.stat().st_size,
        "sha256_uncompressed": hashlib.sha256(out_path.read_bytes()).hexdigest(),
    }


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main() -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument(
        "--out",
        type=Path,
        default=Path(__file__).resolve().parents[1] / "full_corpus" / "dump",
        help="Output directory (default: data/full_corpus/dump/)",
    )
    p.add_argument(
        "--collections",
        default="sources,raw_events,metadata",
        help="Comma-separated subset to dump: sources,raw_events,metadata",
    )
    p.add_argument(
        "--limit",
        type=int,
        default=None,
        help="Limit docs per collection (for testing). Default: dump everything.",
    )
    p.add_argument(
        "--include-qna",
        action="store_true",
        help="Keep the qna / extended_qna fields (training-only; doubles the size).",
    )
    p.add_argument(
        "--overwrite",
        action="store_true",
        help="If the output dir exists, wipe and recreate it.",
    )
    args = p.parse_args()

    uri = os.environ.get("MONGODB_URI")
    if not uri:
        sys.exit("ERROR: MONGODB_URI is not set in the environment.")

    src_db = os.environ.get("ATLAS_SOURCE_DB", "filedata")
    src_col = os.environ.get("ATLAS_SOURCES_COLLECTION", "51k_v2_shuffled")
    raw_col = os.environ.get("ATLAS_RAW_EVENTS_COLLECTION", "raw_events")
    meta_db = os.environ.get("ATLAS_METADATA_DB", "metadata")
    meta_col = os.environ.get("ATLAS_METADATA_COLLECTION", "metadata_records")

    wanted = {s.strip() for s in args.collections.split(",") if s.strip()}
    unknown = wanted - {"sources", "raw_events", "metadata"}
    if unknown:
        sys.exit(f"ERROR: unknown collection(s) in --collections: {sorted(unknown)}")

    out_dir: Path = args.out
    if out_dir.exists():
        if args.overwrite:
            print(f"--overwrite given; wiping {out_dir}")
            shutil.rmtree(out_dir)
        else:
            print(f"NOTE: {out_dir} already exists; new files will overwrite same-named ones.")
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "atlas_indexes").mkdir(parents=True, exist_ok=True)

    print(f"Connecting to {uri.split('@')[-1].split('/')[0]} ...")
    client = MongoClient(uri, serverSelectionTimeoutMS=20000)
    client.admin.command("ping")
    print("Connected.")

    manifest_collections: dict[str, dict] = {}

    if "sources" in wanted:
        manifest_collections["sources"] = _dump_collection(
            client[src_db][src_col],
            out_dir / "sources.jsonl.gz",
            limit=args.limit,
            include_training=args.include_qna,
            label="sources",
        )

    if "raw_events" in wanted:
        manifest_collections["raw_events"] = _dump_collection(
            client[src_db][raw_col],
            out_dir / "raw_events.jsonl.gz",
            limit=args.limit,
            include_training=False,  # raw_events doesn't carry qna fields
            label="raw_events",
        )

    if "metadata" in wanted:
        manifest_collections["metadata_records"] = _dump_metadata(
            client[meta_db][meta_col],
            out_dir / "metadata_records.json",
        )

    # Copy the Atlas vector-search index definition next to the data so the
    # downstream loader has it together.
    repo_root = Path(__file__).resolve().parents[2]
    src_index = repo_root / "data" / "atlas_indexes" / "pca_64_vector_search.json"
    if src_index.exists():
        dst_index = out_dir / "atlas_indexes" / "pca_64_vector_search.json"
        shutil.copyfile(src_index, dst_index)

    manifest = {
        "produced_at": datetime.utcnow().isoformat() + "Z",
        "source": {
            "cluster": uri.split("@")[-1].split("/")[0],
            "databases": {"corpus": src_db, "metadata": meta_db},
            "collections": {
                "sources": src_col,
                "raw_events": raw_col,
                "metadata_records": meta_col,
            },
        },
        "limit": args.limit,
        "include_qna": args.include_qna,
        "files": manifest_collections,
        "schema_notes": {
            "sources": (
                "Per-source corpus documents. Key fields: obsid (int), "
                "source_name (str), source_type, source_type_category, "
                "event_list (List[[t_s, energy_eV]], pruned 8h window, 0.5-8 keV), "
                "pca_64d (List[float], len=64, the embedding indexed by Atlas Vector Search), "
                "umap_2d (List[float], len=2), and standard CSC spectral-fit + "
                "hardness fields. qna / extended_qna stripped unless --include-qna."
            ),
            "raw_events": (
                "Full catalog metadata + the ORIGINAL unpruned event_list "
                "(matches sources by (obsid, source_name)). Includes ra, dec, "
                "theta, fluxes, var_*, spectral-fit stats and params."
            ),
            "metadata_records": (
                "Small dataset-registry collection used by the webapp's "
                "/api/datasets endpoint to enumerate available collections."
            ),
        },
    }
    (out_dir / "manifest.json").write_text(json.dumps(manifest, indent=2))
    print(f"\nWrote manifest.json. Dump complete in {out_dir}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
