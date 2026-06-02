"""Download the Axia corpus from Hugging Face Datasets and load it into MongoDB.

Companion to `push_to_huggingface.py`. End-user-facing script: it pulls the
merged corpus from a public HF dataset, caches it under
`data/full_corpus/from_hf/<repo-id>/`, and then inserts it into the
configured MongoDB.

The download cache is **intentional**. Re-running the script with the same
target detects the existing files and reuses them without re-downloading.
Delete the cache directory (or pass `--force-download`) to refresh from HF.

Usage:

    # Default: pull astromindinc/axia-csc-corpus into the configured local Mongo.
    MONGODB_URI="mongodb://localhost:27017" python data/ingest/load_from_huggingface.py

    # Push into an Atlas cluster (also creates the vector-search index).
    MONGODB_URI="mongodb+srv://..." python data/ingest/load_from_huggingface.py --atlas

    # Force a fresh download (deletes the local cache first).
    python data/ingest/load_from_huggingface.py --force-download

    # Pull a different repo:
    python data/ingest/load_from_huggingface.py --repo-id myorg/my-fork

Required env:
    MONGODB_URI                   (required)

Optional env / flags:
    MONGODB_DB                    default: axia
    MONGODB_CORPUS_COLLECTION     default: sources
    MONGODB_METADATA_COLLECTION   default: metadata_records
    HF_TOKEN                      only needed for private dataset repos

    --repo-id                     default: astromindinc/axia-csc-corpus
    --cache-dir                   default: data/full_corpus/from_hf/
    --drop                        drop target collections before insert (recommended on first run)
    --atlas                       also create the pca_64_vector_search Atlas index
    --force-download              delete the cache dir before downloading
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import sys
from pathlib import Path

try:
    from huggingface_hub import snapshot_download
except ImportError:
    sys.exit(
        "ERROR: huggingface_hub is required. Install with:\n"
        "    pip install huggingface_hub"
    )


DEFAULT_REPO_ID = "astromindinc/axia-csc-corpus"
DEFAULT_CACHE_ROOT = Path(__file__).resolve().parents[1] / "full_corpus" / "from_hf"

# Files expected inside the HF dataset (paths relative to the repo root).
EXPECTED_FILES = [
    "data/corpus.jsonl.gz",
    "data/metadata_records.json",
    "manifest.json",
]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _sha256_of_gzipped_lines(path: Path) -> str:
    """SHA-256 of the *uncompressed* contents (matches push_to_huggingface.py's manifest)."""
    import gzip
    sha = hashlib.sha256()
    with gzip.open(path, "rb") as f:
        while True:
            chunk = f.read(1024 * 1024)
            if not chunk:
                break
            sha.update(chunk)
    return sha.hexdigest()


def _sha256_of_file(path: Path) -> str:
    """SHA-256 of a plain file."""
    sha = hashlib.sha256()
    with path.open("rb") as f:
        while True:
            chunk = f.read(1024 * 1024)
            if not chunk:
                break
            sha.update(chunk)
    return sha.hexdigest()


def _human_bytes(n: int) -> str:
    for unit in ("B", "KB", "MB", "GB"):
        if n < 1024:
            return f"{n:.1f} {unit}"
        n /= 1024
    return f"{n:.1f} TB"


def _cache_dir_for(repo_id: str, cache_root: Path) -> Path:
    return cache_root / repo_id.replace("/", "__")


def _has_complete_cache(cache_dir: Path) -> bool:
    return all((cache_dir / f).exists() and (cache_dir / f).stat().st_size > 0 for f in EXPECTED_FILES)


# ---------------------------------------------------------------------------
# Main flow
# ---------------------------------------------------------------------------

def download(repo_id: str, cache_dir: Path, force: bool, token: str | None) -> Path:
    """Fetch the dataset repo into cache_dir. Returns the local repo root path."""
    if cache_dir.exists() and force:
        print(f"[load-from-hf] --force-download: removing {cache_dir}")
        shutil.rmtree(cache_dir)

    if _has_complete_cache(cache_dir):
        size = sum((cache_dir / f).stat().st_size for f in EXPECTED_FILES)
        print(f"[load-from-hf] Using cached download at {cache_dir}")
        print(f"               ({len(EXPECTED_FILES)} files, ~{_human_bytes(size)} on disk)")
        print(f"               Delete that directory (or pass --force-download) to re-download.")
        return cache_dir

    print(f"[load-from-hf] Downloading {repo_id} from Hugging Face ...")
    print(f"               target: {cache_dir}")
    print(f"               (this is a one-time download; subsequent runs reuse it)")
    cache_dir.mkdir(parents=True, exist_ok=True)
    snapshot_download(
        repo_id=repo_id,
        repo_type="dataset",
        local_dir=str(cache_dir),
        token=token,
        # Be quiet about file-level chatter but keep the per-file progress bars.
        allow_patterns=EXPECTED_FILES + ["README.md", "data/atlas_indexes/*"],
    )
    if not _has_complete_cache(cache_dir):
        missing = [f for f in EXPECTED_FILES if not (cache_dir / f).exists()]
        sys.exit(f"ERROR: download incomplete; missing: {missing}")
    size = sum((cache_dir / f).stat().st_size for f in EXPECTED_FILES)
    print(f"[load-from-hf] Download complete ({_human_bytes(size)} on disk)")
    return cache_dir


def verify(cache_dir: Path) -> dict:
    """Re-check sha256 of the downloaded files against the manifest."""
    manifest = json.loads((cache_dir / "manifest.json").read_text())
    print(f"\n[load-from-hf] Verifying integrity against manifest.json ...")
    files = manifest.get("files", {})

    corpus_expected = (files.get("corpus") or {}).get("sha256_uncompressed")
    corpus_actual = _sha256_of_gzipped_lines(cache_dir / "data" / "corpus.jsonl.gz")
    if corpus_expected and corpus_expected != corpus_actual:
        print(f"  WARNING: corpus sha256 mismatch")
        print(f"           expected={corpus_expected}")
        print(f"           actual  ={corpus_actual}")
    elif corpus_expected:
        print(f"  ✓ data/corpus.jsonl.gz       sha256={corpus_actual[:16]}... matches manifest")
    else:
        print(f"  (manifest has no checksum for corpus; skipping)")

    n_docs = (files.get("corpus") or {}).get("n_docs")
    print(f"  corpus n_docs (manifest): {n_docs:,}" if n_docs else "  corpus n_docs: (unknown)")
    return manifest


def load_into_mongo(cache_dir: Path, drop: bool, atlas: bool) -> int:
    """Delegate to data/ingest/load_into_mongo.py."""
    sys.path.insert(0, str(Path(__file__).parent))
    import load_into_mongo as loader

    print(f"\n[load-from-hf] Loading into MongoDB ...")
    sys.argv = [
        "load_into_mongo.py",
        "--corpus", str(cache_dir / "data" / "corpus.jsonl.gz"),
        "--metadata", str(cache_dir / "data" / "metadata_records.json"),
    ]
    if drop:
        sys.argv.append("--drop")
    if atlas:
        sys.argv.append("--atlas")
    return loader.main()


def main() -> int:
    p = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    p.add_argument("--repo-id", default=DEFAULT_REPO_ID)
    p.add_argument("--cache-dir", type=Path, default=DEFAULT_CACHE_ROOT)
    p.add_argument("--drop", action="store_true", help="Drop target collections before insert.")
    p.add_argument("--atlas", action="store_true",
                   help="When the target Mongo is Atlas, also create the pca_64_vector_search index.")
    p.add_argument("--force-download", action="store_true",
                   help="Delete the local cache and re-download from HF.")
    args = p.parse_args()

    if not os.environ.get("MONGODB_URI"):
        sys.exit("ERROR: MONGODB_URI env var is not set.")

    cache_dir = _cache_dir_for(args.repo_id, args.cache_dir)
    token = os.environ.get("HF_TOKEN")  # only needed for private repos

    download(args.repo_id, cache_dir, args.force_download, token)
    verify(cache_dir)
    return load_into_mongo(cache_dir, drop=args.drop, atlas=args.atlas)


if __name__ == "__main__":
    raise SystemExit(main())
