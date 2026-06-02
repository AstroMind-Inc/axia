# Flaring Sources Extraction

## Summary

Successfully extracted **25 out of 25** flaring sources from MongoDB `appdata.user_uploaded_sources` collection!

### Success Rate: 100% ✅

## Results

### Files Created:
1. **`extract_flaring_sources.py`** - Extraction script
2. **`flaring_sources_extracted.json`** - Output data (13.34 MB)

### Data Extracted:
- **Total sources found:** 25/25 (100%)
- **Sources not found:** 0
- **All sources successfully matched** by composite key (obsid, source_name)

### Data Fields Extracted:
Each source contains:
- `_id`: MongoDB object ID
- `obsid`: Observation ID
- `source_name`: Source name (2CXO J...)
- `event_list`: Processed event list (8-hour window, pruned)
- `original_event_list`: Full original event list
- `pca_64d`: 64-dimensional PCA embedding
- `umap_2d`: 2D UMAP coordinates
- `ra`: Right Ascension
- `dec`: Declination

### Notable Observations:

#### Sources with Missing Embeddings (4 sources):
These sources have `original_event_list` but no `event_list` or embeddings:
1. **2CXO J163553.8-472540** (obsid: 3877) - 18,446 original events, no embeddings
2. **2CXO J025616.7+585756** (obsid: 7151) - 647 original events, no embeddings
3. **2CXO J095959.4+024646** (obsid: 15211) - 450 original events, no embeddings
4. **2CXO J134856.4+263944** (obsid: 24604) - 2,597 original events, no embeddings

*These likely failed the 8-hour observation window requirement or embedding generation step.*

#### Event Count Statistics:
- **Highest event count:** 2CXO J140828.9-270328 (obsid: 12884) - 53,737 original events
- **Lowest event count (with embeddings):** 2CXO J151457.6+364817 (obsid: 3988) - 183 original events
- **Most processed events:** 2CXO J122531.5+130357 (obsid: 803) - 16,790 processed, 29,510 original

## Usage

### Run the extraction script:
```bash
cd scripts/bulk_eval/get_flaring_sources
poetry run python extract_flaring_sources.py
```

### Input:
- `sources.json` - List of 25 (obsid, source_name) pairs

### Output:
- `flaring_sources_extracted.json` - Extracted source data in format compatible with bulk analysis scripts

## Next Steps

The extracted data can be used with:
1. `bulk_metadata_analysis.py` - Run PLLM multi-agent analysis
2. `bulk_openai_direct.py` - Run OpenAI direct analysis
3. Any other bulk evaluation scripts that accept the standard input format

## Technical Details

### MongoDB Query Strategy:
The script uses `$elemMatch` to efficiently search through nested `objects` arrays:
```python
query = {
    "objects": {
        "$elemMatch": {
            "obsid": obsid,
            "source_name": source_name
        }
    }
}
```

This approach:
- Handles the nested structure efficiently
- Matches on composite key (obsid + source_name)
- Extracts only the matching object from the array
- Works across all 44 documents in the collection

### Collection Structure:
- **Database:** `appdata`
- **Collection:** `user_uploaded_sources`
- **Total documents:** 44
- **Structure:** Each document contains multiple sources in `objects` array
