"""Dump ONLY the training Q&A corpus from MongoDB into a standalone JSONL.gz.

Companion to `dump_full_corpus.py`. That script deliberately strips the
`qna` / `extended_qna` fields (they are training-only and account for ~77%
of the corpus collection by size). This script dumps *just* those fields,
keyed by `(obsid, source_name)` so they can be joined back onto the
published corpus without re-uploading it.

Output layout:

    data/full_corpus/qna/
      qna.jsonl.gz        one {obsid, source_name, qna, extended_qna} per line
      manifest.json       counts, sha256 of the uncompressed bytes, provenance

Usage:

    MONGODB_URI="mongodb+srv://..." python data/ingest/dump_qna.py
    MONGODB_URI="..." python data/ingest/dump_qna.py --limit 500   # smoke test

Required env:
    MONGODB_URI

Optional flags:
    --db / --collection    source db + collection (defaults match the paper dump)
    --out                  output directory
    --limit N              only dump the first N docs (smoke test)
    --overwrite            wipe the output dir first
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
from datetime import datetime
from pathlib import Path
from typing import Any

from bson import ObjectId
from pymongo import MongoClient

try:
    from tqdm import tqdm
except ImportError:  # tqdm is optional
    def tqdm(iterable, **_kwargs):  # type: ignore
        return iterable


DEFAULT_DB = "filedata"
DEFAULT_COLLECTION = "51k_v2_shuffled"
DEFAULT_OUT = Path(__file__).resolve().parents[1] / "full_corpus" / "qna"

# The join key back onto the published corpus, plus the Q&A payload itself.
KEY_FIELDS = ("obsid", "source_name")
QNA_FIELDS = ("qna", "extended_qna")


def _clean(value: Any) -> Any:
    """Recursively convert BSON-only types into JSON-friendly values.

    Mirrors dump_full_corpus.py._clean so the two dumps stay byte-compatible.
    """
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


def main() -> int:
    p = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    p.add_argument("--db", default=DEFAULT_DB)
    p.add_argument("--collection", default=DEFAULT_COLLECTION)
    p.add_argument("--out", type=Path, default=DEFAULT_OUT)
    p.add_argument("--limit", type=int, default=None)
    p.add_argument("--overwrite", action="store_true")
    args = p.parse_args()

    uri = os.environ.get("MONGODB_URI")
    if not uri:
        sys.exit("ERROR: MONGODB_URI env var is not set.")

    out_dir: Path = args.out
    if out_dir.exists() and args.overwrite:
        shutil.rmtree(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    client = MongoClient(uri, serverSelectionTimeoutMS=60000)
    col = client[args.db][args.collection]

    total = col.estimated_document_count() if args.limit is None else args.limit
    print(f"Dumping Q&A from {args.db}.{args.collection} ({total:,} docs expected)")

    projection = {f: 1 for f in KEY_FIELDS + QNA_FIELDS}
    projection["_id"] = 0

    cursor = col.find({}, projection).batch_size(50)
    if args.limit:
        cursor = cursor.limit(args.limit)

    writer = JsonlGzipWriter(out_dir / "qna.jsonl.gz")
    n_qna = n_ext = 0
    items_qna = items_ext = 0
    skipped = 0

    for doc in tqdm(cursor, total=total, unit="doc"):
        qna = doc.get("qna") or []
        ext = doc.get("extended_qna") or []
        if not qna and not ext:
            skipped += 1
            continue

        rec: dict[str, Any] = {k: _clean(doc.get(k)) for k in KEY_FIELDS}
        if qna:
            rec["qna"] = _clean(qna)
            n_qna += 1
            items_qna += len(qna)
        if ext:
            rec["extended_qna"] = _clean(ext)
            n_ext += 1
            items_ext += len(ext)
        writer.write(rec)

    stats = writer.close()
    client.close()

    manifest = {
        "produced_at": datetime.utcnow().isoformat() + "Z",
        "source": {
            "database": args.db,
            "collection": args.collection,
        },
        "limit": args.limit,
        "files": {"qna": stats},
        "counts": {
            "docs_with_qna": n_qna,
            "docs_with_extended_qna": n_ext,
            "qna_items": items_qna,
            "extended_qna_chains": items_ext,
            "docs_skipped_no_qna": skipped,
        },
        "schema_notes": {
            "qna": (
                "Training-only Q&A corpus, one record per (obsid, source_name). "
                "Join onto data/corpus.jsonl.gz on that pair. 'qna' is a list of "
                "{question, answer, category, ...} objects; 'extended_qna' is a "
                "list of multi-turn chains (each chain a list of such objects). "
                "Either field is omitted when empty."
            )
        },
    }
    (out_dir / "manifest.json").write_text(json.dumps(manifest, indent=2))

    print(f"\nWrote {out_dir / 'qna.jsonl.gz'}")
    print(f"  docs written        : {stats['n_docs']:,}  (skipped {skipped:,} with no Q&A)")
    print(f"  qna items           : {items_qna:,}")
    print(f"  extended_qna chains : {items_ext:,}")
    print(f"  uncompressed        : {stats['uncompressed_bytes']/1e6:,.1f} MB")
    print(f"  compressed          : {stats['compressed_bytes']/1e6:,.1f} MB")
    print(f"  sha256(uncompressed): {stats['sha256_uncompressed']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
