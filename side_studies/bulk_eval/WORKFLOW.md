# Bulk Analysis Workflow

Complete workflow for extracting data from MongoDB and running bulk metadata analysis.

## Overview

This workflow consists of three main steps:
0. **Data Cleanup**: Filter and sort CSV data by quality
1. **Data Extraction**: Extract source data from MongoDB based on cleaned CSV
2. **Bulk Analysis**: Run metadata analysis on the extracted sources

## Directory Structure

```
scripts/bulk_eval/
├── get_data/
│   ├── test_data.csv              # Original input CSV (1000+ records, unsorted)
│   ├── cleanup_csv.py             # Script to clean and sort CSV
│   ├── run_cleanup.sh             # Helper script to run cleanup
│   ├── processed_test_data.csv    # Cleaned CSV (filtered, sorted by quality)
│   ├── extract_from_mongodb.py    # Script to extract from MongoDB
│   ├── run_extraction.sh          # Helper script to run extraction
│   ├── requirements.txt           # Python dependencies
│   ├── README.md                  # Extraction documentation
│   └── README_CLEANUP.md          # Cleanup documentation
├── input_sources.json             # Output of extraction / Input for analysis
├── output_results.json            # Output of bulk analysis
├── bulk_metadata_analysis.py      # Bulk analysis script
├── run_analysis.sh                # Helper script to run analysis
├── README_BULK_ANALYSIS.md        # Analysis documentation
├── PAYLOAD_STRUCTURE.md           # API payload documentation
└── WORKFLOW.md                    # This file

```

## Step 0: Data Cleanup (Optional but Recommended)

### What it does

Cleans `test_data.csv` by removing low-quality records and sorting by data completeness.

### Cleanup Process

1. **Filters out** records where `source_type` is:
   - Empty or "NaN" (no classification)
   - "X" (unknown/unclassified sources)
2. **Counts null columns** for each remaining record
3. **Sorts** by null count (ascending - best quality first)
4. **Saves** as `processed_test_data.csv`

### Why This Matters

- **Quality**: Removes ~215 records with unknown source types or incomplete data
- **Prioritization**: Top records have complete metadata (0-5 null fields)
- **Efficiency**: Focus analysis on well-characterized sources first

### Running Cleanup

```bash
cd scripts/bulk_eval/get_data/
./run_cleanup.sh
```

### Expected Output

```
Total records read: 1000
Excluded records:   215
  - Empty/NaN source_type: 26
  - source_type = 'X':     189
Kept records:       785

Null column statistics:
  - Minimum nulls: 0
  - Maximum nulls: 18
  - Average nulls: 9.36
```

See `get_data/README_CLEANUP.md` for detailed documentation.

---

## Step 1: Data Extraction from MongoDB

### What it does

Reads `processed_test_data.csv` (or `test_data.csv`) containing (obsid, source_name) pairs and extracts full source data from MongoDB's `user_uploaded_sources` collection.

### MongoDB Collections

The extraction queries **two collections** in the `filedata` database:

1. **`filedata.raw_events`**: 
   - Contains original event lists (full, unprocessed)
   - All observational metadata (ra, dec, flux, spectral fits, etc.)
   
2. **`filedata.51k_v2_shuffled`**:
   - Contains processed event lists (pruned, 8-hour window)
   - PCA and UMAP embeddings

Data is merged from both collections with CSV metadata taking precedence.

### Input: processed_test_data.csv

Cleaned CSV file (output from Step 0) with columns:
- `obsid`, `source_name` (required for matching)
- Spectral fit statistics: `powlaw_stat`, `bb_stat`, `brems_stat`, `apec_stat`
- Model parameters: `powlaw_gamma`, `bb_kt`, `apec_kt`, etc.
- Hardness ratios: `hard_hs`, `hard_hm`, `hard_ms`
- Variability: `var_index_b`
- Classification: `source_type`, `source_type_category`, `flux_significance_b`

### Output: input_sources.json

JSON array where each object contains merged data:
- **From `raw_events`**: `original_event_list` (full), ra, dec, flux measurements, spectral parameters
- **From `51k_v2_shuffled`**: `event_list` (pruned), `pca_64d`, `umap_2d`
- **From CSV**: Metadata overrides (spectral fits, hardness ratios, source type, etc.)

### Running Extraction

#### Option 1: Using the helper script

```bash
cd scripts/bulk_eval/get_data/
./run_extraction.sh
```

#### Option 2: Manual execution

```bash
cd scripts/bulk_eval/get_data/

# Install dependencies (if not already installed)
pip install -r requirements.txt

# Run extraction
python3 extract_from_mongodb.py
```

### Expected Output

