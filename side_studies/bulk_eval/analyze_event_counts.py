#!/usr/bin/env python3
"""
Analyze event counts in input_sources.json to determine optimal threshold
for selecting high-quality sources for bulk analysis.
"""

import json
import sys
from pathlib import Path
from typing import List, Dict, Any
import statistics

def load_sources(input_file: str) -> List[Dict[str, Any]]:
    """Load sources from JSON file."""
    with open(input_file, 'r') as f:
        return json.load(f)


def analyze_event_counts(sources: List[Dict[str, Any]]) -> Dict[str, Any]:
    """
    Analyze original_event_list counts across all sources.
    
    Returns:
        Dictionary with statistics and sorted sources
    """
    # Extract event counts
    source_counts = []
    for source in sources:
        source_id = source.get('_id', 'unknown')
        source_name = source.get('source_name', 'unknown')
        obsid = source.get('obsid', 'unknown')
        
        original_events = source.get('original_event_list', [])
        event_count = len(original_events) if isinstance(original_events, list) else 0
        
        source_counts.append({
            'id': source_id,
            'source_name': source_name,
            'obsid': obsid,
            'event_count': event_count
        })
    
    # Sort by event count (descending)
    source_counts.sort(key=lambda x: x['event_count'], reverse=True)
    
    # Compute statistics
    counts = [s['event_count'] for s in source_counts]
    
    if not counts:
        return {"error": "No sources found"}
    
    stats = {
        'total_sources': len(counts),
        'min': min(counts),
        'max': max(counts),
        'mean': statistics.mean(counts),
        'median': statistics.median(counts),
        'stdev': statistics.stdev(counts) if len(counts) > 1 else 0,
        'percentiles': {
            'p10': sorted(counts)[int(len(counts) * 0.10)],
            'p25': sorted(counts)[int(len(counts) * 0.25)],
            'p50': sorted(counts)[int(len(counts) * 0.50)],
            'p75': sorted(counts)[int(len(counts) * 0.75)],
            'p90': sorted(counts)[int(len(counts) * 0.90)],
            'p95': sorted(counts)[int(len(counts) * 0.95)],
            'p99': sorted(counts)[int(len(counts) * 0.99)],
        }
    }
    
    return {
        'statistics': stats,
        'sorted_sources': source_counts,
        'counts': counts
    }


def print_statistics(stats: Dict[str, Any]):
    """Print formatted statistics."""
    print("\n" + "="*80)
    print("EVENT COUNT STATISTICS")
    print("="*80)
    print(f"\nTotal sources:       {stats['total_sources']:,}")
    print(f"\nEvent Count Range:")
    print(f"  Minimum:           {stats['min']:,} events")
    print(f"  Maximum:           {stats['max']:,} events")
    print(f"  Mean:              {stats['mean']:,.1f} events")
    print(f"  Median:            {stats['median']:,.0f} events")
    print(f"  Std Deviation:     {stats['stdev']:,.1f} events")
    
    print(f"\nPercentile Distribution:")
    print(f"  10th percentile:   {stats['percentiles']['p10']:,} events")
    print(f"  25th percentile:   {stats['percentiles']['p25']:,} events")
    print(f"  50th percentile:   {stats['percentiles']['p50']:,} events")
    print(f"  75th percentile:   {stats['percentiles']['p75']:,} events")
    print(f"  90th percentile:   {stats['percentiles']['p90']:,} events")
    print(f"  95th percentile:   {stats['percentiles']['p95']:,} events")
    print(f"  99th percentile:   {stats['percentiles']['p99']:,} events")


def print_top_sources(sorted_sources: List[Dict[str, Any]], n: int = 10):
    """Print top N sources by event count."""
    print(f"\n" + "="*80)
    print(f"TOP {n} SOURCES BY EVENT COUNT")
    print("="*80)
    print(f"\n{'Rank':<6} {'Event Count':<12} {'ObsID':<8} {'Source Name'}")
    print("-" * 80)
    
    for i, source in enumerate(sorted_sources[:n], 1):
        print(f"{i:<6} {source['event_count']:>11,}  {source['obsid']:<8} {source['source_name']}")


def print_bottom_sources(sorted_sources: List[Dict[str, Any]], n: int = 10):
    """Print bottom N sources by event count."""
    print(f"\n" + "="*80)
    print(f"BOTTOM {n} SOURCES BY EVENT COUNT")
    print("="*80)
    print(f"\n{'Rank':<6} {'Event Count':<12} {'ObsID':<8} {'Source Name'}")
    print("-" * 80)
    
    total = len(sorted_sources)
    for i, source in enumerate(sorted_sources[-n:], total - n + 1):
        print(f"{i:<6} {source['event_count']:>11,}  {source['obsid']:<8} {source['source_name']}")


