# Side studies

Auxiliary analyses that produced figures and tables in the Axia paper but are
**not part of the reproducible core stack** under `service/`, `model/`, and
`webapp/`. Treat the scripts here as research artefacts: they require manual
configuration, hard-coded paths in some places, and are not run by
`docker compose`.

Three sub-areas:

| Folder | What it does |
|---|---|
| `bulk_eval/` | Batched evaluation of the multi-agent system over thousands of CSC sources. Produces the model-comparison figures (PLLM vs Metadata-only vs GPT-5 direct). |
| `flaring_sources/` | Targeted study on transient/flaring X-ray sources: extraction, neighbor enrichment, classification comparison. |
| `anomaly_detection/` | Per-source anomaly scoring and the training script for the anomaly detector. |

## Environment

All scripts expect:

```bash
export MONGODB_URI="<your Atlas URI or local mongodb:// URI>"
export OPENAI_API_KEY="<your OpenAI key>"
export MODEL_SERVER_URL="<URL of the fine-tuned model server>"   # for scripts that compute embeddings
```

Hard-coded production URIs have been replaced with `os.environ` lookups. If
you copied an older version, double-check before running.

## bulk_eval

The pipeline that produced the headline accuracy numbers in the paper.

```bash
cd side_studies/bulk_eval

# 1) Extract a test set from MongoDB
python get_data/extract_from_mongodb.py
python get_data/add_neighbors.py
python get_data/cleanup_csv.py

# 2) Run the multi-agent stack over every source
./run_analysis.sh                              # invokes bulk_metadata_analysis.py

# 3) Run baselines
./run_openai_direct.sh                         # GPT-5 with only catalog metadata
./run_embeddings.sh                            # nearest-neighbor baseline

# 4) Merge results and produce comparison tables
./run_merge.sh
./run_comparison.sh
```

Output JSONs are intentionally **not** committed (they're 1.7 GB total).
Re-derive them from MongoDB if you need to reproduce the paper's tables.

## flaring_sources

Mirror of `bulk_eval` but filtered to sources that the Gregory-Loredo
changepoint analysis flagged as flaring.

```bash
cd side_studies/flaring_sources
./RUN_ANALYSIS.sh
```

See `INSTRUCTIONS.md` and `README.md` for details.

## anomaly_detection

```bash
cd side_studies/anomaly_detection
python train_anomaly_model.py             # train per-source anomaly model
python pre_calculate_anomaly_scores.py    # score every source in the corpus
```

The webapp's anomaly-browser route is intentionally **not** included in the
core stack — it was an experimental side-feature. The scoring code is here
for completeness.

## Caveats

- These scripts were the working notebooks for the paper. They may reference
  legacy collection names (`51k_v2_shuffled`, `raw_events`) that are no longer
  the default in the main stack. The script-level constants near the top of
  each file should be adjusted to match your local Mongo schema if needed.
- Some scripts assume specific output filenames in the current working
  directory; check `argparse` defaults or top-of-file constants before
  running.
- READMEs inside each sub-folder describe step-by-step usage in more detail.
