# Minimal Payload Strategy for Bulk Analysis

## Overview

The bulk analysis script has been updated to send **ONLY raw observational data** to the AI, excluding all pre-computed metadata and derived classifications. This ensures the AI analyzes sources from scratch without seeing "answer keys."

## What is Sent to the AI (✅ Included)

The `data_obj` payload now contains **ONLY** these 7 fields:

```json
{
  "_id": "6814624c5072697270caf71a",
  "obsid": 8596,
  "source_name": "2CXO J033226.6-274013",
  "event_list": [[time, energy], ...],           // Pruned (8-hour window)
  "original_event_list": [[time, energy], ...],  // Full, unprocessed
  "pca_64d": [0.218, 0.275, ...],               // 64D PCA embedding
  "umap_2d": [5.227, 9.997]                      // 2D UMAP coordinates
}
```

### Field Purposes

- **`_id`**: Unique identifier for tracking
- **`obsid`**: Observation ID for reference
- **`source_name`**: Source designation (2CXO catalog name)
- **`event_list`**: Processed photon events (time, energy pairs) - 8h window
- **`original_event_list`**: Full photon events - complete observation
- **`pca_64d`**: 64-dimensional PCA embedding (for similarity, NOT classification)
- **`umap_2d`**: 2D UMAP projection (for visualization reference only)

## What is Excluded from AI (❌ Not Sent)

All pre-computed metadata fields are **excluded** to prevent data leakage:

### Spectral Fit Statistics
- ❌ `powlaw_stat` - Power-law C-statistic
- ❌ `bb_stat` - Blackbody C-statistic
- ❌ `brems_stat` - Bremsstrahlung C-statistic
- ❌ `apec_stat` - APEC plasma C-statistic

### Model Parameters
- ❌ `powlaw_gamma` - Power-law photon index
- ❌ `powlaw_nh` - Power-law hydrogen column density
- ❌ `powlaw_ampl` - Power-law amplitude
- ❌ `brems_kt` - Bremsstrahlung temperature
- ❌ `bb_kt` - Blackbody temperature
- ❌ `bb_nh` - Blackbody column density
- ❌ `bb_ampl` - Blackbody amplitude
- ❌ `apec_kt` - APEC temperature
- ❌ `apec_nh` - APEC column density
- ❌ `apec_norm` - APEC normalization
- ❌ `apec_abund` - APEC abundance
- ❌ `apec_z` - APEC redshift

### Hardness Ratios
- ❌ `hard_hs` - Hard/Soft ratio
- ❌ `hard_hm` - Hard/Medium ratio
- ❌ `hard_ms` - Medium/Soft ratio

### Pre-computed Classifications
- ❌ `source_type` - Source classification (AGN, Star, etc.)
- ❌ `source_type_category` - Broad category
- ❌ `thermal_classification` - Thermal vs non-thermal
- ❌ `recommended_model` - Best-fit model recommendation
- ❌ `powlaw_gamma_lolim` - Confidence limits
- ❌ `powlaw_gamma_hilim` - Confidence limits

### Observational Metadata
- ❌ `ra`, `dec` - Sky coordinates
- ❌ `obi` - Observation interval
- ❌ `region_id` - Extraction region ID
- ❌ `src_cnts_aper_b` - Source counts
- ❌ `flux_significance_b` - Flux significance
- ❌ `flux_aper_b` - Aperture flux
- ❌ `flux_bb_aper_b` - Blackbody flux
- ❌ `theta` - Off-axis angle
- ❌ `gti_mjd_obs` - Observation date
- ❌ `var_prob_b` - Variability probability
- ❌ `var_index_b` - Variability index
- ❌ `match_type` - Catalog match type
- ❌ `significance` - Overall detection significance

## Why This Approach?

### 1. **Prevents Data Leakage**
The AI doesn't see:
- Pre-computed source types (`source_type: "AGN"`)
- Recommended models (`recommended_model: "bremsstrahlung"`)
- Thermal classifications (`thermal_classification: "thermal"`)

This ensures the AI makes independent classifications based on the raw data.

### 2. **True Evaluation**
The AI must:
- Analyze the event list to determine spectral properties
- Infer source type from spectral characteristics
- Recommend models based on its own analysis
- Not simply regurgitate pre-computed answers

### 3. **Backend Still Has Full Data**
The backend's `spectrum_processor.py` **recalculates** all metadata:
- Extracts spectral features from event lists
- Computes hardness ratios
- Fits spectral models
- Generates recommendations

