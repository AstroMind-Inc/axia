#!/usr/bin/env python3
"""
Analyze PLLM's transient/flare detection performance in flaring sources.

This script checks how many of the 25 known flaring sources were correctly
identified as having transients/flares/dips by the PLLM multi-agent system.
"""

import json
import re
from typing import Dict, Any, List, Tuple

def check_for_transient_keywords(text: str) -> Tuple[bool, List[str]]:
    """
    Check if text mentions transient/flare/dip related phenomena.
    
    Args:
        text: The answer text to analyze
        
    Returns:
        Tuple of (detected, matched_keywords)
    """
    if not text or text == "Not available":
        return False, []
    
    # Convert to lowercase for case-insensitive matching
    text_lower = text.lower()
    
    # Keywords indicating transient detection (ordered by specificity)
    keywords = [
        # Direct transient mentions
        r'\btransient\b',
        r'\bflare\b',
        r'\bflaring\b',
        r'\beruption\b',
        r'\boutburst\b',
        
        # Variability mentions
        r'\bvariable\b',
        r'\bvariability\b',
        r'\bvarying\b',
        
        # Flux changes
        r'\bflux.*change',
        r'\bflux.*increase',
        r'\bflux.*decrease',
        r'\bflux.*variation',
        r'\bbrightening\b',
        r'\bdimming\b',
        r'\bfading\b',
        
        # Specific patterns
        r'\bdip\b',
        r'\bpeak\b',
        r'\bevent\b.*\bdetect',
        r'\bsudden.*change',
        r'\brapid.*change',
        r'\bshort.*timescale',
        
        # Time-related variability
        r'\btime.*variable',
        r'\btemporal.*variation',
        r'\blight.*curve.*shows',
        r'\blight.*curve.*indicates',
    ]
    
    matched = []
    for keyword_pattern in keywords:
        if re.search(keyword_pattern, text_lower):
            matched.append(keyword_pattern)
    
    return len(matched) > 0, matched


def main():
    print("=" * 80)
    print("PLLM Transient Detection Analysis")
    print("=" * 80)
    print()
    
    # Load comparison file
    comparison_file = "flaring_comparison_of_all_models.json"
    print(f"Loading {comparison_file}...")
    
    try:
        with open(comparison_file, 'r') as f:
            comparison_data = json.load(f)
    except FileNotFoundError:
        print(f"❌ Error: {comparison_file} not found")
        print("   Please run create_comparison_wo_meta_only_agent.py first")
        return
    except json.JSONDecodeError as e:
        print(f"❌ Error: Invalid JSON - {e}")
        return
    
    print(f"✅ Loaded {len(comparison_data)} comparison entries")
    print()
    
    # Analyze each source
    print("Analyzing PLLM answers for transient/flare detection...")
    print("-" * 80)
    
    detected_sources = []
    not_detected_sources = []
    
    for entry in comparison_data:
        source_id = entry.get("id", "unknown")
        source_name = entry.get("source_name", "unknown")
        obsid = entry.get("obsid", "unknown")
        pllm_answer = entry.get("pllm_full", "Not available")
        
        detected, keywords = check_for_transient_keywords(pllm_answer)
        
        if detected:
            detected_sources.append({
                "source_name": source_name,
                "obsid": obsid,
                "keywords_matched": len(keywords),
                "top_keywords": keywords[:3]  # Show first 3 matches
            })
            status = "✅ DETECTED"
        else:
            not_detected_sources.append({
                "source_name": source_name,
                "obsid": obsid
            })
            status = "❌ NOT DETECTED"
        
        print(f"{status} - {source_name} (ObsID: {obsid})")
        if detected:
            print(f"         Matched: {len(keywords)} keyword patterns")
    
    print()
    print("=" * 80)
    print("RESULTS SUMMARY")
    print("=" * 80)
    print(f"Total sources analyzed: {len(comparison_data)}")
    print(f"Transients DETECTED by PLLM: {len(detected_sources)} ({100*len(detected_sources)/len(comparison_data):.1f}%)")
    print(f"Transients NOT detected by PLLM: {len(not_detected_sources)} ({100*len(not_detected_sources)/len(comparison_data):.1f}%)")
    print()
    
    if not_detected_sources:
        print("Sources where PLLM missed the transient:")
        for source in not_detected_sources:
            print(f"  • {source['source_name']} (ObsID: {source['obsid']})")
        print()
    
    # Save detailed results
    output_file = "flaring_detection_analysis.json"
    output_data = {
        "summary": {
            "total_sources": len(comparison_data),
            "detected": len(detected_sources),
            "not_detected": len(not_detected_sources),
            "detection_rate": len(detected_sources) / len(comparison_data) if comparison_data else 0
        },
        "detected_sources": detected_sources,
        "not_detected_sources": not_detected_sources
    }
    
    with open(output_file, 'w') as f:
        json.dump(output_data, f, indent=2)
    
    print(f"📊 Detailed analysis saved to: {output_file}")
    print("=" * 80)


if __name__ == "__main__":
    main()
