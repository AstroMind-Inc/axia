"""End-to-end full-corpus rebuild driver: download from CSC -> embed via the
model server -> load into Mongo.

Triggered by `make rebuild-from-csc`. Slow (~6 h network + GPU time).

Usage:
    MODEL_SERVER_URL=... MONGODB_URI=... python run_full_corpus.py
"""

import asyncio
import json
import logging
import os
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = REPO_ROOT / "data"

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger("axia.run_full_corpus")


def main() -> int:
    model_url = os.environ.get("MODEL_SERVER_URL")
    if not model_url:
        log.error("MODEL_SERVER_URL is not set; full corpus rebuild requires the fine-tuned model server.")
        return 2
    if not os.environ.get("MONGODB_URI"):
        log.error("MONGODB_URI is not set.")
        return 2

    work = DATA_DIR / "full_corpus"
    work.mkdir(parents=True, exist_ok=True)
    index_path = DATA_DIR / "ingest" / "sample_csc_index.json"  # replace with full_corpus_index.json once published
    log.warning(
        "Using the sample (44 source) CSC index for now. Replace with the full %s once the paper dataset is released.",
        "full_corpus_index.json",
    )
    if not index_path.exists():
        log.error("CSC index not found at %s", index_path)
        return 2

    raw_path = work / "downloaded.json"
    embedded_path = work / "embedded.json"

    # 1) Download event lists from CSC
    log.info("Step 1/3: downloading event lists from CSC TAP ...")
    sys.path.insert(0, str(DATA_DIR / "ingest"))
    import download_from_csc as dl  # noqa: E402

    dl.process_sources(index_path, raw_path)
    log.info("  done -> %s", raw_path)

    # 2) Compute embeddings via the model server
    log.info("Step 2/3: computing pca_64d + umap_2d via model server ...")
    import compute_embeddings as ce  # noqa: E402

    rc = asyncio.run(
        ce.main_async(
            type(
                "A",
                (),
                {"input": str(raw_path), "output": str(embedded_path), "model_server_url": model_url},
            )()
        )
    )
    if rc != 0:
        log.error("Embedding step failed.")
        return rc

    # 3) Load into Mongo.
    # compute_embeddings.py already promotes the original event_list to
    # `original_event_list` and replaces `event_list` with the pruned
    # version, so `embedded.json` matches the merged corpus schema.
    log.info("Step 3/3: loading into Mongo ...")
    import load_into_mongo  # noqa: E402

    sys.argv = [
        "load_into_mongo.py",
        "--corpus",
        str(embedded_path),
        "--drop",
    ]
    if "mongodb+srv" in os.environ.get("MONGODB_URI", ""):
        sys.argv.append("--atlas")
    return load_into_mongo.main()


if __name__ == "__main__":
    raise SystemExit(main())
