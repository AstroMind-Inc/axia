"""Publish the merged Axia corpus to Hugging Face Datasets.

Reads the merged dump produced by `merge_dump.py` and pushes the corpus
JSONL.gz + the small auxiliary files (metadata registry, Atlas vector-search
index definition, manifest) to a Hugging Face dataset repository, together
with a generated dataset card (`README.md`).

End users do NOT need this script — they consume the published dataset via
`load_from_huggingface.py`. This is for the paper authors to (re-)publish.

Usage:

    # See exactly what would be uploaded, no network writes:
    python data/ingest/push_to_huggingface.py --dry-run

    # Actually publish to the configured repo:
    python data/ingest/push_to_huggingface.py

    # Push to a different repo or a private dataset:
    python data/ingest/push_to_huggingface.py \\
        --repo-id myorg/my-dataset \\
        --private

Required env:
    HF_TOKEN                   write-scoped token for the target repo

Optional env / flags (defaults baked in):
    --repo-id            (default: astromindinc/axia-csc-corpus)
    --in                 (default: data/full_corpus/merged)
    --license            (default: cc-by-4.0)
    --private            make the repo private (default: public)
    --commit-message     (default: auto)
    --dry-run            just print the plan + README, no upload
    --force              upload even if the remote already has a matching commit
"""

from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import os
import sys
import textwrap
from datetime import datetime
from pathlib import Path

try:
    from huggingface_hub import HfApi, create_repo, hf_hub_download  # noqa: F401
except ImportError:
    sys.exit(
        "ERROR: huggingface_hub is required. Install with:\n"
        "    pip install huggingface_hub"
    )


DEFAULT_REPO_ID = "astromindinc/axia-csc-corpus"
DEFAULT_INPUT_DIR = Path(__file__).resolve().parents[1] / "full_corpus" / "merged"
DEFAULT_LICENSE = "cc-by-4.0"


# ---------------------------------------------------------------------------
# README.md generation
# ---------------------------------------------------------------------------

def _peek_corpus_stats(corpus_path: Path) -> dict:
    """Cheap one-pass stats over the merged corpus."""
    n = 0
    n_with_ra = 0
    n_with_pca = 0
    n_with_original = 0
    cat_counts: dict[str, int] = {}
    first_doc: dict | None = None
    with gzip.open(corpus_path, "rt") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            d = json.loads(line)
            if first_doc is None:
                first_doc = d
            n += 1
            if d.get("ra") is not None and d.get("dec") is not None:
                n_with_ra += 1
            if isinstance(d.get("pca_64d"), list) and len(d["pca_64d"]) == 64:
                n_with_pca += 1
            if d.get("original_event_list"):
                n_with_original += 1
            cat = d.get("source_type_category") or "?"
            cat_counts[cat] = cat_counts.get(cat, 0) + 1
    return {
        "n": n,
        "n_with_ra": n_with_ra,
        "n_with_pca": n_with_pca,
        "n_with_original": n_with_original,
        "cat_counts": dict(sorted(cat_counts.items(), key=lambda kv: -kv[1])),
        "first_doc_keys": sorted(first_doc.keys()) if first_doc else [],
    }


