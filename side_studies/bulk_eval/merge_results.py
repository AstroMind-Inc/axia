#!/usr/bin/env python3
"""
Merge and flatten multiple bulk analysis result JSON files.

This script:
1. Reads multiple result JSON files
2. Extracts only essential fields (skips agent_conversation, processing_steps)
3. Combines all results into a single flattened JSON file

Usage:
    python3 merge_results.py
"""

import json
from pathlib import Path
from typing import List, Dict, Any

# ============================================================================
# CONFIGURATION
# ============================================================================

# Input files to merge (in order)
INPUT_FILES = [
    "output_results_0_50.json",
    "output_results_50_300.json",
    "output_results_300_400.json",
    "output_results_400_500.json",
    "output_results_500_600.json",
    "output_results_600_800.json",
    "output_results_800_1000.json",
]

# Output file
OUTPUT_FILE = "combined_pllm_results.json"

# Fields to keep in the flattened output
FIELDS_TO_KEEP = [
    "source_id",
    "source_name",
    "obsid",
    "status",
    "question",
    "payload_fields_sent",
    "neighbors_count",
    "timestamp",
    "event_analysis",
    "metadata_analysis",
    "neighbor_analysis",
    "critic_review",
    "final_answer",
]

# ============================================================================
# FUNCTIONS
# ============================================================================

def flatten_result(result: Dict[str, Any]) -> Dict[str, Any]:
    """
    Extract only the essential fields from a result object.
    
    Args:
        result: Original result object with all fields
        
    Returns:
        Flattened result with only essential fields
    """
    flattened = {}
    
    for field in FIELDS_TO_KEEP:
        # Include field if it exists, otherwise set to None
        flattened[field] = result.get(field, None)
    
    return flattened


def load_results(file_path: str) -> List[Dict[str, Any]]:
    """
    Load results from a JSON file.
    
    Args:
        file_path: Path to the JSON file
        
    Returns:
        List of result objects
    """
    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            data = json.load(f)
            
        # Handle both array and single object
        if isinstance(data, list):
            return data
        else:
            return [data]
            
    except FileNotFoundError:
        print(f"⚠️  Warning: File not found: {file_path}")
        return []
    except json.JSONDecodeError as e:
        print(f"⚠️  Warning: Invalid JSON in {file_path}: {e}")
        return []
    except Exception as e:
        print(f"⚠️  Warning: Error reading {file_path}: {e}")
        return []


def merge_results(input_files: List[str], output_file: str) -> None:
    """
    Merge multiple result files into a single flattened JSON file.
    
    Args:
        input_files: List of input file paths
        output_file: Path to the output file
    """
    print("=" * 80)
    print("MERGE AND FLATTEN BULK ANALYSIS RESULTS")
    print("=" * 80)
    print()
    
    all_results = []
    
    # Load and process each input file
    for i, input_file in enumerate(input_files, 1):
        print(f"[{i}/{len(input_files)}] Reading: {input_file}")
        
        results = load_results(input_file)
        
        if not results:
            print(f"   ⚠️  No results found or file error")
            continue
        
        print(f"   ✅ Loaded {len(results)} result(s)")
        
        # Flatten each result
        for result in results:
            flattened = flatten_result(result)
            all_results.append(flattened)
        
        print(f"   📦 Flattened to {len(FIELDS_TO_KEEP)} fields per result")
        print()
    
    # Save combined results
    print(f"💾 Writing combined results to: {output_file}")
    
    try:
        with open(output_file, 'w', encoding='utf-8') as f:
            json.dump(all_results, f, indent=2, ensure_ascii=False)
        
        print(f"✅ Successfully merged {len(all_results)} results")
        print()
        
        # Statistics
        print("=" * 80)
        print("SUMMARY")
        print("=" * 80)
        print(f"Total results:       {len(all_results)}")
        print(f"Fields per result:   {len(FIELDS_TO_KEEP)}")
        print(f"Output file:         {output_file}")
        
        # Count by status
        status_counts = {}
        for result in all_results:
            status = result.get('status', 'unknown')
            status_counts[status] = status_counts.get(status, 0) + 1
        
        print()
        print("Status breakdown:")
        for status, count in sorted(status_counts.items()):
            print(f"  - {status}: {count}")
        
        # File size
        file_size = Path(output_file).stat().st_size
        size_mb = file_size / (1024 * 1024)
        print()
        print(f"Output file size:    {size_mb:.2f} MB")
        print()
        
        # Sample result
        if all_results:
            print("=" * 80)
            print("SAMPLE RESULT (first entry)")
            print("=" * 80)
            sample = all_results[0]
            for key, value in sample.items():
                if isinstance(value, str) and len(value) > 100:
                    preview = value[:100] + "..."
                    print(f"  {key}: \"{preview}\"")
                elif isinstance(value, list):
                    print(f"  {key}: [{len(value)} items]")
                else:
                    print(f"  {key}: {json.dumps(value)}")
        
        print()
        print("✅ Merge complete!")
        
    except Exception as e:
        print(f"❌ Error writing output file: {e}")
        raise


# ============================================================================
# MAIN
# ============================================================================

def main():
    """Main entry point."""
    merge_results(INPUT_FILES, OUTPUT_FILE)


if __name__ == "__main__":
    main()

