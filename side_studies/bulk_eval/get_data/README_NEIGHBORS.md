# Add Neighbors Script

## Overview

The `add_neighbors.py` script enriches the `input_sources.json` file by adding nearest neighbors to each source using MongoDB Atlas Vector Search.

## Purpose

After extracting sources from MongoDB, you need to add their nearest neighbors for the multi-agent analysis (specifically for the NeighborAnalyst agent).

## How It Works

For each source in `input_sources.json`:
1. Extracts the `pca_64d` vector (64-dimensional PCA embedding)
2. Uses MongoDB Atlas Vector Search to find the 10 most similar sources
3. Excludes the source itself from results
4. Adds the neighbors array to the source object

## Vector Search Details

- **Index**: `pca_64_vector_search` (MongoDB Atlas Vector Search index)
- **Vector Field**: `pca_64d` (64-dimensional float array)
- **Collection**: `filedata.51k_v2_shuffled`
- **Algorithm**: Cosine similarity (via Atlas Vector Search)
- **Candidates**: 500 (for high-quality results)
- **Results**: Top 10 most similar sources

## Prerequisites

### 1. MongoDB Atlas Vector Search Index

Ensure you have a vector search index named `pca_64_vector_search` on the collection:

```javascript
// MongoDB Atlas Vector Search Index Definition
{
  "fields": [
    {
      "numDimensions": 64,
      "path": "pca_64d",
      "similarity": "cosine",
      "type": "vector"
    }
  ]
}
```

### 2. Environment Variable

Set your MongoDB connection string:

```bash
export MONGODB_CONNECTION_STRING="mongodb+srv://user:pass@cluster.mongodb.net/"
```

## Usage

### Option 1: Direct execution
```bash
cd scripts/bulk_eval/get_data/
python3 add_neighbors.py
```

### Option 2: Helper script
```bash
cd scripts/bulk_eval/get_data/
./run_add_neighbors.sh
```

## Configuration

Edit the top of `add_neighbors.py`:

```python
# MongoDB connection
MONGODB_URI = os.getenv("MONGODB_CONNECTION_STRING", "mongodb://localhost:27017/")
DATABASE_NAME = "filedata"
COLLECTION_NAME = "51k_v2_shuffled"
VECTOR_INDEX_NAME = "pca_64_vector_search"

# File paths
INPUT_FILE = "../input_sources.json"
OUTPUT_FILE = "../input_sources_with_neighbors.json"

# Neighbor search parameters
NUM_NEIGHBORS = 10
VECTOR_SEARCH_CANDIDATES = 500
```

## Input/Output

### Input: `scripts/bulk_eval/input_sources.json`

```json
[
  {
    "_id": "6814624c5072697270caeb78",
    "source_name": "2CXO J162623.3-242059",
    "obsid": 17249,
    "event_list": [[...], [...]],
    "original_event_list": [[...], [...]],
    "pca_64d": [0.123, -0.456, ...],
    "umap_2d": [5.2, 8.9]
  }
]
```

### Output: `scripts/bulk_eval/input_sources_with_neighbors.json`

```json
[
  {
    "_id": "6814624c5072697270caeb78",
    "source_name": "2CXO J162623.3-242059",
    "obsid": 17249,
    "event_list": [[...], [...]],
    "original_event_list": [[...], [...]],
    "pca_64d": [0.123, -0.456, ...],
    "umap_2d": [5.2, 8.9],
    "neighbors": [                         // ← ADDED
      {
        "_id": "neighbor_id_1",
        "obsid": 17250,
        "source_name": "2CXO J162600.0-242100",
        "event_list": [[...], [...]],      // ← CRITICAL: Includes event_list
        "hard_hs": -0.5,
        "hard_hm": 0.3,
        "hard_ms": 0.1,
        "flux_significance_b": 5.2,
        "var_index_b": 0.12,
        "powlaw_stat": 0.82,
        "bb_stat": 0.95,
        "brems_stat": 0.88,
        "apec_stat": 0.91,
        "powlaw_gamma": 2.1,
        "bb_kt": 0.5,
        "recommended_model": "powlaw",
        "score": 0.9856                    // ← Similarity score
      }
      // ... 9 more neighbors
    ]
  }
]
```

## Neighbor Fields Included

Each neighbor includes:

### Essential Fields
- `_id` - MongoDB ObjectId (as string)
- `obsid` - Observation ID
- `source_name` - Source name
- **`event_list`** - Event data (CRITICAL for NeighborAnalyst!)

### Spectral Properties
- `hard_hs`, `hard_hm`, `hard_ms` - Hardness ratios
- `flux_significance_b` - Flux significance
- `var_index_b` - Variability index

### Model Parameters
- `bb_kt` - Blackbody temperature
- `powlaw_gamma` - Power law photon index
- `brems_kt` - Bremsstrahlung temperature
- `apec_kt` - APEC temperature

### Model Statistics
- `powlaw_stat`, `bb_stat`, `brems_stat`, `apec_stat` - Fit statistics
- `powlaw_nh`, `apec_nh`, `bb_nh` - Hydrogen column densities

### Classification
- `source_type` - Object type (if available)
- `source_type_category` - Type category
- `recommended_model` - Best-fit model

