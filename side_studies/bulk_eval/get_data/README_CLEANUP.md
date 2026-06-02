# CSV Cleanup Script

This script cleans up `test_data.csv` by removing records with invalid source types and sorting by data completeness.

## Purpose

The `cleanup_csv.py` script:
1. **Filters out** records where `source_type` is:
   - Empty or missing
   - "NaN" (null value)
   - "X" (unknown/unclassified)
2. **Counts null columns** for each remaining record (excluding identifier columns)
3. **Sorts records** by null count in ascending order (records with least nulls first)
4. **Saves output** as `processed_test_data.csv`

## Why This Is Needed

### Problem with "X" Source Type

Records with `source_type = "X"` represent **unclassified** or **unknown** sources. These are not useful for metadata analysis because:
- No meaningful spectral model recommendations can be made
- Source type classification is ambiguous
- Most have incomplete metadata (high null counts)

### Data Quality Prioritization

By sorting by null count (ascending), we get:
- **Top records**: Complete metadata (all spectral fits, hardness ratios, model parameters)
- **Bottom records**: Sparse metadata (mostly NaN values)

This allows you to:
- Process high-quality data first
- Set quality thresholds (e.g., only process records with < 10 nulls)
- Focus analysis on well-characterized sources

## Usage

### Option 1: Using the helper script

```bash
cd scripts/bulk_eval/get_data/
./run_cleanup.sh
```

### Option 2: Manual execution

```bash
cd scripts/bulk_eval/get_data/
python3 cleanup_csv.py
```

## Input File

**test_data.csv** (1000+ records)
- Contains all uploaded sources from the frontend
- Includes records with source_type "X", "NaN", or empty
- Unsorted (arbitrary order)

## Output File

**processed_test_data.csv** (typically ~785 records)
- Only sources with valid, meaningful source types
- Sorted by data completeness (least nulls first)
- Ready for MongoDB extraction

## Example Output

```
======================================================================
CSV Cleanup Script
======================================================================
📥 Input file:  test_data.csv
📤 Output file: processed_test_data.csv

Step 1: Reading and filtering records...
   Total records read: 1000
   Excluded records:   215
     - Empty/NaN source_type: 26
     - source_type = 'X':     189
   Kept records:       785

Step 2: Counting null columns for each record...
Step 3: Sorting records by null count (ascending)...
   Null column statistics:
     - Minimum nulls: 0
     - Maximum nulls: 18
     - Average nulls: 9.36

   Top 5 records with least null columns:
     1. 2CXO J033226.6-274013 (obsid=8596, type=AGN, nulls=0)
     2. 2CXO J195908.0+403706 (obsid=17140, type=RSCVnV*, nulls=0)
     3. 2CXO J033211.3-275214 (obsid=12223, type=AGN, nulls=0)
     4. 2CXO J195923.0+404420 (obsid=17526, type=Radio, nulls=0)
     5. 2CXO J162623.3-242059 (obsid=17249, type=YSO, nulls=0)

   Bottom 5 records with most null columns:
     781. 2CXO J100202.7+025102 (obsid=15257, type=AGN, nulls=16)
     782. 2CXO J024240.2-000104 (obsid=344, type=HIIReg, nulls=17)
     783. 2CXO J130026.0+274951 (obsid=13995, type=Galaxy, nulls=17)
     784. 2CXO J203903.6+422529 (obsid=7444, type=YSO, nulls=18)
     785. 2CXO J203902.9+422415 (obsid=7444, type=YSO, nulls=18)

Step 4: Writing output CSV...
   ✅ Saved 785 records to processed_test_data.csv

📊 File size comparison:
   Input:  194.93 KB
   Output: 156.25 KB
   Reduction: 19.8%

📈 Source type distribution in output:
   QSO                 :  113 ( 14.4%)
   Star                :  110 ( 14.0%)
   YSO                 :   99 ( 12.6%)
   AGN                 :   93 ( 11.8%)
   HighMassXBin        :   37 (  4.7%)
   Galaxy              :   36 (  4.6%)
   TTauri*             :   24 (  3.1%)
   YSO_Candidate       :   24 (  3.1%)
   GlobCluster         :   20 (  2.5%)
   Seyfert2            :   19 (  2.4%)
   ... and 59 more types

======================================================================
✅ Cleanup complete!
======================================================================
```

## Statistics Explained

### Null Count Statistics

- **Minimum nulls (0)**: Records with complete metadata (all spectral fits, hardness ratios, etc.)
- **Maximum nulls (18)**: Records with only basic identification and very sparse metadata
- **Average nulls (9.36)**: On average, about 9 out of 21 countable fields are null

### Excluded Records Breakdown

From a typical 1000-record dataset:
- **189 records** excluded due to `source_type = "X"` (unclassified)
- **26 records** excluded due to missing/NaN source_type
- **785 records** retained (78.5%)

### Source Type Distribution

