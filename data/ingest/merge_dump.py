"""Merge a two-file Mongo dump (`sources.jsonl.gz` + `raw_events.jsonl.gz`)
into a single per-source corpus file (`corpus.jsonl.gz`).

The Mongo schema historically had two collections (51 450 corpus docs and
52 225 raw-events docs) that overlap on 28 catalog fields and joined cleanly
on (obsid, source_name). The values of the shared fields agree exactly
between the two sides; the only genuine difference is the `event_list`:

  sources.event_list      pruned to an 8 h window + 0.5-8 keV (model input)
  raw_events.event_list   the original full-observation list (snapshot input)

The merged record keeps both, using the field-name convention already in use
elsewhere in the codebase:

  event_list              <- sources.event_list           (pruned)
  original_event_list     <- raw_events.event_list        (unpruned)

The 775 raw_events docs that have no matching source (CSC observations the
v2 shuffle excluded from the 51 k corpus) are written to a separate
`extras_raw_events.jsonl.gz` so they're not silently dropped.

Usage:
    python merge_dump.py
    python merge_dump.py --in data/full_corpus/dump --out data/full_corpus/merged
"""

from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import sys
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, Iterator

try:
    from tqdm import tqdm
except ImportError:  # tqdm is optional
    def tqdm(iterable, **_kwargs):  # type: ignore
        return iterable


# ---------------------------------------------------------------------------
# JSONL helpers
# ---------------------------------------------------------------------------