def _build_readme(
    repo_id: str,
    license_id: str,
    corpus_stats: dict,
    manifest: dict,
) -> str:
    cat_lines = []
    for cat, count in corpus_stats["cat_counts"].items():
        cat_lines.append(f"| {cat} | {count:,} |")
    cat_table = "\n".join(cat_lines) if cat_lines else "(none)"

    fields_table = textwrap.dedent("""\
        | Field | Type | Notes |
        |---|---|---|
        | `obsid` | int | Chandra observation ID |
        | `obi` | int | Observation interval |
        | `region_id` | int | CSC region ID |
        | `source_name` | string | CSC source designation (e.g. `2CXO J123456.7+001122`) |
        | `ra`, `dec` | float | ICRS / J2000, decimal degrees |
        | `theta` | float | Off-axis angle, arcmin |
        | `source_type` | string | CSC source_type (e.g. `AGN`, `Seyfert1`, `XB`, `X`, ...) |
        | `source_type_category` | string | One of 11 broad categories used for stratification |
        | `thermal_classification` | string | `thermal` / `nonthermal` |
        | `event_list` | list[[t_s, energy_eV]] | **Pruned** event list — single 8 h window, filtered to 0.5–8 keV. This is what the Axia fine-tuned model trained on. |
        | `original_event_list` | list[[t_s, energy_eV]] | **Original** event list — full observation, all energies. Used by the spectrum-snapshot / light-curve / dE-dt computations. |
        | `pca_64d` | list[float](64) | 64-d embedding from the Axia XrayProcessor → PCA pipeline. Cosine-similarity-indexable. |
        | `umap_2d` | list[float](2) | 2-d UMAP projection for visualisation |
        | `hard_hs`, `hard_hm`, `hard_ms` | float | Hardness ratios in the standard CSC H/M/S bands |
        | `flux_significance_b` | float | Broad-band detection significance |
        | `flux_aper_b`, `flux_bb_aper_b` | float | Broad-band aperture fluxes |
        | `src_cnts_aper_b` | float | Net source counts in the aperture |
        | `var_index_b`, `var_prob_b` | float | Variability index / probability (CSC) |
        | `gti_mjd_obs` | float | Observation start time in MJD |
        | `powlaw_stat`, `powlaw_gamma`, `powlaw_nh`, `powlaw_ampl` | float | Power-law spectral fit |
        | `powlaw_gamma_lolim`, `powlaw_gamma_hilim` | float | Power-law Γ confidence bounds |
        | `powerlaw_gamma_low`, `powerlaw_gamma_high` | float | Alternate Γ bound spelling (kept verbatim from CSC) |
        | `bb_stat`, `bb_kt`, `bb_nh`, `bb_ampl` | float | Black-body spectral fit |
        | `brems_stat`, `brems_kt` | float | Bremsstrahlung spectral fit |
        | `apec_stat`, `apec_kt`, `apec_nh`, `apec_norm`, `apec_abund`, `apec_z` | float | APEC plasma spectral fit (NaN→null when not fit) |
        | `preferred_spectral_model` | list[string] | Catalog recommendation |
        | `recommended_model` | string | Catalog recommendation |
        | `match_type` | string | CSC master-source match type |
        | `significance` | float | CSC source significance |
    """).strip()

    source_cluster = (
        manifest.get("merged_from_manifest", {}).get("source", {}).get("cluster")
        or "MongoDB Atlas"
    )
    produced_at = manifest.get("produced_at", datetime.utcnow().isoformat() + "Z")

    return f"""---
license: {license_id}
language:
- en
tags:
- astronomy
- astrophysics
- chandra
- x-ray
- multimodal
- vector-search
size_categories:
- 10K<n<100K
pretty_name: Axia — Chandra Source Catalog corpus
configs:
- config_name: corpus
  data_files:
  - split: train
    path: data/corpus.jsonl.gz
---

# Axia — Chandra Source Catalog corpus

`{repo_id}` — {corpus_stats['n']:,} X-ray sources from the
[Chandra Source Catalog 2.1](https://cxc.harvard.edu/csc/), each carrying:

- **Per-photon event lists** in two forms: an `event_list` pruned to a single
  8 h window in 0.5-8 keV (the input shape the Axia fine-tuned model trained
  on), and an `original_event_list` containing the full unpruned observation
  (the input to the model-free spectrum-snapshot / light-curve pipeline).
- A **64-d learned embedding** (`pca_64d`) suitable for nearest-neighbour /
  vector search. The values are cosine-similarity-ready.
- A **2-d UMAP projection** (`umap_2d`) for visualisation.
- The **full CSC catalog metadata**: hardness ratios, four-model spectral fits,
  photometry, variability indices, sky coordinates, etc.

This is the dataset that backs the [Axia](https://github.com/astromindinc/axia)
multi-agent X-ray source decoder.

## Quick start

```python
from datasets import load_dataset

ds = load_dataset("{repo_id}", split="train")
print(ds)
# Dataset({{
#     features: [...],
#     num_rows: {corpus_stats['n']:,}
# }})

src = ds[0]
print(src["source_name"], "@", (src["ra"], src["dec"]))
print(" pruned events:", len(src["event_list"]))
print(" full events:  ", len(src["original_event_list"]))
print(" embedding:    ", len(src["pca_64d"]), "dim")
```

## Stratification

The 11 source-type categories present in the corpus (training-set
distribution):

| Category | Count |
|---|---|
{cat_table}

## Fields

{fields_table}

> Floats that are `NaN` in the underlying CSC catalog are stored as JSON
> `null`. ObjectIds and datetimes have been converted to strings.

## Provenance

The X-ray and catalog data are derived from the Chandra Source Catalog 2.1
(CSC 2.1), which is freely available from the Harvard CXC. The `pca_64d`
embedding and the `umap_2d` projection were computed using the Axia
fine-tuned model (DeepSeek-R1-Distill-Qwen-7B + XrayProcessor, LoRA r=8).

Source cluster of this dump: `{source_cluster}`.
Produced: `{produced_at}`.

## Auxiliary files in this repo

- `data/corpus.jsonl.gz` — the main file. One JSON document per line.
- `data/metadata_records.json` — small dataset registry used by the Axia
  webapp's `/api/datasets` endpoint.
- `data/atlas_indexes/pca_64_vector_search.json` — MongoDB Atlas Vector
  Search index definition for the `pca_64d` field (cosine, 64 dims).
- `manifest.json` — original dump provenance (counts, SHA-256, source
  cluster identifier).

## Loading into MongoDB

The companion script `data/ingest/load_from_huggingface.py` in the
[Axia repo](https://github.com/astromindinc/axia) downloads this dataset
and loads it into a MongoDB instance (local or Atlas), creating the
vector-search index if the target is Atlas.

```bash
# In the axia/ repo:
make load-from-hf                       # default: {repo_id}
make load-from-hf DATASET=...           # custom HF repo id
```

## License

This packaged dataset is released under {license_id.upper()}. The underlying
Chandra Source Catalog data is in the public domain; see the
[CSC homepage](https://cxc.harvard.edu/csc/) for the original data use
policy. Please cite both the Axia paper and the CSC if you use this dataset
in published work.

## Citation

```bibtex
@misc{{axia2026,
  title     = {{Axia: a multi-agent decoder for Chandra X-ray sources}},
  author    = {{AstroMind Authors}},
  year      = {{2026}},
  note      = {{TBA — paper in preparation}}
}}
```
"""