After cleanup, you'll see a distribution like:
- **QSO, AGN** (active galactic nuclei): ~25% combined
- **Stars** (Star, TTauri*, YSO, etc.): ~30% combined
- **Galaxies** (Galaxy, RadioG, Seyfert): ~10% combined
- **X-ray binaries** (HighMassXBin, LowMassXBin): ~5% combined
- **Other** (GlobCluster, HIIReg, etc.): ~30% combined

## Fields Excluded from Null Count

The following identifier fields are **not counted** as nulls (always required):
- `obsid` - Observation ID
- `source_name` - Source designation
- `source_type` - Astronomical source type
- `source_type_category` - Broad category

## Countable Fields (21 total)

These fields are checked for null/NaN values:
1. `flux_significance_b` - Flux significance
2. `powlaw_stat` - Power-law fit statistic
3. `bb_stat` - Blackbody fit statistic
4. `brems_stat` - Bremsstrahlung fit statistic
5. `apec_stat` - APEC (thermal plasma) fit statistic
6. `powlaw_gamma` - Power-law photon index
7. `powlaw_nh` - Power-law hydrogen column density
8. `powlaw_ampl` - Power-law amplitude
9. `brems_kt` - Bremsstrahlung temperature
10. `bb_kt` - Blackbody temperature
11. `bb_nh` - Blackbody hydrogen column density
12. `bb_ampl` - Blackbody amplitude
13. `apec_kt` - APEC temperature
14. `apec_nh` - APEC hydrogen column density
15. `apec_norm` - APEC normalization
16. `apec_abund` - APEC abundance
17. `apec_z` - APEC redshift
18. `hard_hs` - Hard/Soft hardness ratio
19. `hard_hm` - Hard/Medium hardness ratio
20. `hard_ms` - Medium/Soft hardness ratio
21. `var_index_b` - Variability index

## Integration with Workflow

### Before Cleanup

```
test_data.csv (1000 records, unsorted, includes "X" types)
```

### After Cleanup

```
processed_test_data.csv (785 records, sorted by completeness)
```

### Next Step: MongoDB Extraction

The `extract_from_mongodb.py` script **automatically uses** `processed_test_data.csv`:

```python
# In extract_from_mongodb.py
CSV_FILE = "processed_test_data.csv"  # Uses cleaned CSV by default
```

So the workflow becomes:

```bash
# 1. Clean the CSV
./run_cleanup.sh

# 2. Extract from MongoDB (automatically uses processed_test_data.csv)
./run_extraction.sh

# 3. Run bulk analysis
cd ..
./run_analysis.sh
```

## Customizing the Script

### Using Original CSV

If you want to use the original unfiltered CSV, edit `extract_from_mongodb.py`:

```python
CSV_FILE = "test_data.csv"  # Use original instead
```

### Adjusting Null Count Threshold

You can modify the extraction script to only process records with low null counts:

```python
# In extract_from_mongodb.py, after reading CSV:
csv_pairs = [pair for pair in csv_pairs if pair.get('_null_count', 0) < 10]
```

### Excluding Additional Source Types

Edit `cleanup_csv.py` to exclude more types:

```python
def should_exclude_record(row: Dict[str, str]) -> bool:
    source_type = row.get('source_type', '').strip()
    
    # Add more exclusions
    exclude_list = ['X', 'NaN', '', 'Unknown', 'Transient']
    return source_type in exclude_list or is_null_value(source_type)
```

## Backup

The `run_cleanup.sh` script automatically creates a backup:

```bash
test_data.csv.backup  # Created on first run
```

If you need to restore:

```bash
cp test_data.csv.backup test_data.csv
```

## Verification

Check the top and bottom records:

```bash
# View records with least nulls (best quality)
head -10 processed_test_data.csv

# View records with most nulls (lowest quality)
tail -10 processed_test_data.csv

# Count total records
wc -l processed_test_data.csv
```

## Performance

- **Speed**: Processes 1000 records in ~0.1 seconds
- **Memory**: Loads entire CSV into memory (typically < 1 MB)
- **Output**: Reduces file size by ~20% after filtering

## Troubleshooting

### No Records After Cleanup

If all records are excluded:
- Check that `source_type` column exists and has values
- Verify CSV format (comma-separated, proper headers)
- Look at excluded reasons in output

### Unexpected Null Counts

If null counts seem wrong:
- Check for empty strings vs. "NaN" strings
- Verify CSV has consistent formatting
- Review the `is_null_value()` function logic

### File Not Found

If script can't find input file:
- Ensure you're in the correct directory: `scripts/bulk_eval/get_data/`
- Check that `test_data.csv` exists
- Verify file permissions

## Next Steps

After running cleanup:

1. ✅ **Verify output**: Check `processed_test_data.csv` has expected records
2. ✅ **Extract from MongoDB**: Run `./run_extraction.sh`
3. ✅ **Run bulk analysis**: Use the extracted data for LLM analysis

See `../WORKFLOW.md` for the complete pipeline documentation.

