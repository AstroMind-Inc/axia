# MongoDB Data Extraction Script

This script extracts source data from the MongoDB `user_uploaded_sources` collection based on (obsid, source_name) pairs in `test_data.csv`.

## Purpose

The script:
1. Reads `test_data.csv` to get (obsid, source_name) combinations
2. Connects to MongoDB and queries the `user_uploaded_sources` collection
3. Extracts matching objects from the `objects` array within each dataset
4. Merges metadata from CSV with MongoDB data
5. Generates a JSON array suitable for use with `bulk_metadata_analysis.py`

## Prerequisites

### Install Dependencies

```bash
pip install -r requirements.txt
```

Or if using Poetry from the project root:

```bash
poetry install
```

## Input File

**test_data.csv** - CSV file with the following columns:
- `obsid` - Observation ID (integer)
- `source_name` - Source name (string)
- `source_type` - Type of astronomical source
- `source_type_category` - Category classification
- `flux_significance_b` - Flux significance
- `powlaw_stat`, `bb_stat`, `brems_stat`, `apec_stat` - Spectral fit statistics
- `powlaw_gamma`, `powlaw_nh`, `powlaw_ampl` - Power law model parameters
- `brems_kt` - Bremsstrahlung temperature
- `bb_kt`, `bb_nh`, `bb_ampl` - Blackbody model parameters
- `apec_kt`, `apec_nh`, `apec_norm`, `apec_abund`, `apec_z` - APEC model parameters
- `hard_hs`, `hard_hm`, `hard_ms` - Hardness ratios
- `var_index_b` - Variability index

## Output File

**../input_sources.json** - JSON array containing:
- All fields from the CSV (metadata)
- `event_list` - Pruned event list (8-hour window) from MongoDB
- `original_event_list` - Full event list from MongoDB
- `pca_64d` - 64-dimensional PCA embedding from MongoDB
- `umap_2d` - 2D UMAP embedding from MongoDB
- `name` - Display name (format: "{obsid} - {source_name}")
- Any other fields present in the MongoDB objects

## MongoDB Collection Structure

The script queries **two collections** in the `filedata` database:

### Collection 1: `filedata.raw_events`

Contains original event lists and all observational metadata:

```json
{
  "_id": ObjectId("..."),
  "obsid": 12345,
  "source_name": "2CXO J...",
  "event_list": [[time, energy], ...],  // This becomes original_event_list
  "ra": 123.456,
  "dec": -12.345,
  "flux_aper_b": 1.5e-14,
  "src_cnts_aper_b": 100.5,
  "powlaw_gamma": 2.1,
  "bb_kt": 0.5,
  "hard_hs": -0.5,
  "hard_hm": 0.2,
  "hard_ms": -0.3,
  "var_index_b": 0,
  "theta": 5.2,
  ...
}
```

### Collection 2: `filedata.51k_v2_shuffled`

Contains processed event lists and embeddings:

```json
{
  "obsid": 12345,
  "source_name": "2CXO J...",
  "event_list": [[time, energy], ...],  // Pruned, 8-hour window
  "pca_64d": [0.1, 0.2, ..., 0.05],     // 64D PCA embedding
  "umap_2d": [10.5, 8.3],               // 2D UMAP coordinates
  "theta": 5.2,
  ...
}
```

### Data Merging Strategy

The script merges data from both collections:

1. **Base data** from `raw_events`: All observational metadata and original event_list
2. **Rename**: `raw_events.event_list` → `original_event_list`
3. **Add from** `51k_v2_shuffled`: `event_list` (processed), `pca_64d`, `umap_2d`
4. **Override** with CSV metadata where present (takes precedence)

## Usage

```bash
cd scripts/bulk_eval/get_data/
python extract_from_mongodb.py
```

## Configuration

Edit the script constants if needed:

```python
MONGODB_URI = "mongodb+srv://..."
DATABASE_NAME = "filedata"
COLLECTION_RAW = "raw_events"           # Original event_list + metadata
COLLECTION_PROCESSED = "51k_v2_shuffled"  # Processed event_list + embeddings
CSV_FILE = "processed_test_data.csv"
OUTPUT_JSON = "../input_sources.json"
TOP_N_RECORDS = 100  # Limit to top N records
```

## Data Merging Strategy

The script merges data from two sources:

1. **CSV metadata** (takes precedence):
   - Spectral fit statistics
   - Model parameters
   - Hardness ratios
   - Variability indices

2. **MongoDB data**:
   - Event lists (pruned and original)
   - Embeddings (PCA, UMAP)
   - Other source-specific fields

If a field exists in both CSV and MongoDB, the CSV value is used (except for `obsid` and `source_name` which always come from MongoDB for matching purposes).

## Output Example

```json
[
  {
    "_id": "test_1",
    "obsid": 10556,
    "source_name": "2CXO J174527.8-290210",
    "source_type": "X",
    "source_type_category": "Other",
    "flux_significance_b": 5.028571429,
    "powlaw_stat": null,
    "bb_stat": null,
    "hard_hs": 0.99937539,
    "hard_hm": 0.99937539,
    "hard_ms": -0.061211743,
    "var_index_b": 0.0,
    "event_list": [[time, energy], ...],
    "original_event_list": [[time, energy], ...],
    "pca_64d": [0.123, -0.456, ...],
    "umap_2d": [10.5, 8.9],
    "name": "10556 - 2CXO J174527.8-290210"
  }
]
```

## Error Handling

The script handles:
- Missing MongoDB documents
- Invalid CSV entries (missing obsid or source_name)
- NaN values in CSV (converted to `null` in JSON)
- Connection failures
- Missing required fields (event_list)

Sources that cannot be found or have errors are logged and skipped.

## Troubleshooting

### Connection Issues

If you get connection errors:
- Check the MongoDB URI is correct
- Verify network access to MongoDB Atlas
- Ensure IP address is whitelisted in MongoDB Atlas

### No Sources Found

If no sources are extracted:
- Verify the CSV has correct (obsid, source_name) pairs
- Check that the data exists in the `user_uploaded_sources` collection
- Confirm the collection name and database name are correct

### Missing Fields

If extracted objects are missing fields:
- Check that the MongoDB objects have the required fields
- Verify embeddings were generated during upload
- Ensure `original_event_list` and `event_list` exist in MongoDB

