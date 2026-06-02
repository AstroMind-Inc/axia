"""Load the configured Mongo database from a merged corpus dump.

Used by `make rebuild-from-csc` (after `merge_dump.py` produces
`corpus.jsonl.gz`) and ad-hoc for any rebuild against a fresh Mongo. The
mongo-init shell script that runs on first `make up` uses `mongoimport`
directly for the bundled sample; this script handles the gzipped JSONL
case for the full corpus.

Usage:
    python load_into_mongo.py \
        --corpus     <path-to-corpus.jsonl.gz>      \
        --metadata   <path-to-metadata_records.json>  # optional
        --drop                                        # optional
        --atlas                                       # if URI is Atlas, also create the vector search index

Inputs accept either gzipped JSONL (`.jsonl.gz`), JSONL (`.jsonl`), or a
single JSON array (`.json`).

Environment:
    MONGODB_URI                       (required)
    MONGODB_DB                        default: axia
    MONGODB_CORPUS_COLLECTION         default: sources
    MONGODB_METADATA_COLLECTION       default: metadata_records
"""

import argparse
import gzip
import json
import os
import sys
from pathlib import Path
from typing import Iterator

from pymongo import MongoClient


def _iter_docs(path: Path) -> Iterator[dict]:
    """Yield documents from .jsonl.gz, .jsonl, or .json."""
    name = path.name.lower()
    if name.endswith(".jsonl.gz"):
        with gzip.open(path, "rt", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line:
                    yield json.loads(line)
    elif name.endswith(".jsonl"):
        with path.open("r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line:
                    yield json.loads(line)
    elif name.endswith(".json"):
        data = json.loads(path.read_text())
        if not isinstance(data, list):
            raise ValueError(f"{path} is a single JSON object; expected a list.")
        yield from data
    else:
        raise ValueError(f"Unsupported file extension: {path}")


def _bulk_load(coll, docs_iter, batch_size: int = 500) -> int:
    n = 0
    batch: list = []
    for doc in docs_iter:
        batch.append(doc)
        if len(batch) >= batch_size:
            coll.insert_many(batch, ordered=False)
            n += len(batch)
            batch.clear()
    if batch:
        coll.insert_many(batch, ordered=False)
        n += len(batch)
    return n


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument(
        "--corpus",
        type=Path,
        required=True,
        help="Path to corpus.jsonl.gz (or .jsonl / .json) — one doc per source.",
    )
    p.add_argument(
        "--metadata",
        type=Path,
        default=None,
        help="Optional path to metadata_records.json (dataset registry).",
    )
    p.add_argument("--drop", action="store_true", help="Drop target collections first.")
    p.add_argument(
        "--atlas",
        action="store_true",
        help="When the target URI is Atlas, also create the pca_64_vector_search index.",
    )
    args = p.parse_args()

    uri = os.environ.get("MONGODB_URI")
    if not uri:
        sys.exit("MONGODB_URI is not set.")

    db_name = os.environ.get("MONGODB_DB", "axia")
    coll_corpus = os.environ.get("MONGODB_CORPUS_COLLECTION", "sources")
    coll_meta = os.environ.get("MONGODB_METADATA_COLLECTION", "metadata_records")

    client = MongoClient(uri, serverSelectionTimeoutMS=15000)
    client.admin.command("ping")
    db = client[db_name]
    print(f"connected: {db_name}@{uri.split('@')[-1].split('/')[0]}")

    if args.drop:
        db[coll_corpus].drop()
        if args.metadata is not None:
            db[coll_meta].drop()

    print(f"loading corpus from {args.corpus} ...")
    n_corpus = _bulk_load(db[coll_corpus], _iter_docs(args.corpus))
    print(f"  {coll_corpus:30s} {n_corpus:>6} docs loaded")

    if args.metadata is not None:
        print(f"loading metadata from {args.metadata} ...")
        n_meta = _bulk_load(db[coll_meta], _iter_docs(args.metadata))
        print(f"  {coll_meta:30s} {n_meta:>6} docs loaded")

    print("creating regular indexes ...")
    db[coll_corpus].create_index([("obsid", 1), ("source_name", 1)])
    db[coll_corpus].create_index([("source_type_category", 1)])

    if args.atlas:
        idx_def_path = Path(__file__).parent.parent / "atlas_indexes" / "pca_64_vector_search.json"
        if not idx_def_path.exists():
            print(f"WARNING: index definition not found at {idx_def_path}")
        else:
            idx_def = json.loads(idx_def_path.read_text())
            try:
                existing = {idx["name"] for idx in db[coll_corpus].list_search_indexes()}
                if idx_def["name"] in existing:
                    print(f"  Atlas vector index '{idx_def['name']}' already exists.")
                else:
                    db[coll_corpus].create_search_index(
                        {"name": idx_def["name"], "type": idx_def["type"], "definition": idx_def["definition"]}
                    )
                    print(
                        f"  Atlas vector index '{idx_def['name']}' created "
                        f"(may take a few minutes to become READY)."
                    )
            except Exception as e:  # noqa: BLE001
                print(f"WARNING: failed to create Atlas vector index: {e}")

    print("done.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
