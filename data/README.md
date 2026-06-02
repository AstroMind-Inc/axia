# Axia — Data

This directory bundles the sample dataset shipped with the repo and the
ingestion scripts that build the full 51 450-source corpus from scratch.

```
data/
├── samples/                         # checked-in sample (~2.5 MB total)
│   ├── sample_corpus.json           # 22 merged docs, stratified by source_type_category
│   └── sample_metadata_records.json # dataset registry entries
├── atlas_indexes/
│   └── pca_64_vector_search.json    # Atlas Vector Search index definition
├── ingest/
│   ├── extract_sample_from_atlas.py # build the 22-source sample from production Atlas (one-shot)
│   ├── dump_full_corpus.py          # dump full Mongo corpus (two-collection Atlas schema)
│   │                                #   -> data/full_corpus/dump/
│   ├── merge_dump.py                # merge sources + raw_events into one corpus.jsonl.gz
│   │                                #   -> data/full_corpus/merged/
│   ├── download_from_csc.py         # fetch (obsid, source_name) event lists from CSC 2.1
│   ├── compute_embeddings.py        # POST event_list -> model server /project; promotes
│   │                                #   the raw event_list to `original_event_list` and
│   │                                #   stores the pruned one as `event_list`
│   ├── build_qna_dataset.py         # generate Q&A pairs from catalog metadata
│   ├── load_into_mongo.py           # write the merged corpus into MongoDB (local or Atlas)
│   ├── run_full_corpus.py           # end-to-end driver used by `make rebuild-from-csc`
│   └── sample_csc_index.json        # the (obsid, source_name) list used in the paper
└── README.md                        # this file
```

## Schema (TL;DR)

There is **one collection** (`sources` by default) plus a small dataset
registry (`metadata_records`). Each `sources` document carries:

- `event_list` — pruned, 8h window, 0.5-8 keV (model input)
- `original_event_list` — full unpruned observation (snapshot input)
- `pca_64d` — the 64-d Atlas-Vector-Search-indexed embedding
- `umap_2d` — 2-d UMAP for the scatter plot
- `ra`, `dec`, `theta`, `obsid`, `obi`, `region_id`, `source_name`
- Hardness ratios, spectral fits, fluxes, variability — every CSC catalog field

Full schema is in [`../docs/07_dataset.md`](../docs/07_dataset.md).

## Sample dataset (shipped)

22 sources spread across all 11 `source_type_category` buckets present in the
training corpus. Picked by:

1. `source_type_category == <bucket>` AND `pca_64d` exists AND
   `event_list` length ≥ 50
2. Sort by `flux_significance_b` descending
3. Take top 2 per category
4. Cap `event_list` to 800 events via uniform stride sampling (preserves both
   time and energy distributions). Documents where this was applied carry
   `_event_list_capped: true` and `_event_list_original_size: <N>`.

This is enough to demo every feature: UMAP scatter, nearest-neighbor browser,
multi-agent chat with all five agents, light curves, dE-dt maps, spectrum
snapshots.

### Schema (see `docs/07_dataset.md` for the full reference)

```
obsid, obi, region_id, source_name,
ra, dec, theta,
source_type, source_type_category, thermal_classification,

event_list           : list[[t,E]]     pruned 8 h window, 0.5–8 keV (model input)
original_event_list  : list[[t,E]]     ORIGINAL (unpruned, full observation; snapshot input)

pca_64d              : list[float](64) embedding for vector search
umap_2d              : list[float](2)

hard_hs, hard_hm, hard_ms,
powlaw_*, bb_*, brems_*, apec_*,
powlaw_gamma_lolim, powlaw_gamma_hilim,
powerlaw_gamma_low, powerlaw_gamma_high,

flux_significance_b, var_index_b, var_prob_b,
flux_aper_b, flux_bb_aper_b, src_cnts_aper_b,
gti_mjd_obs, match_type, significance,
preferred_spectral_model, recommended_model
```

## Pulling the full corpus from Hugging Face (recommended)