def _iter_jsonl_gz(path: Path) -> Iterator[Dict[str, Any]]:
    with gzip.open(path, "rt", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            yield json.loads(line)


class JsonlGzipWriter:
    def __init__(self, path: Path) -> None:
        self._path = path
        self._gz = gzip.open(path, "wt", encoding="utf-8", compresslevel=6)
        self._sha = hashlib.sha256()
        self._n = 0
        self._raw_bytes = 0

    def write(self, doc: Dict[str, Any]) -> None:
        line = json.dumps(doc, separators=(",", ":"), ensure_ascii=False)
        encoded = (line + "\n").encode("utf-8")
        self._sha.update(encoded)
        self._raw_bytes += len(encoded)
        self._gz.write(line + "\n")
        self._n += 1

    def close(self) -> Dict[str, Any]:
        self._gz.close()
        return {
            "path": str(self._path.name),
            "n_docs": self._n,
            "uncompressed_bytes": self._raw_bytes,
            "compressed_bytes": self._path.stat().st_size,
            "sha256_uncompressed": self._sha.hexdigest(),
        }


# ---------------------------------------------------------------------------
# Merge
# ---------------------------------------------------------------------------

# Fields that only exist in raw_events but should be inherited into the
# merged corpus doc. The 16 unique fields catalogued in the comparison +
# `event_list` (which we rename to original_event_list).
RAW_ONLY_FIELDS = {
    "ra", "dec",
    "obi", "region_id",
    "gti_mjd_obs", "match_type", "significance",
    "src_cnts_aper_b", "flux_aper_b", "flux_bb_aper_b",
    "var_prob_b",
    "powerlaw_gamma_low", "powerlaw_gamma_high",
    "powlaw_gamma_lolim", "powlaw_gamma_hilim",
    "thermal_classification",
}


def merge_one(source_doc: Dict[str, Any], raw_doc: Dict[str, Any] | None) -> Dict[str, Any]:
    """Combine one source doc with its matching raw_events doc (if any).

    The source doc is the "primary" — its values win on every shared field
    (we verified they're identical anyway). raw_events contributes:
        - `ra`, `dec`, `obi`, `region_id`, photometry, uncertainty bounds, ...
        - `event_list` -> renamed to `original_event_list`
    """
    merged = dict(source_doc)
    # Pull in raw-only fields
    if raw_doc is not None:
        for k in RAW_ONLY_FIELDS:
            if k in raw_doc and raw_doc[k] is not None:
                merged[k] = raw_doc[k]
        # Rename the unpruned event_list
        if "event_list" in raw_doc:
            merged["original_event_list"] = raw_doc["event_list"]
    # Drop the duplicate _id from the raw side (we keep the sources' _id).
    return merged


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument(
        "--in",
        dest="in_dir",
        type=Path,
        default=Path(__file__).resolve().parents[1] / "full_corpus" / "dump",
        help="Directory containing sources.jsonl.gz + raw_events.jsonl.gz + metadata_records.json",
    )
    p.add_argument(
        "--out",
        dest="out_dir",
        type=Path,
        default=Path(__file__).resolve().parents[1] / "full_corpus" / "merged",
        help="Directory to write the merged corpus into",
    )
    args = p.parse_args()

    in_dir: Path = args.in_dir
    out_dir: Path = args.out_dir
    src_path = in_dir / "sources.jsonl.gz"
    raw_path = in_dir / "raw_events.jsonl.gz"
    meta_path = in_dir / "metadata_records.json"
    if not src_path.exists() or not raw_path.exists():
        sys.exit(f"ERROR: expected sources.jsonl.gz and raw_events.jsonl.gz under {in_dir}")

    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "atlas_indexes").mkdir(parents=True, exist_ok=True)

    # 1) Stream raw_events into a (obsid, source_name) -> doc map.
    print(f"Indexing {raw_path.name} by (obsid, source_name) ...")
    raw_by_key: Dict[tuple, Dict[str, Any]] = {}
    for doc in tqdm(_iter_jsonl_gz(raw_path), desc="raw_events", unit="docs"):
        key = (doc.get("obsid"), doc.get("source_name"))
        if key[0] is None or not key[1]:
            continue
        raw_by_key[key] = doc
    print(f"  indexed {len(raw_by_key):,} raw_events docs")

    # 2) Stream sources, merge each with the matching raw_events doc.
    print(f"\nMerging {src_path.name} ...")
    corpus_path = out_dir / "corpus.jsonl.gz"
    corpus_writer = JsonlGzipWriter(corpus_path)

    matched_keys: set = set()
    n_sources_unmatched = 0
    for src in tqdm(_iter_jsonl_gz(src_path), desc="sources", unit="docs"):
        key = (src.get("obsid"), src.get("source_name"))
        raw = raw_by_key.get(key)
        if raw is None:
            n_sources_unmatched += 1
        else:
            matched_keys.add(key)
        corpus_writer.write(merge_one(src, raw))
    corpus_stats = corpus_writer.close()
    print(
        f"  wrote {corpus_stats['n_docs']:,} merged corpus docs to {corpus_path.name} "
        f"({corpus_stats['compressed_bytes'] / 1e6:.1f} MB compressed)"
    )
    if n_sources_unmatched:
        print(f"  WARNING: {n_sources_unmatched:,} source docs had no raw_events match")

    # 3) Spill orphan raw_events (no source match) into a separate file.
    print(f"\nWriting orphan raw_events (no source match) ...")
    extras_path = out_dir / "extras_raw_events.jsonl.gz"
    extras_writer = JsonlGzipWriter(extras_path)
    for key, doc in tqdm(raw_by_key.items(), desc="extras", unit="docs"):
        if key not in matched_keys:
            extras_writer.write(doc)
    extras_stats = extras_writer.close()
    print(
        f"  wrote {extras_stats['n_docs']:,} orphan raw_events to {extras_path.name} "
        f"({extras_stats['compressed_bytes'] / 1e6:.1f} MB compressed)"
    )

    # 4) Copy metadata_records and atlas index def
    if meta_path.exists():
        (out_dir / "metadata_records.json").write_bytes(meta_path.read_bytes())
    repo_root = Path(__file__).resolve().parents[2]
    src_index = repo_root / "data" / "atlas_indexes" / "pca_64_vector_search.json"
    if src_index.exists():
        (out_dir / "atlas_indexes" / "pca_64_vector_search.json").write_bytes(src_index.read_bytes())

    # 5) Manifest
    in_manifest = json.loads((in_dir / "manifest.json").read_text()) if (in_dir / "manifest.json").exists() else {}
    manifest = {
        "produced_at": datetime.utcnow().isoformat() + "Z",
        "merged_from": str(in_dir),
        "merged_from_manifest": in_manifest,
        "files": {
            "corpus": corpus_stats,
            "extras_raw_events": extras_stats,
        },
        "schema_notes": {
            "corpus": (
                "Merged per-source records. One doc per (obsid, source_name) "
                "pair that appears in the 51k corpus. Contains everything "
                "from the original 'sources' collection plus the unique fields "
                "and original event_list from 'raw_events'. Two event_list "
                "fields: 'event_list' (pruned 8h, 0.5-8 keV; model input) and "
                "'original_event_list' (full observation; spectrum-snapshot input). "
                "The vector for similarity search lives in pca_64d (64 floats, "
                "cosine similarity, Atlas Vector Search index)."
            ),
            "extras_raw_events": (
                "raw_events documents that had no matching source in the 51k "
                "corpus (sources excluded from the v2 shuffle). Same schema as "
                "the original raw_events collection."
            ),
            "metadata_records": (
                "Small dataset-registry collection used by the webapp's "
                "/api/datasets endpoint."
            ),
        },
    }
    (out_dir / "manifest.json").write_text(json.dumps(manifest, indent=2))
    print(f"\nWrote manifest.json. Merge complete in {out_dir}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
