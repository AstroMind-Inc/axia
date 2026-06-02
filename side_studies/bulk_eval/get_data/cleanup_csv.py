"""
Script to cleanup test_data.csv by:
1. Removing records where source_type is missing, "NaN", or "X"
2. Sorting remaining records by number of null columns (ascending - least nulls first)
3. Saving output as processed_test_data.csv
"""

import csv
import os
from typing import List, Dict, Any

# File paths
INPUT_CSV = "test_data.csv"
OUTPUT_CSV = "processed_test_data.csv"


def is_null_value(value: str) -> bool:
    """
    Check if a value should be considered null/missing.
    
    Args:
        value: String value from CSV
        
    Returns:
        True if value is null/missing, False otherwise
    """
    if not value:
        return True
    value_upper = value.strip().upper()
    return value_upper in ['NAN', 'NULL', 'NONE', '']


def has_invalid_source_type(row: Dict[str, str]) -> bool:
    """
    Check if a record has missing or invalid source_type.
    
    Invalid means:
    - source_type is empty/null/NaN
    - source_type is "X"
    
    Args:
        row: CSV row as dictionary
        
    Returns:
        True if source_type is missing/invalid, False if valid
    """
    source_type = row.get('source_type', '').strip()
    
    # Check if empty or null
    if not source_type or is_null_value(source_type):
        return True
    
    # Check if it's "X"
    if source_type.upper() == 'X':
        return True
    
    return False


def count_null_columns(row: Dict[str, str], exclude_columns: List[str] = None) -> int:
    """
    Count the number of null/NaN columns in a row.
    
    Args:
        row: CSV row as dictionary
        exclude_columns: List of column names to exclude from counting (e.g., identifiers)
        
    Returns:
        Number of null columns
    """
    if exclude_columns is None:
        # Don't count nulls in identifier columns
        exclude_columns = ['obsid', 'source_name', 'source_type', 'source_type_category']
    
    null_count = 0
    for key, value in row.items():
        if key not in exclude_columns:
            if is_null_value(value):
                null_count += 1
    
    return null_count