# ---------------------------------------------------------------------------
# Push
# ---------------------------------------------------------------------------

def main() -> int:
    p = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    p.add_argument("--repo-id", default=DEFAULT_REPO_ID, help=f"Target dataset repo (default: {DEFAULT_REPO_ID})")
    p.add_argument("--in", dest="in_dir", type=Path, default=DEFAULT_INPUT_DIR)
    p.add_argument("--license", default=DEFAULT_LICENSE)
    p.add_argument("--private", action="store_true", help="Make the repo private.")
    p.add_argument(
        "--commit-message",
        default=None,
        help="Commit message for the upload (default: auto-generated).",
    )
    p.add_argument("--dry-run", action="store_true", help="Print plan + README, do not upload.")
    p.add_argument("--force", action="store_true", help="Re-upload all files even if unchanged.")
    args = p.parse_args()

    token = os.environ.get("HF_TOKEN")
    if not token and not args.dry_run:
        sys.exit("ERROR: HF_TOKEN env var is not set (and --dry-run is off).")

    # Force the legacy LFS multipart upload path. The newer xet protocol has
    # been observed to hang at zero bytes for medium-large files (>100 MB) on
    # residential connections, with no error and no progress, requiring a
    # manual kill. Disabling it gives a reliable, well-instrumented upload.
    os.environ.setdefault("HF_HUB_DISABLE_XET", "1")

    in_dir: Path = args.in_dir
    corpus_path = in_dir / "corpus.jsonl.gz"
    meta_path = in_dir / "metadata_records.json"
    idx_path = in_dir / "atlas_indexes" / "pca_64_vector_search.json"
    manifest_path = in_dir / "manifest.json"

    if not corpus_path.exists():
        sys.exit(f"ERROR: {corpus_path} missing. Run merge_dump.py first.")
    if not manifest_path.exists():
        sys.exit(f"ERROR: {manifest_path} missing.")

    manifest = json.loads(manifest_path.read_text())
    print(f"Scanning {corpus_path.name} ...")
    stats = _peek_corpus_stats(corpus_path)
    print(
        f"  {stats['n']:,} docs"
        f"  | ra+dec: {stats['n_with_ra']:,}"
        f"  | pca_64d: {stats['n_with_pca']:,}"
        f"  | original_event_list: {stats['n_with_original']:,}"
    )

    readme = _build_readme(args.repo_id, args.license, stats, manifest)

    # Plan the file uploads. Repo layout:
    #   README.md
    #   manifest.json
    #   data/corpus.jsonl.gz
    #   data/metadata_records.json
    #   data/atlas_indexes/pca_64_vector_search.json
    uploads: list[tuple[Path, str]] = [
        (corpus_path, "data/corpus.jsonl.gz"),
        (manifest_path, "manifest.json"),
    ]
    if meta_path.exists():
        uploads.append((meta_path, "data/metadata_records.json"))
    if idx_path.exists():
        uploads.append((idx_path, "data/atlas_indexes/pca_64_vector_search.json"))

    print(f"\nTarget repo: {args.repo_id} ({'private' if args.private else 'public'})")
    print(f"License:     {args.license}")
    print(f"Planned uploads:")
    total_bytes = 0
    for src, dst in uploads:
        size = src.stat().st_size
        total_bytes += size
        print(f"  {src.relative_to(in_dir.parent.parent)}  ->  {dst}    ({size/1e6:.1f} MB)")
    print(f"  README.md  ->  README.md    ({len(readme.encode('utf-8'))/1024:.1f} KB)")
    print(f"  Total size: {total_bytes/1e6:.1f} MB")

    if args.dry_run:
        print("\n--- README.md preview (truncated) ---")
        print("\n".join(readme.splitlines()[:60]))
        print(f"... ({len(readme.splitlines())} lines total)")
        print("\nDry run complete. Re-run without --dry-run to actually publish.")
        return 0

    # --- Real push ---
    api = HfApi(token=token)
    commit_message = args.commit_message or (
        f"Axia corpus upload ({stats['n']:,} docs) — "
        f"{datetime.utcnow().isoformat()}Z"
    )

    print(f"\nCreating / verifying repo {args.repo_id} ...")
    create_repo(
        repo_id=args.repo_id,
        repo_type="dataset",
        token=token,
        private=args.private,
        exist_ok=True,
    )
    print("  repo OK")

    # Use upload_folder via a staging dir so all files land in one commit.
    import tempfile, shutil  # local imports — small helpers

    with tempfile.TemporaryDirectory(prefix="axia-hf-") as staging:
        staging_dir = Path(staging)
        (staging_dir / "data" / "atlas_indexes").mkdir(parents=True, exist_ok=True)
        (staging_dir / "README.md").write_text(readme)
        for src, dst in uploads:
            target = staging_dir / dst
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(src, target)

        print(f"\nUploading to {args.repo_id} ... ({total_bytes/1e6:.1f} MB)")
        api.upload_folder(
            folder_path=str(staging_dir),
            repo_id=args.repo_id,
            repo_type="dataset",
            token=token,
            commit_message=commit_message,
        )

    print(f"\nDone. View at https://huggingface.co/datasets/{args.repo_id}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
