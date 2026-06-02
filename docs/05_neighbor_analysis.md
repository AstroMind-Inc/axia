# 05 — Neighbour analysis

The Neighbour Analyst (`service/src/agents/neighbor.py`) compares the target
source to its 10 nearest neighbours in the learned embedding space. It runs
as step 3 in the workflow, after the Metadata Analyst but before the Tool
Agent.

## The embedding space

For every source in the corpus we precompute and store:

- `pca_64d` — a 64-dimensional vector. Obtained by passing the raw event
  list through the fine-tuned XrayProcessor (producing a 4096-d backbone
  hidden state), then through an `L2-Normalize → PCA(64)` pipeline that was
  fitted on the full training corpus.
- `umap_2d` — the 2-d UMAP projection of `pca_64d`, used purely for
  the webapp scatter plot.

The 64-d space turns out to cluster sources by combined spectral + temporal
behaviour, much more coherently than catalog-based features alone. This is
documented in the paper (section "Embedding-space analysis").

## Retrieval

Nearest neighbours come from the webapp's `POST /api/nearest-neighbors`
route, which **does not** go through the orchestrator — it queries Mongo
directly.

Two modes:

### External Mongo (Atlas, `MONGODB_MODE=external`)

Uses MongoDB Atlas Vector Search via `$vectorSearch`:

```js
db.sources.aggregate([
  {
    $vectorSearch: {
      index: "pca_64_vector_search",
      path: "pca_64d",
      queryVector: <64-d vector>,
      numCandidates: 500,
      limit: 10
    }
  },
  {
    $project: {
      _id: 1, obsid: 1, source_name: 1,
      source_type: 1, source_type_category: 1,
      umap_2d: 1, event_list: 1,
      hard_hs: 1, hard_hm: 1, hard_ms: 1,
      flux_significance_b: 1, var_index_b: 1,
      bb_kt: 1, powlaw_gamma: 1,
      powlaw_stat: 1, bb_stat: 1, brems_stat: 1, apec_stat: 1,
      score: { $meta: "vectorSearchScore" }
    }
  }
])
```

Returns 10 neighbours with cosine-similarity scores in [0, 1] (Atlas wraps
cosine to that range).

The index definition is in `data/atlas_indexes/pca_64_vector_search.json`
and is created automatically by `data/ingest/load_into_mongo.py --atlas`.

### Local Mongo (community edition, `MONGODB_MODE=local`)

Atlas Vector Search is not available in community-edition Mongo, so the
webapp falls back to a **brute-force cosine-similarity scan** in Node
(`webapp/src/app/api/nearest-neighbors/route.ts`). With the ~30-doc
sample dataset this is sub-millisecond. On a full 50k corpus expect ~50 ms
per query — still fast enough for interactive use, but worse than Atlas.
For full-corpus deployment we recommend Atlas.

## What the agent does

The Neighbour Analyst takes the 10 retrieved neighbours and:

1. Computes the same spectrum snapshot for each neighbour (see
   [`04_spectral_metrics.md`](./04_spectral_metrics.md)).
2. Re-ranks them by interpretable astrophysical distance (deltas in E50,
   hardness ratios, GL index, etc.) rather than just embedding distance.
3. Picks the top 3-5 most-similar neighbours.
4. Hands GPT-5 the snapshots side-by-side and asks for:
   - The dominant classification implied by the neighbours.
   - Confidence based on neighbour agreement and similarity scores.
   - Reasoning chain referencing specific neighbour features.

The agent is implemented at `service/src/agents/neighbor.py`. The prompt
template lives at the bottom of that file (`_create_analysis_prompt`).

## Similarity metric

```
sim(A, B) = (A · B) / (||A|| · ||B||)         (cosine)

interpretation
  0.90 -- 1.00 : essentially the same source class
  0.80 -- 0.90 : very similar (usually same class)
  0.70 -- 0.80 : moderately similar
  < 0.70       : unrelated, treat as a red herring
```

## Limitations

- The embedding is only as good as the fine-tuned model. Outlier source
  classes that are under-represented in the training corpus will retrieve
  unhelpful neighbours.
- 10 is a magic number chosen to balance prompt length vs information; the
  re-ranking step usually selects 3-5 of them for the actual analysis.
- The neighbour analysis is skipped entirely when the source has no
  `pca_64d` embedding (e.g. user-uploaded sources whose observation window
  was too short for the model server to compute one).