```
======================================================================
MongoDB Source Extraction Script
======================================================================
📁 Working directory: /path/to/scripts/bulk_eval/get_data/

Step 1: Reading CSV file...
✅ Read 1000 (obsid, source_name) pairs from CSV

Step 2: Connecting to MongoDB...
✅ Connected to MongoDB successfully

Step 3: Extracting sources from MongoDB...
🔍 Searching for 1000 sources in MongoDB...
✅ [1/1000] 2CXO J174527.8-290210 (obsid=10556): events=45, original=True, pca=True, umap=True
...
✅ [1000/1000] ...

📊 Summary:
   Found: 950
   Not found: 50
   Total: 1000

Step 4: Saving to JSON file...
✅ Saved 950 sources to ../input_sources.json
   File size: 12.34 MB

======================================================================
✅ Extraction complete!
======================================================================
```

## Step 2: Bulk Metadata Analysis

### What it does

Sends each source from `input_sources.json` to the streaming backend endpoint with:
- **Enabled agents**: `metadataAnalyst` + `critic`
- **Disabled agents**: `eventAnalyst`, `neighborAnalyst`, `toolAgent`

### Input: input_sources.json

Generated by Step 1, containing source data with all required fields.

### Output: output_results.json

JSON array where each object contains:
- `source_id`: Unique identifier
- `obsid`: Observation ID
- `source_name`: Source name
- `metadata_analysis`: Output from MetadataAnalyst
- `critic_review`: Output from Critic agent
- `final_answer`: Synthesized final response
- `processing_steps`: List of agent activities
- `status`: "success" or "error"
- `error_message`: Error details if status is "error"

### Running Analysis

#### Option 1: Using the helper script (default 4 concurrent)

```bash
cd scripts/bulk_eval/
./run_analysis.sh
```

#### Option 2: Manual execution with custom concurrency

```bash
cd scripts/bulk_eval/

# With default concurrency (4)
python3 bulk_metadata_analysis.py

# With custom concurrency (e.g., 8)
python3 bulk_metadata_analysis.py --concurrent 8

# With custom input/output files
python3 bulk_metadata_analysis.py \
  --input my_input.json \
  --output my_output.json \
  --concurrent 10
```

### Expected Output

```
================================================================================
                    AstroMind Bulk Metadata Analysis
================================================================================

Configuration:
  📁 Input file:   input_sources.json
  📁 Output file:  output_results.json
  🌐 Backend URL:  http://localhost:8000
  🧵 Concurrency:  4 parallel requests

================================================================================

Loading input sources...
✅ Loaded 950 sources

Starting bulk analysis...

Processing: 950 sources

⏳ Progress: 4/950 (0.4%) | Success: 3 | Failed: 0 | Active: 4
✅ [1/950] 2CXO J174527.8-290210 (obsid=10556) - Success
✅ [2/950] 2CXO J033226.6-274013 (obsid=8596) - Success
...

================================================================================
                            Analysis Complete!
================================================================================

📊 Final Summary:
   Total sources:     950
   ✅ Successful:     945 (99.5%)
   ❌ Failed:         5 (0.5%)
   ⏱️  Total time:     15m 32s
   📄 Output saved:   output_results.json

================================================================================
```

## Complete Workflow Example

```bash
# Navigate to project root
cd <axia-root>

# Step 0: Clean the CSV (optional but recommended)
cd scripts/bulk_eval/get_data/
./run_cleanup.sh

# Step 1: Extract data from MongoDB
./run_extraction.sh

# Step 2: Run bulk analysis (go back to bulk_eval directory)
cd ..
./run_analysis.sh --concurrent 8

# Step 3: Review results
cat output_results.json | jq '.[0]'  # View first result
```

### Quick Start (All Steps)

```bash
cd scripts/bulk_eval/get_data/
./run_cleanup.sh && ./run_extraction.sh && cd .. && ./run_analysis.sh
```

## Configuration

### MongoDB Connection

Edit `get_data/extract_from_mongodb.py`:

```python
MONGODB_URI = "mongodb+srv://..."
DATABASE_NAME = "filedata"
COLLECTION_RAW = "raw_events"           # Original event_list
COLLECTION_PROCESSED = "51k_v2_shuffled"  # Processed event_list + embeddings
TOP_N_RECORDS = 100  # Limit to top N records
```

### Backend API

Edit `bulk_metadata_analysis.py`:

```python
BACKEND_URL = "http://localhost:8000"  # or your backend URL
ANALYSIS_PROMPT = "Your custom prompt..."
```

### Concurrency

Adjust the number of parallel requests based on your backend capacity:

