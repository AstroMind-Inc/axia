# Neighbor Enrichment for Flaring Sources

## Summary

Successfully enriched all **25 flaring sources** with nearest neighbor data using MongoDB Atlas Vector Search!

## Results

### Success Rate:
- ✅ **21 sources with neighbors** (10 neighbors each)
- ⚠️ **4 sources with empty neighbors []** (no embeddings available)
- **Total: 25/25 sources included in output**

## Files Created:

1. **`add_neighbors_to_flaring.py`** - Neighbor enrichment script
2. **`flaring_sources_with_neighbors.json`** - Output with neighbors (56.81 MB)

## Sources Without Neighbors:

These 4 sources don't have PCA embeddings, so neighbors couldn't be computed:
1. **2CXO J163553.8-472540** (obsid: 3877) - `neighbors: []`
2. **2CXO J025616.7+585756** (obsid: 7151) - `neighbors: []`
3. **2CXO J095959.4+024646** (obsid: 15211) - `neighbors: []`
4. **2CXO J134856.4+263944** (obsid: 24604) - `neighbors: []`

*These sources still have `original_event_list` and can be analyzed, but without neighbor comparison.*

## Neighbor Quality:

Average similarity scores for the 21 sources with neighbors:
- **Highest avg score:** 2CXO J050706.7-315211 (0.9512) - Very similar neighbors
- **Lowest avg score:** 2CXO J123625.3+621405 (0.8204) - More unique source
- **Overall range:** 0.8204 - 0.9512 (all excellent matches!)

## Neighbor Fields Included:

Each neighbor contains:
- **Identification:** `_id`, `obsid`, `source_name`, `source_type`, `source_type_category`
- **Event Data:** `event_list` (critical for NeighborAnalyst)
- **Hardness Ratios:** `hard_hs`, `hard_hm`, `hard_ms`
- **Flux & Variability:** `flux_significance_b`, `var_index_b`
- **Spectral Models:** `bb_kt`, `powlaw_gamma`, `brems_kt`, `apec_kt`
- **Fit Statistics:** `powlaw_stat`, `bb_stat`, `brems_stat`, `apec_stat`
- **NH Parameters:** `powlaw_nh`, `apec_nh`, `bb_nh`
- **Model Recommendation:** `recommended_model`
- **Similarity Score:** `score` (from vector search)

## Usage

### Run the script:
```bash
cd scripts/bulk_eval/get_flaring_sources
poetry run python add_neighbors_to_flaring.py
```

### Input:
- `flaring_sources_extracted.json` (25 sources)

### Output:
- `flaring_sources_with_neighbors.json` (25 sources with neighbors or empty array)

## Data Structure

```json
{
  "_id": "sss_1",
  "obsid": 957,
  "source_name": "2CXO J123605.1+622013",
  "event_list": [...],
  "original_event_list": [...],
  "pca_64d": [...],
  "umap_2d": [...],
  "ra": 189.02125,
  "dec": 62.33694,
  "neighbors": [
    {
      "_id": "6814624c5072697270ca02cd",
      "obsid": 2037,
      "source_name": "2CXO J231546.7-590315",
      "event_list": [...],
      "score": 0.8738,
      ...
    }
    // ... 9 more neighbors
  ]
}
```

## Technical Details

### Vector Search Configuration:
- **Index:** `pca_64_vector_search` (MongoDB Atlas Vector Search)
- **Vector Field:** `pca_64d` (64-dimensional PCA embeddings)
- **Search Collection:** `filedata.51k_v2_shuffled` (51,000+ sources)
- **Candidates:** 500 (for accurate results)
- **Neighbors per source:** 10

### Handling Missing Embeddings:
Following the same pattern as `input_sources_with_neighbors.json`:
- Sources without `pca_64d` → `neighbors: []`
- All 25 sources included in output
- Empty array allows scripts to handle gracefully

### Similarity Scores:
Scores range from 0-1, where:
- **0.95-1.0:** Nearly identical sources
- **0.85-0.95:** Very similar sources  
- **0.80-0.85:** Similar sources
- **< 0.80:** Less similar

Average score of 0.89 indicates excellent neighbor quality!

## Next Steps

The enriched file is ready for:
1. **Multi-agent analysis** with NeighborAnalyst enabled
2. **Comparative studies** between flaring and normal sources
3. **Similarity analysis** of flaring source characteristics

## Comparison with Original Dataset

| Metric | Original (1000 sources) | Flaring (25 sources) |
|--------|------------------------|---------------------|
| Total sources | 1000 | 25 |
| With neighbors | ~1000 | 21 |
| Without embeddings | ~21 | 4 |
| Avg neighbor score | 0.87 | 0.89 |
| File size | 7.8 GB | 56.81 MB |

The flaring sources have slightly higher average similarity scores, suggesting they may share more common characteristics!
