# 07 — Dataset

Axia stores the Chandra Source Catalog (CSC) corpus in **one MongoDB
database** with two collections. By default this is the `axia` database in a
local Mongo 7 container; you can also point at an external MongoDB Atlas
cluster (see [`08_deployment.md`](./08_deployment.md)).

## Collections

```
axia/
├── sources             merged per-source corpus (configurable via MONGODB_CORPUS_COLLECTION).
│                       One document per (obsid, source_name) holding:
│                         - event_list           : pruned 8-h window, 0.5-8 keV  (model input)
│                         - original_event_list  : full unpruned observation     (snapshot input)
│                         - pca_64d, umap_2d      : learned representations
│                         - ra, dec, theta        : coordinates
│                         - the full CSC catalog (hardness ratios, spectral fits, ...)
└── metadata_records    small dataset registry used by the webapp's /api/datasets endpoint.
```

> An earlier internal design had two physically-separate collections (a
> "sources" corpus and a "raw_events" catalog). They have been **merged**
> into one — every source now carries both the pruned and the unpruned
> event lists, plus all the CSC catalog metadata, in a single document.
> Spectral-fit values agreed exactly between the two sides on every record
> we checked, so the merge was lossless.

## Per-document schema

### `sources` (51 450 docs in the full corpus, 22 in the sample)

```jsonc
{
  // identity + coordinates
  "_id":          "<ObjectId or string>",
  "obsid":        12345,
  "obi":          1,
  "region_id":    264,
  "source_name":  "2CXO J123456.7+001122",
  "ra":           151.39,
  "dec":          -7.64,
  "theta":        6.90,

  // classification
  "source_type":            "AGN",
  "source_type_category":   "Large accretors",     // one of 11 categories
  "thermal_classification": "nonthermal",

  // event lists  (the only "renamed" pair vs the historical schema)
  "event_list":          [[t, e], ...],   // pruned to 8 h window + 0.5-8 keV (model input)
  "original_event_list": [[t, e], ...],   // full observation, all energies   (snapshot input)

  // learned representations
  "pca_64d": [...64 floats...],           // Atlas Vector Search index target
  "umap_2d": [u, v],                       // for the UMAP scatter

  // photometry
  "src_cnts_aper_b":     86.4,
  "flux_aper_b":         2.84e-14,
  "flux_bb_aper_b":      1.26e-14,
  "flux_significance_b": 16.6,
  "gti_mjd_obs":         55952.93,

  // variability
  "var_index_b": 0.0,
  "var_prob_b":  0.077,

  // hardness ratios
  "hard_hs": 0.886, "hard_hm": 0.560, "hard_ms": 0.645,

  // spectral fits (NaN -> null when not fit)
  "powlaw_stat":           1.06,
  "powlaw_gamma":          1.61,
  "powlaw_nh":             125.57,
  "powlaw_ampl":           1.74e-5,
  "powlaw_gamma_lolim":   -0.72,
  "powlaw_gamma_hilim":   -0.51,
  "powerlaw_gamma_low":   -0.72,        // alternate spelling preserved from raw_events
  "powerlaw_gamma_high":  -0.51,
  "bb_stat":    1.30, "bb_kt":    1.09, "bb_nh":   37.19, "bb_ampl":  4.63e-6,
  "brems_stat": 1.07, "brems_kt": 13.0,
  "apec_stat":  null, "apec_kt":  null, "apec_nh": null,
  "apec_norm":  null, "apec_abund": null, "apec_z": null,

  // recommendation + catalog metadata
  "preferred_spectral_model": ["power-law"],
  "recommended_model":         "power-law",
  "match_type":                "u",
  "significance":              26.51
}
```

### `metadata_records`

```jsonc
{
  "collection_name": "sources",
  "file_name":       "Axia sources",
  "object_count":    51450,
  "upload_date":     "2026-05-27T...",
  "sample_type":     "train|test|sample"
}
```

## The shipped sample

`data/samples/` contains:

- `sample_corpus.json` (~2.5 MB, 22 docs) — one merged doc per source.
- `sample_metadata_records.json` (~2 KB, 8 docs).

The sample is **stratified by `source_type_category`** so every one of the
11 categories present in the training corpus is represented:

```
Other                          2  (15,849 in the full corpus)
Large accretors                2  (12,604)
Young stars                    2  ( 8,221)
Normal stars                   2  ( 4,407)
Small accretors                2  ( 3,899)
Normal galaxies                2  ( 2,549)
Active / variable stars        2  ( 1,386)
Stellar systems & clusters     2  ( 1,207)
Stellar remnants               2  (   555)
Massive stars                  2  (   461)
White Dwarf accretors          2  (   312)
```

Each shipped event list is capped at 800 events via uniform stride sampling
to keep the sample git-friendly. Sources where this was applied carry
`_event_list_capped: true` and `_event_list_original_size: <N>` so callers
can detect it.

## Loading

`make load-sample` is run automatically on first boot of the local Mongo
container by `scripts/mongo-init/load_sample.sh`. The same script can be
invoked manually to reload (with `RELOAD=1` to wipe first):

```bash
make load-sample
```

To use a different sample, drop your own `sample_corpus.json` into
`data/samples/` and rerun the loader.

## Indexes

