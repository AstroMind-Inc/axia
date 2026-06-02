# Merge Results Script

## Overview

The `merge_results.py` script combines multiple bulk analysis result files into a single flattened JSON file, keeping only essential fields.

## Purpose

After running bulk analysis in batches (e.g., 0-5, 5-20, 20-50), you need to:
1. Combine all result files into one
2. Remove verbose fields (agent_conversation, processing_steps)
3. Keep only essential analysis outputs

## Configuration

Edit the top of `merge_results.py`:

```python
# Input files to merge (in order)
INPUT_FILES = [
    "output_results_0_5.json",
    "output_results_5_20.json",
    "output_results_20_50.json",
]

# Output file
OUTPUT_FILE = "combined_results.json"

# Fields to keep
FIELDS_TO_KEEP = [
    "source_id",
    "source_name",
    "obsid",
    "status",
    "question",
    "payload_fields_sent",
    "timestamp",
    "metadata_analysis",
    "critic_review",
    "final_answer",
]
```

## Usage

### Option 1: Direct execution
```bash
cd scripts/bulk_eval/
python3 merge_results.py
```

### Option 2: Helper script
```bash
cd scripts/bulk_eval/
./run_merge.sh
```

## Output Format

### Original Result (Verbose)
```json
{
  "source_id": "...",
  "source_name": "...",
  "obsid": 17249,
  "status": "success",
  "question": "...",
  "metadata_analysis": "...",
  "critic_review": "...",
  "final_answer": "...",
  "agent_conversation": [
    {"agent": "MetadataAnalyst", "content": "...", ...},
    {"agent": "Critic", "content": "...", ...}
  ],
  "processing_steps": [
    {"agent": "MetadataAnalyst", "status": "completed", ...},
    ...
  ],
  "payload_fields_sent": [...],
  "timestamp": "..."
}
```

### Flattened Result (Clean)
```json
{
  "source_id": "...",
  "source_name": "...",
  "obsid": 17249,
  "status": "success",
  "question": "...",
  "payload_fields_sent": [...],
  "timestamp": "...",
  "metadata_analysis": "...",
  "critic_review": "...",
  "final_answer": "..."
}
```

## Features

### Automatic Handling
- ✅ Handles missing files gracefully (warns and continues)
- ✅ Handles malformed JSON (warns and skips)
- ✅ Handles both array and single object inputs
- ✅ Preserves field order for consistency
- ✅ Sets missing fields to `null` instead of omitting

### Statistics
The script provides:
- Total number of merged results
- Status breakdown (success/error)
- Output file size
- Sample of first result

### Example Output
```
================================================================================
MERGE AND FLATTEN BULK ANALYSIS RESULTS
================================================================================

[1/3] Reading: output_results_0_5.json
   ✅ Loaded 5 result(s)
   📦 Flattened to 10 fields per result

[2/3] Reading: output_results_5_20.json
   ✅ Loaded 15 result(s)
   📦 Flattened to 10 fields per result

[3/3] Reading: output_results_20_50.json
   ✅ Loaded 30 result(s)
   📦 Flattened to 10 fields per result

💾 Writing combined results to: combined_results.json
✅ Successfully merged 50 results

================================================================================
SUMMARY
================================================================================
Total results:       50
Fields per result:   10
Output file:         combined_results.json

Status breakdown:
  - success: 50

Output file size:    0.85 MB

================================================================================
SAMPLE RESULT (first entry)
================================================================================
  source_id: "6814624c5072697270caeb78"
  source_name: "2CXO J162623.3-242059"
  obsid: 17249
  status: "success"
  question: "You are being presented with event data and metadata..."
  payload_fields_sent: [7 items]
  timestamp: "2026-01-07T23:26:20.374468"
  metadata_analysis: "Summary answer (short)\n- Best s..."
  critic_review: "Short conclusion first\n- The metadata analysis is broadly reasona..."
  final_answer: "Short answer / summary\n- The spectrum is hard and best described by..."

✅ Merge complete!
```

## Adding More Result Files

Just edit the `INPUT_FILES` list:

```python
INPUT_FILES = [
    "output_results_0_5.json",
    "output_results_5_20.json",
    "output_results_20_50.json",
    "output_results_50_80.json",   # Add more files
    "output_results_80_100.json",
]
```

## Customizing Output Fields

To include/exclude fields, edit `FIELDS_TO_KEEP`:

```python
# Example: Add more fields
FIELDS_TO_KEEP = [
    "source_id",
    "source_name",
    "obsid",
    "status",
    "question",
    "payload_fields_sent",
    "timestamp",
    "metadata_analysis",
    "critic_review",
    "final_answer",
    "agent_conversation",  # Include if needed
]

# Example: Minimal output
FIELDS_TO_KEEP = [
    "source_id",
    "source_name",
    "metadata_analysis",
    "final_answer",
]
```

## Error Handling

### Missing Files
```
⚠️  Warning: File not found: output_results_50_80.json
```
Script continues with available files.

### Invalid JSON
```
⚠️  Warning: Invalid JSON in output_results_5_20.json: Expecting value: line 1 column 1 (char 0)
```
Script skips the file and continues.

### Empty Files
```
⚠️  Warning: No results found or file error
```
Script continues with other files.

## Integration with Workflow

### Complete Analysis Workflow

1. **Run bulk analysis in batches**
   ```bash
   # Batch 1
   python3 bulk_metadata_analysis.py  # START_INDEX=0, END_INDEX=5
   
   # Batch 2
   python3 bulk_metadata_analysis.py  # START_INDEX=5, END_INDEX=20
   
   # Batch 3
   python3 bulk_metadata_analysis.py  # START_INDEX=20, END_INDEX=50
   ```

2. **Merge all results**
   ```bash
   python3 merge_results.py
   # Output: combined_results.json (50 sources)
   ```

3. **Use combined results**
   ```bash
   # Now you have one clean file with all results
   cat combined_results.json | jq '.[] | {source_name, status}'
   ```

## Troubleshooting

### Issue: Script doesn't find input files
**Solution:** Make sure you're in the correct directory:
```bash
cd scripts/bulk_eval/
python3 merge_results.py
```

### Issue: Output file already exists
**Solution:** The script will overwrite it. Back it up first if needed:
```bash
cp combined_results.json combined_results.backup.json
python3 merge_results.py
```

### Issue: Out of memory
**Solution:** Process files individually or increase Python memory limit:
```bash
python3 -c "import resource; print(resource.getrlimit(resource.RLIMIT_AS))"
```

## File Sizes

Typical sizes:
- `output_results_0_5.json`: ~120 KB (5 sources, verbose)
- `output_results_5_20.json`: ~350 KB (15 sources, verbose)
- `output_results_20_50.json`: ~850 KB (30 sources, verbose)
- **`combined_results.json`: ~400 KB (50 sources, flattened)** ← Much smaller!

Flattening reduces file size by ~70% by removing verbose fields.

## Next Steps

After merging:
1. **Analyze results** - Use `jq` or Python to analyze the combined data
2. **Export to CSV** - Create another script to convert to CSV for spreadsheet analysis
3. **Generate report** - Create summary statistics, charts, etc.

## See Also

- `WORKFLOW.md` - Complete data processing workflow
- `README_BULK_ANALYSIS.md` - Bulk analysis script documentation
- `PAYLOAD_MINIMAL.md` - Payload structure documentation

