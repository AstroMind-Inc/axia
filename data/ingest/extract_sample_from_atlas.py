"""
Extract a stratified sample from the production MongoDB Atlas cluster.

Produces three JSON files in `data/samples/`:
  - sample_sources.json          (from filedata.51k_v2_shuffled)
  - sample_raw_events.json       (from filedata.raw_events, matched on obsid+source_name)
  - sample_metadata_records.json (from metadata.metadata_records)

The sample is stratified by `source_type_category` so every category in the
training corpus is represented.  Documents with `pca_64d` missing or
`event_list` shorter than MIN_EVENTS are filtered out.

Run ONCE during repo setup; the outputs are checked in.

Usage:
    MONGODB_URI=... python extract_sample_from_atlas.py [--per-category N]

Env vars:
    MONGODB_URI                       (required)
    ATLAS_SOURCE_DB                   default: filedata
    ATLAS_SOURCE_COLLECTION           default: 51k_v2_shuffled
    ATLAS_RAW_EVENTS_COLLECTION       default: raw_events
    ATLAS_METADATA_DB                 default: metadata
    ATLAS_METADATA_COLLECTION         default: metadata_records
"""

import argparse
import json
import math
import os
import sys
from pathlib import Path
from typing import Any

from bson import ObjectId
from pymongo import MongoClient

PER_CATEGORY_DEFAULT = 2
MIN_EVENTS = 50
MAX_EVENTS_PER_DOC = 800  # cap event_list size to keep the sample git-friendly

REPO_ROOT = Path(__file__).resolve().parents[2]
OUT_DIR = REPO_ROOT / "data" / "samples"


def clean(value: Any) -> Any:
    if isinstance(value, ObjectId):
        return str(value)
    if isinstance(value, float) and math.isnan(value):
        return None
    if isinstance(value, list):
        return [clean(v) for v in value]
    if isinstance(value, dict):
        return {k: clean(v) for k, v in value.items()}
    return value


def stratified_sample(coll, per_category: int) -> list[dict]:
    """Per-category find query, sorted by flux significance, with event_list size filter.

    Done category-by-category so we don't run a single $group that has to hold
    every event_list in memory (Atlas $push has a 100 MB limit).
    """
    cat_pipeline = [
        {"$group": {"_id": "$source_type_category", "n": {"$sum": 1}}},
        {"$sort": {"n": -1}},
    ]
    categories = [r["_id"] for r in coll.aggregate(cat_pipeline)]

    docs: list[dict] = []
    for cat in categories:
        query = {
            "source_type_category": cat,
            "pca_64d": {"$exists": True},
            "event_list": {"$exists": True},
            f"event_list.{MIN_EVENTS - 1}": {"$exists": True},
        }
        cursor = (
            coll.find(query)
            .sort([("flux_significance_b", -1)])
            .limit(per_category * 4)  # pull a few extras in case of dupes
        )
        picks: list[dict] = []
        seen: set[tuple] = set()
        for d in cursor:
            key = (d.get("obsid"), d.get("source_name"))
            if key in seen:
                continue
            seen.add(key)
            picks.append(d)
            if len(picks) == per_category:
                break
        print(f"  {str(cat):32s} {len(picks)} picked")
        docs.extend(picks)
    return docs


def fetch_raw_events(coll, sources: list[dict]) -> list[dict]:
    out = []
    missing = 0
    for s in sources:
        q = {"obsid": s["obsid"], "source_name": s["source_name"]}
        doc = coll.find_one(q)
        if doc is None:
            missing += 1
            continue
        out.append(doc)
    print(f"  matched {len(out)} of {len(sources)} ({missing} missing)")
    return out


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--per-category", type=int, default=PER_CATEGORY_DEFAULT)
    p.add_argument(
        "--include-qna",
        action="store_true",
        help="Keep the qna / extended_qna fields (training-only, normally dropped).",
    )
    args = p.parse_args()

    uri = os.environ.get("MONGODB_URI")
    if not uri:
        sys.exit("MONGODB_URI is not set.")

    src_db = os.environ.get("ATLAS_SOURCE_DB", "filedata")
    src_col = os.environ.get("ATLAS_SOURCE_COLLECTION", "51k_v2_shuffled")
    raw_col = os.environ.get("ATLAS_RAW_EVENTS_COLLECTION", "raw_events")
    meta_db = os.environ.get("ATLAS_METADATA_DB", "metadata")
    meta_col = os.environ.get("ATLAS_METADATA_COLLECTION", "metadata_records")

    print(f"Connecting to {uri.split('@')[-1].split('/')[0]} ...")
    client = MongoClient(uri, serverSelectionTimeoutMS=15000)
    client.admin.command("ping")

    print(f"\n[1/3] Stratified sample from {src_db}.{src_col} (n={args.per_category} per category):")
    sources = stratified_sample(client[src_db][src_col], args.per_category)

    print(f"\n[2/3] Matching raw_events documents in {src_db}.{raw_col}:")
    raw = fetch_raw_events(client[src_db][raw_col], sources)

    print(f"\n[3/3] Metadata records from {meta_db}.{meta_col}:")
    meta_docs = list(client[meta_db][meta_col].find())
    print(f"  found {len(meta_docs)} records")

    def cap_events(doc: dict) -> dict:
        ev = doc.get("event_list")
        if isinstance(ev, list) and len(ev) > MAX_EVENTS_PER_DOC:
            # uniform stride sampling preserves time + energy structure
            step = len(ev) / MAX_EVENTS_PER_DOC
            doc["event_list"] = [ev[int(i * step)] for i in range(MAX_EVENTS_PER_DOC)]
            doc["_event_list_capped"] = True
            doc["_event_list_original_size"] = len(ev)
        return doc

    def trim(doc: dict) -> dict:
        d = clean(doc)
        if not args.include_qna:
            d.pop("qna", None)
            d.pop("extended_qna", None)
        return cap_events(d)

    sources_out = [trim(d) for d in sources]
    raw_out = [cap_events(clean(d)) for d in raw]
    meta_out = [clean(d) for d in meta_docs]

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    for name, data in [
        ("sample_sources.json", sources_out),
        ("sample_raw_events.json", raw_out),
        ("sample_metadata_records.json", meta_out),
    ]:
        path = OUT_DIR / name
        path.write_text(json.dumps(data, indent=2, ensure_ascii=False, default=str))
        print(f"  wrote {path}  ({path.stat().st_size / 1024:.1f} KB, {len(data)} docs)")

    print("\nDone.")


if __name__ == "__main__":
    main()
