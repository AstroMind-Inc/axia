#!/usr/bin/env python3
"""
Add RA/Dec Coordinates from 2CXO Source Names
==============================================

This script parses 2CXO source names to extract RA and Dec coordinates
and updates the JSON files with these values.

2CXO naming convention:
- Format: "2CXO JHHMMSS.s±DDMMSS"
- Example: "2CXO J123605.1+622013"
  - RA: 12h 36m 05.1s → 189.021° (decimal degrees)
  - Dec: +62° 20' 13" → +62.337° (decimal degrees)

Updates both:
1. flaring_sources_extracted.json
2. flaring_sources_with_neighbors.json
"""

import json
import re
from typing import Optional, Tuple


def parse_2cxo_name(source_name: str) -> Tuple[Optional[float], Optional[float]]:
    """
    Parse 2CXO source name to extract RA and Dec in decimal degrees.
    
    Format: "2CXO JHHMMSS.s±DDMMSS"
    - RA: HHMMSS.s (hours, minutes, seconds)
    - Dec: ±DDMMSS (degrees, arcminutes, arcseconds)
    
    Args:
        source_name: Source name in 2CXO format
    
    Returns:
        Tuple of (ra_degrees, dec_degrees) or (None, None) if parsing fails
    """
    try:
        # Remove "2CXO J" prefix
        if not source_name.startswith("2CXO J"):
            print(f"    ⚠️  Invalid format (missing '2CXO J' prefix): {source_name}")
            return None, None
        
        coords = source_name[6:]  # Remove "2CXO J"
        
        # Match pattern: HHMMSS.s±DDMMSS
        # RA can have decimal point, Dec typically doesn't but might
        pattern = r'^(\d{2})(\d{2})(\d{2}\.?\d*)([+-])(\d{2})(\d{2})(\d{2}\.?\d*)$'
        match = re.match(pattern, coords)
        
        if not match:
            print(f"    ⚠️  Could not parse coordinates from: {source_name}")
            return None, None
        
        # Extract components
        ra_h = int(match.group(1))
        ra_m = int(match.group(2))
        ra_s = float(match.group(3))
        dec_sign = match.group(4)
        dec_d = int(match.group(5))
        dec_m = int(match.group(6))
        dec_s = float(match.group(7))
        
        # Convert RA to decimal degrees
        # RA is in hours, need to multiply by 15 to get degrees
        ra_decimal = (ra_h + ra_m/60.0 + ra_s/3600.0) * 15.0
        
        # Convert Dec to decimal degrees
        dec_decimal = dec_d + dec_m/60.0 + dec_s/3600.0
        if dec_sign == '-':
            dec_decimal = -dec_decimal
        
        return ra_decimal, dec_decimal
    
    except Exception as e:
        print(f"    ❌ Error parsing {source_name}: {e}")
        return None, None


def update_coordinates_in_file(input_file: str, output_file: str) -> Tuple[int, int]:
    """
    Update RA/Dec coordinates in a JSON file.
    
    Args:
        input_file: Input JSON file path
        output_file: Output JSON file path (can be same as input)
    
    Returns:
        Tuple of (successful_updates, failed_updates)
    """
    print(f"\n📂 Processing: {input_file}")
    print("-" * 80)
    
    # Load the file
    try:
        with open(input_file, 'r') as f:
            data = json.load(f)
        print(f"✅ Loaded {len(data)} sources")
    except Exception as e:
        print(f"❌ Error loading file: {e}")
        return 0, 0
    
    # Update each source
    successful = 0
    failed = 0
    
    for i, source in enumerate(data, 1):
        source_name = source.get("source_name", "")
        current_ra = source.get("ra")
        current_dec = source.get("dec")
        
        # Parse coordinates from name
        ra, dec = parse_2cxo_name(source_name)
        
        if ra is not None and dec is not None:
            source["ra"] = ra
            source["dec"] = dec
            successful += 1
            
            # Show update info
            if current_ra is None or current_dec is None:
                print(f"  [{i}/{len(data)}] ✅ {source_name}: RA={ra:.4f}°, Dec={dec:.4f}°")
        else:
            failed += 1
            print(f"  [{i}/{len(data)}] ❌ Failed to parse: {source_name}")
    
    # Save updated file
    try:
        with open(output_file, 'w') as f:
            json.dump(data, f, indent=2)
        print(f"\n✅ Saved updated file: {output_file}")
    except Exception as e:
        print(f"\n❌ Error saving file: {e}")
        return successful, failed
    
    return successful, failed


def main():
    print("=" * 80)
    print("ADD RA/DEC COORDINATES FROM 2CXO SOURCE NAMES")
    print("=" * 80)
    
    # Files to update
    files = [
        ("flaring_sources_extracted.json", "flaring_sources_extracted.json"),
        ("flaring_sources_with_neighbors.json", "flaring_sources_with_neighbors.json")
    ]
    
    total_successful = 0
    total_failed = 0
    
    for input_file, output_file in files:
        successful, failed = update_coordinates_in_file(input_file, output_file)
        total_successful += successful
        total_failed += failed
    
    # Summary
    print("\n" + "=" * 80)
    print("SUMMARY")
    print("=" * 80)
    print(f"✅ Total sources updated: {total_successful}")
    print(f"❌ Total parsing failures: {total_failed}")
    print()
    
    if total_failed == 0:
        print("🎉 All coordinates successfully extracted and updated!")
    else:
        print("⚠️  Some coordinates could not be parsed")
    
    print("=" * 80)


if __name__ == "__main__":
    main()
