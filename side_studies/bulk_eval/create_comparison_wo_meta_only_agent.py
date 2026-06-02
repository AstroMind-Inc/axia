#!/usr/bin/env python3
"""
Script to create comparison files from different evaluation system outputs.

This script loads results from two evaluation systems:
1. OpenAI (direct GPT-5-mini)
2. PLLM with full multi-agent system

It creates two output files:
1. comparison_of_all_models.json - Basic comparison with answers only
2. comparison_of_all_models_with_catalog_data.json - Comparison with full catalog metadata
"""

import json
import sys
from pathlib import Path
from typing import Dict, List, Any, Optional

# Input files
OPENAI_FILE = "outputs/gpt-5-1_1000/combined_openai_results.json"
PLLM_FULL_FILE = "outputs/gpt-5-1_1000/combined_pllm_results_null_removed.json"
INPUT_SOURCES_FILE = "input_sources.json"

# Output files
OUTPUT_FILE_1 = "comparison_of_all_models.json"
OUTPUT_FILE_2 = "comparison_of_all_models_with_catalog_data.json"

# Fields to exclude from catalog data (already in top level or not needed)
EXCLUDE_FIELDS = {
    '_id', 'source_name', 'obsid', 'event_list', 'pca_64d', 'umap_2d', 
    'original_event_list', 'neighbors'
}


def load_json_file(filepath: str) -> List[Dict[str, Any]]:
    """Load a JSON file and return the data."""
    try:
        with open(filepath, 'r') as f:
            data = json.load(f)
            if isinstance(data, list):
                return data
            else:
                print(f"Warning: {filepath} does not contain a list")
                return []
    except FileNotFoundError:
        print(f"Error: File not found - {filepath}")
        return []
    except json.JSONDecodeError as e:
        print(f"Error: Invalid JSON in {filepath} - {e}")
        return []


def extract_final_answer(result: Dict[str, Any], system_type: str) -> Optional[str]:
    """Extract the final answer from a result object based on system type."""
    if system_type == "openai":
        # OpenAI direct has 'final_answer' field
        return result.get("final_answer")
    else:
        # PLLM systems have 'final_answer' field
        return result.get("final_answer")


def get_source_id(obj: Dict[str, Any]) -> Optional[str]:
    """Extract source ID from an object (handles both _id and source_id)."""
    return obj.get("_id") or obj.get("source_id")


def create_source_lookup(results: List[Dict[str, Any]]) -> Dict[str, Dict[str, Any]]:
    """Create a lookup dictionary indexed by source_id."""
    lookup = {}
    for result in results:
        source_id = get_source_id(result)
        if source_id:
            lookup[source_id] = result
    return lookup


def get_catalog_data(source: Dict[str, Any]) -> Dict[str, Any]:
    """Extract catalog metadata from source, excluding specific fields."""
    catalog_data = {}
    for key, value in source.items():
        if key not in EXCLUDE_FIELDS:
            catalog_data[key] = value
    return catalog_data