def analyze_threshold_for_top_n(sorted_sources: List[Dict[str, Any]], n: int = 100):
    """Analyze threshold needed to get top N sources."""
    if len(sorted_sources) < n:
        print(f"\n⚠️  Warning: Only {len(sorted_sources)} sources available, requested top {n}")
        n = len(sorted_sources)
    
    top_n = sorted_sources[:n]
    threshold = top_n[-1]['event_count']
    
    print(f"\n" + "="*80)
    print(f"THRESHOLD ANALYSIS FOR TOP {n} SOURCES")
    print("="*80)
    
    print(f"\nTo select the top {n} sources by event count:")
    print(f"  Threshold:         >= {threshold:,} events")
    print(f"  Top source:        {top_n[0]['event_count']:,} events")
    print(f"  Bottom of top {n}:  {threshold:,} events")
    print(f"  Mean in top {n}:    {sum(s['event_count'] for s in top_n) / n:,.1f} events")
    print(f"  Median in top {n}:  {statistics.median([s['event_count'] for s in top_n]):,.0f} events")
    
    # Show sources around the threshold
    print(f"\nSources around the threshold (rank {n-2} to {n+3}):")
    print(f"\n{'Rank':<6} {'Event Count':<12} {'Status':<15} {'Source Name'}")
    print("-" * 80)
    
    for i in range(max(0, n-3), min(len(sorted_sources), n+3)):
        source = sorted_sources[i]
        rank = i + 1
        status = "✅ TOP 100" if rank <= n else "❌ Below threshold"
        print(f"{rank:<6} {source['event_count']:>11,}  {status:<15} {source['source_name']}")
    
    return threshold


def create_distribution_bins(counts: List[int], n_bins: int = 10):
    """Create histogram bins for event count distribution."""
    if not counts:
        return
    
    min_count = min(counts)
    max_count = max(counts)
    bin_width = (max_count - min_count) / n_bins
    
    print(f"\n" + "="*80)
    print(f"EVENT COUNT DISTRIBUTION ({n_bins} bins)")
    print("="*80)
    print(f"\n{'Range':<30} {'Count':<8} {'Percentage':<12} {'Bar'}")
    print("-" * 80)
    
    for i in range(n_bins):
        bin_start = min_count + i * bin_width
        bin_end = bin_start + bin_width
        
        # Count sources in this bin
        if i == n_bins - 1:  # Last bin includes max
            bin_count = sum(1 for c in counts if bin_start <= c <= bin_end)
        else:
            bin_count = sum(1 for c in counts if bin_start <= c < bin_end)
        
        percentage = (bin_count / len(counts)) * 100
        
        # Create bar chart
        bar_length = int(percentage * 0.5)  # Scale to 50 chars max
        bar = "█" * bar_length
        
        range_str = f"{bin_start:>8.0f} - {bin_end:>8.0f}"
        print(f"{range_str:<30} {bin_count:<8} {percentage:>5.1f}%       {bar}")


def save_sorted_list(sorted_sources: List[Dict[str, Any]], output_file: str):
    """Save sorted sources to file for reference."""
    with open(output_file, 'w') as f:
        f.write("Rank,Event Count,ObsID,Source Name,ID\n")
        for i, source in enumerate(sorted_sources, 1):
            f.write(f"{i},{source['event_count']},{source['obsid']},{source['source_name']},{source['id']}\n")
    print(f"\n✅ Sorted source list saved to: {output_file}")


def main():
    """Main execution."""
    script_dir = Path(__file__).parent
    input_file = script_dir / "input_sources.json"
    output_file = script_dir / "event_count_analysis.csv"
    
    print("\n" + "="*80)
    print("EVENT COUNT ANALYSIS FOR BULK EVALUATION")
    print("="*80)
    print(f"\nInput:  {input_file}")
    print(f"Output: {output_file}")
    
    # Load and analyze
    print("\nLoading sources...")
    try:
        sources = load_sources(input_file)
        print(f"✅ Loaded {len(sources)} sources")
    except FileNotFoundError:
        print(f"❌ Error: File not found: {input_file}")
        sys.exit(1)
    except json.JSONDecodeError as e:
        print(f"❌ Error: Invalid JSON: {e}")
        sys.exit(1)
    
    print("\nAnalyzing event counts...")
    analysis = analyze_event_counts(sources)
    
    if 'error' in analysis:
        print(f"❌ Error: {analysis['error']}")
        sys.exit(1)
    
    stats = analysis['statistics']
    sorted_sources = analysis['sorted_sources']
    counts = analysis['counts']
    
    # Print results
    print_statistics(stats)
    print_top_sources(sorted_sources, n=10)
    print_bottom_sources(sorted_sources, n=10)
    create_distribution_bins(counts, n_bins=10)
    
    # Analyze threshold for top 100
    threshold = analyze_threshold_for_top_n(sorted_sources, n=100)
    
    # Save results
    save_sorted_list(sorted_sources, output_file)
    
    # Summary recommendation
    print(f"\n" + "="*80)
    print("RECOMMENDATION")
    print("="*80)
    print(f"\n🎯 To select the top 100 sources:")
    print(f"   Use threshold: event_count >= {threshold:,}")
    print(f"\n💡 Implementation:")
    print(f"   In extract_from_mongodb.py, after loading sources:")
    print(f"   filtered_sources = [s for s in sources if len(s.get('original_event_list', [])) >= {threshold}]")
    print(f"\n📊 Data Quality:")
    if stats['mean'] > threshold * 2:
        print(f"   ✅ Excellent: Top 100 are well above average ({stats['mean']:,.0f} events)")
    elif stats['mean'] > threshold:
        print(f"   ✅ Good: Top 100 are above average ({stats['mean']:,.0f} events)")
    else:
        print(f"   ⚠️  Note: Top 100 threshold is near/above average")
    
    print("\n" + "="*80)


if __name__ == "__main__":
    main()

