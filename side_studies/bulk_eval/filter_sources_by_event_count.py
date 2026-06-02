#!/usr/bin/env python3
"""
Filter sources from input_sources_200.json based on event count threshold.
Creates input_sources.json with only high-quality sources (>= 108 events).
"""

import json
from pathlib import Path

# Configuration
INPUT_FILE = "input_sources_200.json"
OUTPUT_FILE = "input_sources.json"
MIN_EVENT_COUNT = 108  # Threshold from analysis

def filter_sources_by_event_count(input_file: str, output_file: str, min_count: int):
    """
    Filter sources by original_event_list count.
    
    Args:
        input_file: Path to input JSON file
        output_file: Path to output JSON file
        min_count: Minimum event count threshold
    """
    print("\n" + "="*80)
    print("FILTERING SOURCES BY EVENT COUNT")
    print("="*80)
    print(f"\nInput:     {input_file}")
    print(f"Output:    {output_file}")
    print(f"Threshold: >= {min_count} events in original_event_list")
    print()
    
    # Load sources
    print(f"Loading sources from {input_file}...")
    with open(input_file, 'r') as f:
        sources = json.load(f)
    print(f"✅ Loaded {len(sources)} sources")
    
    # Filter by event count
    print(f"\nFiltering sources with >= {min_count} events...")
    filtered_sources = []
    
    for source in sources:
        original_event_list = source.get('original_event_list', [])
        event_count = len(original_event_list) if isinstance(original_event_list, list) else 0
        
        if event_count >= min_count:
            filtered_sources.append(source)
    
    print(f"✅ Filtered to {len(filtered_sources)} sources ({len(sources) - len(filtered_sources)} removed)")
    
    # Show statistics
    if filtered_sources:
        event_counts = [len(s.get('original_event_list', [])) for s in filtered_sources]
        print(f"\nFiltered sources statistics:")
        print(f"  Count:    {len(filtered_sources)}")
        print(f"  Min:      {min(event_counts):,} events")
        print(f"  Max:      {max(event_counts):,} events")
        print(f"  Mean:     {sum(event_counts) / len(event_counts):,.1f} events")
        print(f"  Median:   {sorted(event_counts)[len(event_counts)//2]:,} events")
        
        # Show top 5
        sorted_sources = sorted(filtered_sources, 
                               key=lambda x: len(x.get('original_event_list', [])), 
                               reverse=True)
        print(f"\nTop 5 sources:")
        for i, source in enumerate(sorted_sources[:5], 1):
            name = source.get('source_name', 'unknown')
            obsid = source.get('obsid', 'unknown')
            count = len(source.get('original_event_list', []))
            print(f"  {i}. {name} (obsid={obsid}): {count:,} events")
    
    # Save filtered sources
    print(f"\nSaving filtered sources to {output_file}...")
    with open(output_file, 'w') as f:
        json.dump(filtered_sources, f, indent=2)
    
    # Check file sizes
    input_size = Path(input_file).stat().st_size / (1024 * 1024)  # MB
    output_size = Path(output_file).stat().st_size / (1024 * 1024)  # MB
    
    print(f"✅ Saved {len(filtered_sources)} sources")
    print(f"\nFile sizes:")
    print(f"  Input:  {input_size:.2f} MB")
    print(f"  Output: {output_size:.2f} MB")
    print(f"  Saved:  {input_size - output_size:.2f} MB ({(1 - output_size/input_size)*100:.1f}% reduction)")
    
    print("\n" + "="*80)
    print("✅ FILTERING COMPLETE!")
    print("="*80)
    print(f"\nResult: {len(filtered_sources)} high-quality sources ready for bulk analysis")
    print(f"Use: python3 bulk_metadata_analysis.py --concurrent 4")
    print()


def main():
    """Main execution."""
    script_dir = Path(__file__).parent
    input_path = script_dir / INPUT_FILE
    output_path = script_dir / OUTPUT_FILE
    
    # Check if input file exists
    if not input_path.exists():
        print(f"\n❌ Error: Input file not found: {input_path}")
        print(f"   Expected: {INPUT_FILE}")
        return 1
    
    # Run filtering
    filter_sources_by_event_count(str(input_path), str(output_path), MIN_EVENT_COUNT)
    return 0


if __name__ == "__main__":
    exit(main())