def create_comparison_entry(
    source_id: str,
    obsid: Any,
    source_name: str,
    openai_answer: Optional[str],
    pllm_full_answer: Optional[str],
    catalog_data: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """Create a comparison entry with the specified fields."""
    entry = {
        "id": source_id,
        "obsid": obsid,
        "source_name": source_name,
        "open_ai_only": openai_answer if openai_answer else "Not available",
        "pllm_full": pllm_full_answer if pllm_full_answer else "Not available"
    }
    
    if catalog_data is not None:
        entry["chandra_source_catalog_data"] = catalog_data
    
    return entry


def main():
    print("=" * 80)
    print("Creating Comparison Files")
    print("=" * 80)
    print()
    
    # Load all input files
    print("Loading input files...")
    openai_results = load_json_file(OPENAI_FILE)
    pllm_full_results = load_json_file(PLLM_FULL_FILE)
    input_sources = load_json_file(INPUT_SOURCES_FILE)
    
    if not input_sources:
        print("Error: Could not load input sources file")
        sys.exit(1)
    
    print(f"  ✅ Loaded {len(openai_results)} OpenAI results")
    print(f"  ✅ Loaded {len(pllm_full_results)} PLLM full results")
    print(f"  ✅ Loaded {len(input_sources)} input sources")
    print()
    
    # Create lookup dictionaries
    print("Creating lookup dictionaries...")
    openai_lookup = create_source_lookup(openai_results)
    pllm_full_lookup = create_source_lookup(pllm_full_results)
    input_sources_lookup = create_source_lookup(input_sources)
    print("  ✅ Lookups created")
    print()
    
    # Get all unique source IDs
    all_source_ids = set()
    all_source_ids.update(openai_lookup.keys())
    all_source_ids.update(pllm_full_lookup.keys())
    all_source_ids.update(input_sources_lookup.keys())
    
    print(f"Found {len(all_source_ids)} unique sources across all files")
    print()
    
    # Create comparison entries
    print("Creating comparison entries...")
    comparison_basic = []
    comparison_with_catalog = []
    
    sources_with_all_data = 0
    sources_missing_data = 0
    
    for source_id in sorted(all_source_ids):
        # Get source info from input sources
        source = input_sources_lookup.get(source_id)
        if not source:
            print(f"  ⚠️  Warning: Source {source_id} not found in input sources")
            sources_missing_data += 1
            continue
        
        obsid = source.get("obsid", "Unknown")
        source_name = source.get("source_name", "Unknown")
        
        # Extract final answers from each system
        openai_result = openai_lookup.get(source_id)
        pllm_full_result = pllm_full_lookup.get(source_id)
        
        openai_answer = extract_final_answer(openai_result, "openai") if openai_result else None
        pllm_full_answer = extract_final_answer(pllm_full_result, "pllm_full") if pllm_full_result else None
        
        # Check if we have BOTH answers (skip if either is missing)
        if not openai_answer or not pllm_full_answer:
            print(f"  ⚠️  Warning: Missing answer for source {source_id} ({source_name}) - OpenAI: {bool(openai_answer)}, PLLM: {bool(pllm_full_answer)}")
            sources_missing_data += 1
            continue
        
        sources_with_all_data += 1
        
        # Create basic comparison entry
        basic_entry = create_comparison_entry(
            source_id, obsid, source_name,
            openai_answer, pllm_full_answer
        )
        comparison_basic.append(basic_entry)
        
        # Create comparison entry with catalog data
        catalog_data = get_catalog_data(source)
        catalog_entry = create_comparison_entry(
            source_id, obsid, source_name,
            openai_answer, pllm_full_answer,
            catalog_data=catalog_data
        )
        comparison_with_catalog.append(catalog_entry)
    
    print(f"  ✅ Created {sources_with_all_data} comparison entries")
    if sources_missing_data > 0:
        print(f"  ⚠️  Skipped {sources_missing_data} sources due to missing data")
    print()
    
    # Save output files
    print("Saving output files...")
    
    with open(OUTPUT_FILE_1, 'w') as f:
        json.dump(comparison_basic, f, indent=2)
    print(f"  ✅ Saved {OUTPUT_FILE_1} ({len(comparison_basic)} entries)")
    
    with open(OUTPUT_FILE_2, 'w') as f:
        json.dump(comparison_with_catalog, f, indent=2)
    print(f"  ✅ Saved {OUTPUT_FILE_2} ({len(comparison_with_catalog)} entries)")
    print()
    
    # Summary statistics
    print("=" * 80)
    print("Summary Statistics")
    print("=" * 80)
    print(f"Total unique sources: {len(all_source_ids)}")
    print(f"Sources with comparison data: {sources_with_all_data}")
    print(f"Sources skipped: {sources_missing_data}")
    print()
    
    # Check coverage per system
    openai_coverage = sum(1 for entry in comparison_basic if entry["open_ai_only"] != "Not available")
    pllm_full_coverage = sum(1 for entry in comparison_basic if entry["pllm_full"] != "Not available")
    
    print("Coverage by system:")
    print(f"  OpenAI only: {openai_coverage}/{sources_with_all_data} ({100*openai_coverage/sources_with_all_data:.1f}%)")
    print(f"  PLLM full: {pllm_full_coverage}/{sources_with_all_data} ({100*pllm_full_coverage/sources_with_all_data:.1f}%)")
    print()
    
    print("✅ Comparison files created successfully!")
    print("=" * 80)


if __name__ == "__main__":
    main()