So the AI sees the **recalculated** values, not the input values.

## Data Flow

```
input_sources.json
  (Contains ALL metadata - 50+ fields)
       ↓
[bulk_metadata_analysis.py]
  Filters to 7 essential fields only
       ↓
Backend API Payload
  {_id, obsid, source_name, event_list, original_event_list, pca_64d, umap_2d}
       ↓
Backend spectrum_processor.py
  Recalculates: hardness ratios, spectral fits, variability, etc.
       ↓
MetadataAnalyst (OpenAI)
  Receives recalculated metadata, NOT input metadata
       ↓
Output Results
  AI's independent analysis
```

## Verification

Each output result includes a `payload_fields_sent` field showing exactly what was sent:

```json
{
  "source_id": "6814624c5072697270caf71a",
  "source_name": "2CXO J033226.6-274013",
  "status": "success",
  "payload_fields_sent": [
    "_id",
    "obsid", 
    "source_name",
    "event_list",
    "original_event_list",
    "pca_64d",
    "umap_2d"
  ],
  "metadata_analysis": "...",
  "final_answer": "..."
}
```

## Script Output

When running the bulk analysis, you'll see:

```
================================================================================
🚀 AstroMind Bulk Metadata Analysis
================================================================================
API URL:      http://localhost:8000
Input:        input_sources.json
Output:       output_results.json
Agents:       MetadataAnalyst + Critic
Concurrency:  4 parallel requests

📦 Payload Strategy: MINIMAL DATA ONLY
   ✅ Sending: _id, obsid, source_name, event_list, original_event_list, embeddings
   ❌ Excluding: ALL pre-computed metadata (spectral stats, hardness ratios, etc.)
   🎯 Goal: AI analyzes from scratch without seeing pre-computed answers
================================================================================

[1/100] Processing: 2CXO J033226.6-274013 (ID: 6814624c5072697270caf71a)
📡 Sending request to: http://localhost:8000/v1/chat/stream
🔧 Agent config: MetadataAnalyst=True, Critic=True, All others=False
📦 Data object keys: ['_id', 'obsid', 'source_name', 'event_list', 'original_event_list', 'pca_64d', 'umap_2d']
   ✅ Sending ONLY raw event data (no pre-computed metadata)
```

## Comparison: Before vs After

### Before (❌ Data Leakage)
```python
payload = {
    "data_obj": source_data,  # ALL 50+ fields including answers!
    # ...
}
```

Input included:
- ✅ Event lists
- ❌ `source_type: "AGN"` (the answer!)
- ❌ `recommended_model: "bremsstrahlung"` (the answer!)
- ❌ `hard_hs: -0.239` (pre-computed)
- ❌ `powlaw_gamma: 1.994` (pre-computed)

### After (✅ Clean Evaluation)
```python
data_obj = {
    "_id": source_data.get("_id"),
    "obsid": source_data.get("obsid"),
    "source_name": source_data.get("source_name"),
    "event_list": source_data.get("event_list", []),
    "original_event_list": source_data.get("original_event_list", []),
    "pca_64d": source_data.get("pca_64d"),
    "umap_2d": source_data.get("umap_2d"),
}

payload = {
    "data_obj": data_obj,  # ONLY 7 essential fields
    # ...
}
```

Input includes:
- ✅ Event lists (raw photon data)
- ✅ Embeddings (for context only)
- ❌ NO source_type
- ❌ NO recommended_model
- ❌ NO pre-computed spectral parameters

## Testing the Changes

Run the bulk analysis:

```bash
cd scripts/bulk_eval/
python3 bulk_metadata_analysis.py --concurrent 2
```

Check the output:

```bash
# Verify minimal payload
jq '.[0].payload_fields_sent' output_results.json

# Expected output:
# [
#   "_id",
#   "obsid",
#   "source_name",
#   "event_list",
#   "original_event_list",
#   "pca_64d",
#   "umap_2d"
# ]
```

## Summary

✅ **Clean evaluation**: AI doesn't see pre-computed answers  
✅ **Independent analysis**: AI must infer from raw event data  
✅ **Backend recalculates**: Spectral features computed fresh  
✅ **Verifiable**: Output includes `payload_fields_sent` field  
✅ **Transparent**: Console shows exactly what's being sent  

This approach ensures a **fair evaluation** of the AI's ability to analyze astronomical sources from first principles! 🎯