```bash
# Conservative (safer for production)
python3 bulk_metadata_analysis.py --concurrent 2

# Moderate (default)
python3 bulk_metadata_analysis.py --concurrent 4

# Aggressive (requires powerful backend)
python3 bulk_metadata_analysis.py --concurrent 8
```

## Troubleshooting

### Extraction Issues

**Problem**: Sources not found in MongoDB

**Solution**:
- Verify data exists in `user_uploaded_sources` collection
- Check (obsid, source_name) pairs are correct
- Confirm collection name and database name

**Problem**: Missing event_list or embeddings

**Solution**:
- Re-upload the data through the frontend with embedding generation
- Check that the upload process completed successfully

### Analysis Issues

**Problem**: Backend connection refused

**Solution**:
- Ensure backend is running: `poetry run uvicorn main:app`
- Check `BACKEND_URL` in script
- Verify port is correct

**Problem**: "Chunk too big" error

**Solution**: Already fixed in current script using chunk-based streaming

**Problem**: Too many concurrent requests overwhelming backend

**Solution**: Reduce concurrency: `--concurrent 2`

## Data Flow Diagram

```
test_data.csv (1000 records, unsorted, includes "X" types)
       ↓
[cleanup_csv.py] — Step 0
       ↓
processed_test_data.csv (785 records, sorted by quality, limited to top 100)
       ↓
[extract_from_mongodb.py] — Step 1
       ↓
MongoDB Collection 1: filedata.raw_events (original_event_list + metadata)
MongoDB Collection 2: filedata.51k_v2_shuffled (event_list + embeddings)
       ↓
input_sources.json (Merged: original + processed event lists + embeddings + metadata)
       ↓
[bulk_metadata_analysis.py] — Step 2
       ↓
Backend API (/v1/chat/stream)
  ├─ MetadataAnalyst (uses data_obj → original_event_list + metadata)
  └─ Critic (reviews metadata analysis)
       ↓
output_results.json (Analysis results: metadata_analysis + critic_review + final_answer)
```

## Field Mapping

### From CSV to JSON (metadata fields)

| CSV Column | JSON Field | Notes |
|------------|------------|-------|
| obsid | obsid | Integer |
| source_name | source_name | String |
| source_type | source_type | String or null |
| source_type_category | source_type_category | Default "Other" |
| flux_significance_b | flux_significance_b | Float or null |
| powlaw_stat | powlaw_stat | Float or null |
| bb_stat | bb_stat | Float or null |
| brems_stat | brems_stat | Float or null |
| apec_stat | apec_stat | Float or null |
| powlaw_gamma | powlaw_gamma | Float or null |
| bb_kt | bb_kt | Float or null |
| hard_hs | hard_hs | Float or null |
| hard_hm | hard_hm | Float or null |
| hard_ms | hard_ms | Float or null |
| var_index_b | var_index_b | Float or null |

### From MongoDB to JSON (event and embedding data)

| MongoDB Field | JSON Field | Notes |
|---------------|------------|-------|
| event_list | event_list | Array of [time, energy] pairs (pruned, 8h) |
| original_event_list | original_event_list | Full event list |
| pca_64d | pca_64d | 64D PCA embedding array |
| umap_2d | umap_2d | 2D UMAP coordinates [x, y] |
| _id | _id | MongoDB ObjectId or custom ID |

## Agent Configuration

The bulk analysis uses the following agent configuration:

```json
{
  "eventAnalyst": false,      // Disabled - analyzes event_list with fine-tuned model
  "metadataAnalyst": true,    // ENABLED - analyzes spectral fits, hardness ratios
  "neighborAnalyst": false,   // Disabled - compares with neighbors
  "critic": true,             // ENABLED - reviews metadata analysis
  "toolAgent": false          // Disabled - uses external tools (SIMBAD, HIPS2FITS)
}
```

### Why This Configuration?

- **MetadataAnalyst**: Uses `data_obj.original_event_list` + all metadata fields for comprehensive spectral and source type analysis
- **Critic**: Reviews the metadata analysis for consistency and completeness
- **Others disabled**: Not needed for pure metadata evaluation; reduces processing time

## Next Steps

After running the complete workflow:

1. **Review Results**: Open `output_results.json` and spot-check entries
2. **Analyze Success Rate**: Check how many sources succeeded vs. failed
3. **Identify Patterns**: Look for common issues in failed entries
4. **Extract Insights**: Use the `metadata_analysis` and `critic_review` fields for your research
5. **Export for Analysis**: Convert to CSV or load into pandas for statistical analysis

## Further Reading

- `get_data/README.md` - Detailed extraction documentation
- `README_BULK_ANALYSIS.md` - Detailed analysis documentation
- `PAYLOAD_STRUCTURE.md` - API payload structure and field descriptions