The published dataset is at
[`astromindinc/axia-csc-corpus`](https://huggingface.co/datasets/astromindinc/axia-csc-corpus).
A single command downloads it (~305 MB) into a local cache and loads it
straight into your configured MongoDB:

```bash
make load-from-hf                          # default repo
make load-from-hf DATASET=other/repo       # custom HF dataset
```

The cache lives at `data/full_corpus/from_hf/<repo-id>/`. Subsequent runs
detect the cached files and skip the download (the script prints exactly
where the cache is so you can wipe it for a fresh pull). The HF manifest's
SHA-256 is verified against the downloaded `corpus.jsonl.gz` on every run.

If `MONGODB_MODE=external` in your `.env`, the Makefile passes `--atlas` to
the script and the Atlas vector-search index is created automatically after
the load.

## Rebuilding the full corpus

```bash
# 0. Make sure MODEL_SERVER_URL is set in .env
make rebuild-from-csc
```

This runs `data/ingest/run_full_corpus.py` which:

1. Reads `data/ingest/full_corpus_index.json` (the (obsid, source_name) list
   used in the paper, ~5 MB, checked in).
2. Calls `download_from_csc.py` to fetch event lists via the CSC 2.1 TAP
   service. ~6 h on a good connection.
3. Calls `compute_embeddings.py` to compute `pca_64d` + `umap_2d` via the
   user-configured fine-tuned model server (`/project` endpoint). Requires
   a GPU and a running model server.
4. Calls `build_qna_dataset.py` to synthesise the training Q&A pairs from
   catalog metadata (only needed if you want to re-train the model).
5. Calls `load_into_mongo.py` to write everything to MongoDB.

If you do not have a GPU, you can still load a frozen export of the corpus
when one is made available (link will be added once the dataset is published
on Zenodo).

## Re-creating the sample yourself (not needed)

```bash
MONGODB_URI="<atlas-uri>" \
    python data/ingest/extract_sample_from_atlas.py --per-category 2
```

You don't need to do this — the output is checked in.

## Dumping the full corpus for Hugging Face (paper authors only)

The production Atlas cluster still holds the corpus in two collections
(`51k_v2_shuffled` + `raw_events`). `dump_full_corpus.py` streams both of
those out into gzipped JSONL, and `merge_dump.py` joins them on
`(obsid, source_name)` into the **single merged corpus** that the rest of
axia consumes. The merged output is what we push to Hugging Face Datasets;
end users will pull it via the (forthcoming) `load_from_huggingface.py`.

```bash
# Activate a venv with pymongo + tqdm.
# Set MONGODB_URI to the source cluster (production Atlas).
MONGODB_URI="mongodb+srv://..." \
    python data/ingest/dump_full_corpus.py
python data/ingest/merge_dump.py
```

Default outputs:

```
data/full_corpus/dump/                 (raw dump, two files)
  sources.jsonl.gz              ~133 MB   51 450 corpus docs from 51k_v2_shuffled
  raw_events.jsonl.gz           ~186 MB   52 225 docs from raw_events
  metadata_records.json         <  4 KB   8 dataset-registry entries
  atlas_indexes/
    pca_64_vector_search.json
  manifest.json

data/full_corpus/merged/               (single merged corpus, what HF receives)
  corpus.jsonl.gz               ~305 MB   51 450 merged docs (both event_lists,
                                          pca_64d, umap_2d, ra/dec, full catalog)
  extras_raw_events.jsonl.gz    <  1 MB     775 orphan raw_events (no corpus match)
  metadata_records.json
  atlas_indexes/pca_64_vector_search.json
  manifest.json
```

Useful flags:

| Flag | Purpose |
|---|---|
| `--limit 100` | Smoke-test on a small slice before running the full dump. |
| `--include-qna` | Keep the training-only `qna` / `extended_qna` fields. Adds ~50%. Off by default. |
| `--collections sources` | Dump only a subset. |
| `--out /path/to/dump` | Override the default `data/full_corpus/dump/`. |
| `--overwrite` | Wipe the output dir before dumping. |

Sanitisation done in-line as documents stream out: `ObjectId` → `str`,
`datetime` → ISO string, `NaN/±inf` floats → `null`. Each JSONL line is a
self-contained JSON document, one Mongo doc per line.

`manifest.json` records the source cluster, db/collection names, document
counts, sha256 of the uncompressed bytes, and the relevant schema notes —
it's everything you need to reproduce the dump or audit a downstream
re-publication.