On every load:

```
sources.createIndex({obsid: 1, source_name: 1})
sources.createIndex({source_type_category: 1})
```

On Atlas only, the vector-search index is also created from
`data/atlas_indexes/pca_64_vector_search.json`:

```json
{
  "name": "pca_64_vector_search",
  "type": "vectorSearch",
  "definition": {
    "fields": [
      {"type": "vector", "path": "pca_64d", "numDimensions": 64, "similarity": "cosine"}
    ]
  }
}
```

The webapp's nearest-neighbour route detects whether it is talking to Atlas
(via `MONGODB_MODE=external`) and switches between `$vectorSearch` and a
brute-force cosine scan accordingly. See
[`05_neighbor_analysis.md`](./05_neighbor_analysis.md).

## Pulling the full corpus from Hugging Face (recommended)

The published dataset lives at
[`astromindinc/axia-csc-corpus`](https://huggingface.co/datasets/astromindinc/axia-csc-corpus)
(public, CC-BY-4.0). One command pulls it and loads into Mongo:

```bash
make load-from-hf                       # default: astromindinc/axia-csc-corpus
make load-from-hf DATASET=other/repo    # custom HF dataset
```

What it does:

1. Downloads the 305 MB `corpus.jsonl.gz` (plus the dataset card,
   `metadata_records.json`, and the Atlas index definition) into
   `data/full_corpus/from_hf/<repo-id>/`.
2. Verifies the downloaded `corpus.jsonl.gz`'s SHA-256 against the
   manifest shipped with the dataset.
3. Streams the file into MongoDB, populating the `sources` and
   `metadata_records` collections.
4. Creates the regular indexes (`obsid+source_name`, `source_type_category`).
5. If `MONGODB_MODE=external` (Atlas), also creates the
   `pca_64_vector_search` vector-search index.

The download is cached. Re-running detects the cache and skips the
download; the script tells you exactly where the cache directory is so you
can delete it (or pass `--force-download`) to refresh.

Loading times on a typical laptop:

| Step | Local Mongo | Atlas (us-east) |
|---|---|---|
| Download from HF | ~30 s (305 MB) | ~30 s |
| Verify checksum | ~5 s | ~5 s |
| Insert 51 450 docs | ~25 s | ~3 min |
| Create indexes (regular) | <1 s | ~10 s |
| Create vector-search index | n/a | several minutes (background) |

## Rebuilding the full 51 450-source corpus from scratch

Requires the fine-tuned model server (the `pca_64d` and `umap_2d` columns
are produced by it). The pipeline:

```bash
# 1) Make sure MODEL_SERVER_URL and MONGODB_URI are set in .env
make rebuild-from-csc
```

This invokes `data/ingest/run_full_corpus.py`, which runs three steps:

| Step | Script | What it does | Time |
|---|---|---|---|
| 1 | `download_from_csc.py` | Fetches `event_list` for each (obsid, source_name) via CSC 2.1 TAP. | ~6 h |
| 2 | `compute_embeddings.py` | POST every event list to the model server's `/project` endpoint to compute `pca_64d` and `umap_2d`. Promotes the original event_list to `original_event_list` and replaces `event_list` with the pruned version. | ~30 min on A100 |
| 3 | `load_into_mongo.py` | Inserts everything into the configured Mongo (drops existing collection first). | ~2 min |

The `(obsid, source_name)` index used in the paper is at
`data/ingest/full_corpus_index.json` (placeholder filename today;
the actual index is ~5 MB and will be released alongside the paper on Zenodo
once the dataset is public). For now the script falls back to the 44-row
`sample_csc_index.json` so the pipeline can still be smoke-tested end to
end.

## Dumping the existing Atlas corpus into shippable files

If you have access to the production Atlas cluster that holds the original
two-collection schema, `data/ingest/dump_full_corpus.py` streams it out
into two gzipped JSONL files plus a metadata-records JSON, and
`data/ingest/merge_dump.py` then joins them into a single
`corpus.jsonl.gz` matching the merged schema documented above. This is
what the paper authors used to prepare the Hugging Face Datasets
publication; end users do not need to run it.

```bash
MONGODB_URI="mongodb+srv://..." python data/ingest/dump_full_corpus.py
python data/ingest/merge_dump.py     # data/full_corpus/dump/ -> data/full_corpus/merged/
```

## Generating training Q&A pairs

For users who want to re-train the model from scratch:

```bash
python data/ingest/build_qna_dataset.py \
    --sources data/full_corpus/merged/corpus.jsonl.gz \
    --output  data/full_corpus/qna_sequences.json
```

The output is a list of `{obsid, source_name, source_type, source_type_category,
event_list, qna: [{question, answer}, ...]}` records. `model/training/train.py`
reads this format directly.

## When you have your own data

The Mongo schema is the only thing the rest of the stack cares about. If
your data already follows it, just point `MONGODB_URI` / `MONGODB_DB` at it
and skip the ingest scripts entirely.

If you have raw event lists in some other format, the easiest path is to
write a small adapter that emits one JSON file matching the schema above,
then run:

```bash
MONGODB_URI=... MONGODB_DB=axia \
python data/ingest/load_into_mongo.py \
    --corpus my_corpus.jsonl.gz \
    --drop
```