### Similarity
- `score` - Vector search similarity score (0-1, higher = more similar)

## Performance

- **Processing time**: ~2-5 seconds per source (depends on MongoDB latency)
- **For 100 sources**: ~3-8 minutes total
- **Network I/O**: Main bottleneck (vector search query to MongoDB Atlas)

## Error Handling

### Sources Without pca_64d Vector
```
[5/100] 2CXO J123456.7+890123
   ⚠️  No pca_64d vector available - skipping neighbors
```
→ Source is included with empty `neighbors: []` array

### No Neighbors Found
```
[10/100] 2CXO J234567.8-012345
   ⚠️  No neighbors found
```
→ Source is included with empty `neighbors: []` array

### MongoDB Connection Error
```
❌ Error connecting to MongoDB: connection timeout
```
→ Check `MONGODB_CONNECTION_STRING` environment variable

### Vector Search Index Missing
```
❌ Error in vector search: index not found
```
→ Create the `pca_64_vector_search` index in MongoDB Atlas

## Example Output

```
================================================================================
ADD NEAREST NEIGHBORS TO INPUT SOURCES
================================================================================

📂 Input:  ../input_sources.json
📂 Output: ../input_sources_with_neighbors.json
🔍 Collection: filedata.51k_v2_shuffled
🎯 Neighbors per source: 10

📥 Loading input sources...
✅ Loaded 100 source(s)

🔌 Connecting to MongoDB...
✅ Connected to MongoDB
✅ Using collection: filedata.51k_v2_shuffled

================================================================================
PROCESSING SOURCES
================================================================================

[1/100] 2CXO J162623.3-242059 (ID: 6814624c5072697270caeb78)
   ✅ Found 10 neighbor(s)

[2/100] 2CXO J095546.5+694040 (ID: 6814624c5072697270caeb79)
   ✅ Found 10 neighbor(s)

[3/100] 2CXO J093239.9+790630 (ID: 6814624c5072697270caeb7a)
   ✅ Found 10 neighbor(s)

...

================================================================================
SAVING RESULTS
================================================================================

✅ Saved enriched sources to: ../input_sources_with_neighbors.json
📊 File size: 12.45 MB

================================================================================
SUMMARY
================================================================================
Total sources:           100
✅ With neighbors:       98
⚠️  No vector:            2
⚠️  No neighbors found:   0
❌ Errors:               0

================================================================================
SAMPLE NEIGHBOR (from first source)
================================================================================
Source: 2CXO J162623.3-242059
Neighbor: 2CXO J162600.0-242100 (score: 0.9856)
Fields included:
  - _id: str
  - apec_nh: float
  - apec_stat: float
  - bb_kt: float
  - bb_nh: float
  - bb_stat: float
  - brems_kt: float
  - brems_stat: float
  - event_list: [51 items]
  - flux_significance_b: float
  - hard_hm: float
  - hard_hs: float
  - hard_ms: float
  - obsid: int
  - powlaw_gamma: float
  - powlaw_nh: float
  - powlaw_stat: float
  - recommended_model: str
  - score: float
  - source_name: str
  - source_type: str
  - var_index_b: float

✅ Neighbor enrichment complete!
```

## Integration with Bulk Analysis

After running this script:

1. **Update `bulk_metadata_analysis.py`** to use the new file:
   ```python
   INPUT_FILE = "input_sources_with_neighbors.json"
   ```

2. **Enable all agents**:
   ```python
   "agent_config": {
       "eventAnalyst": True,
       "metadataAnalyst": True,
       "neighborAnalyst": True,    # Now enabled!
       "critic": True,
       "toolAgent": True
   }
   ```

3. **Update neighbors in payload**:
   ```python
   "neighbors": source_data.get("neighbors", [])  # Get from source data
   ```

## Troubleshooting

### Issue: "Collection not found"
**Solution:** Verify the collection name:
```python
COLLECTION_NAME = "51k_v2_shuffled"  # Update if different
```

### Issue: "Index not found" error
**Solution:** Create the vector search index in MongoDB Atlas:
1. Go to Atlas → Search → Create Search Index
2. Select "Vector Search"
3. Use index name: `pca_64_vector_search`
4. Field: `pca_64d`, Dimensions: 64, Similarity: cosine

### Issue: Very slow processing
**Solution:** 
- Check network latency to MongoDB Atlas
- Reduce `VECTOR_SEARCH_CANDIDATES` (e.g., from 500 to 200)
- Use a MongoDB instance closer to your location

### Issue: Neighbors missing event_list
**Solution:** This shouldn't happen if the projection is correct. Check that the collection has `event_list` data:
```javascript
db.51k_v2_shuffled.findOne({}, {event_list: 1})
```

## See Also

- `extract_from_mongodb.py` - Extracts initial source data
- `../bulk_metadata_analysis.py` - Uses the enriched data for analysis
- `../WORKFLOW.md` - Complete workflow documentation

## Next Steps

After running this script:
1. Verify the output file: `input_sources_with_neighbors.json`
2. Update `bulk_metadata_analysis.py` to use the new file
3. Enable all agents in the bulk analysis configuration
4. Run the full multi-agent analysis!