def cleanup_csv(input_path: str, output_path: str):
    """
    Main cleanup function.
    
    Args:
        input_path: Path to input CSV file
        output_path: Path to output CSV file
    """
    print("=" * 70)
    print("CSV Cleanup Script")
    print("=" * 70)
    print(f"📥 Input file:  {input_path}")
    print(f"📤 Output file: {output_path}")
    print()
    
    # Read all records - NO EXCLUSIONS, only categorization
    records_with_valid_type = []
    records_with_invalid_type = []
    total_count = 0
    invalid_type_count = 0
    
    print("Step 1: Reading and categorizing records...")
    
    with open(input_path, 'r', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        fieldnames = reader.fieldnames
        
        for row in reader:
            total_count += 1
            
            # Separate records with valid vs invalid/missing source_type
            if has_invalid_source_type(row):
                records_with_invalid_type.append(row)
                invalid_type_count += 1
            else:
                records_with_valid_type.append(row)
    
    print(f"   Total records read: {total_count}")
    print(f"   Records with valid source_type: {len(records_with_valid_type)}")
    print(f"   Records with missing/invalid source_type: {len(records_with_invalid_type)} (includes 'X', NaN, null - will be placed at bottom)")
    print(f"   Total kept: {len(records_with_valid_type) + len(records_with_invalid_type)}")
    print()
    
    if not records_with_valid_type and not records_with_invalid_type:
        print("⚠️  No records to process!")
        return
    
    # Step 2: Count null columns for each record
    print("Step 2: Counting null columns for each record...")
    
    for record in records_with_valid_type:
        null_count = count_null_columns(record)
        record['_null_count'] = null_count
    
    for record in records_with_invalid_type:
        null_count = count_null_columns(record)
        record['_null_count'] = null_count
    
    # Step 3: Sort by null count (ascending - least nulls first)
    print("Step 3: Sorting records by null count (ascending)...")
    
    # Sort records with valid source_type
    records_with_valid_type.sort(key=lambda x: x['_null_count'])
    
    # Sort records with invalid source_type
    records_with_invalid_type.sort(key=lambda x: x['_null_count'])
    
    # Combine: valid types first, then invalid/missing types at bottom
    records = records_with_valid_type + records_with_invalid_type
    
    # Print statistics
    null_counts = [r['_null_count'] for r in records]
    min_nulls = min(null_counts)
    max_nulls = max(null_counts)
    avg_nulls = sum(null_counts) / len(null_counts)
    
    print(f"   Null column statistics:")
    print(f"     - Minimum nulls: {min_nulls}")
    print(f"     - Maximum nulls: {max_nulls}")
    print(f"     - Average nulls: {avg_nulls:.2f}")
    print()
    
    # Show top 5 records with least nulls (from records WITH source_type)
    print("   Top 5 records with least null columns (WITH source_type):")
    for i, record in enumerate(records[:5], 1):
        source_type = record.get('source_type', 'N/A')
        print(f"     {i}. {record['source_name']} (obsid={record['obsid']}, "
              f"type={source_type}, nulls={record['_null_count']})")
    print()
    
    # Show bottom 5 records with most nulls
    print("   Bottom 5 records with most null columns:")
    for i, record in enumerate(records[-5:], len(records) - 4):
        source_type = record.get('source_type', 'N/A')
        print(f"     {i}. {record['source_name']} (obsid={record['obsid']}, "
              f"type={source_type}, nulls={record['_null_count']})")
    print()
    
    # Show division point if there are records with invalid type
    if records_with_invalid_type:
        division_index = len(records_with_valid_type)
        print(f"   Division point: Records 1-{division_index} have valid source_type")
        print(f"                   Records {division_index + 1}-{len(records)} have missing/invalid source_type (X, NaN, null)")
        print()
    
    # Step 4: Write output CSV
    print("Step 4: Writing output CSV...")
    
    # Remove temporary _null_count field before writing
    for record in records:
        del record['_null_count']
    
    with open(output_path, 'w', encoding='utf-8', newline='') as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(records)
    
    print(f"   ✅ Saved {len(records)} records to {output_path}")
    
    # File size info
    input_size = os.path.getsize(input_path) / 1024  # KB
    output_size = os.path.getsize(output_path) / 1024  # KB
    reduction = ((input_size - output_size) / input_size) * 100
    
    print()
    print("📊 File size comparison:")
    print(f"   Input:  {input_size:.2f} KB")
    print(f"   Output: {output_size:.2f} KB")
    print(f"   Reduction: {reduction:.1f}%")
    print()
    
    # Source type distribution
    print("📈 Source type distribution in output:")
    source_types = {}
    for record in records:
        st = record['source_type']
        source_types[st] = source_types.get(st, 0) + 1
    
    # Sort by count (descending)
    sorted_types = sorted(source_types.items(), key=lambda x: x[1], reverse=True)
    
    for source_type, count in sorted_types[:10]:  # Show top 10
        percentage = (count / len(records)) * 100
        print(f"   {source_type:20s}: {count:4d} ({percentage:5.1f}%)")
    
    if len(sorted_types) > 10:
        print(f"   ... and {len(sorted_types) - 10} more types")
    
    print()
    print("=" * 70)
    print("✅ Cleanup complete!")
    print("=" * 70)


def main():
    """Main execution function."""
    # Change to script directory
    script_dir = os.path.dirname(os.path.abspath(__file__))
    os.chdir(script_dir)
    
    # Check if input file exists
    if not os.path.exists(INPUT_CSV):
        print(f"❌ Error: Input file '{INPUT_CSV}' not found!")
        return
    
    # Run cleanup
    cleanup_csv(INPUT_CSV, OUTPUT_CSV)


if __name__ == "__main__":
    main()

