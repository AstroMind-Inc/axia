#!/usr/bin/env python3
"""
Bulk OpenAI Direct Analysis Script for Flaring Sources
=======================================================

This script calls OpenAI gpt-5.1 directly with only the event list data.
No other source information is included to avoid leaking metadata.

Features:
- Automatic token counting and event list truncation to prevent context length errors
- Processes up to 250k tokens (OpenAI's gpt-5.1 limit is 272k)
- Adds truncation metadata to output for transparency

Dependencies:
    pip install openai tenacity tiktoken

Usage:
    python3 bulk_openai_direct.py [--concurrent N] [--start START] [--end END]

Options:
    --concurrent N    Number of concurrent requests (default: 2)
    --start START     Start index (default: 0)
    --end END         End index (default: 25)

Input:  flaring_sources_extracted.json (25 sources)
Output: flaring_openai_results_{START}_{END}.json

Output Fields:
- event_list_truncated: Boolean indicating if event list was truncated
- original_event_count: Original number of events
- truncated_event_count: Number of events after truncation (if truncated)
"""

import json
import asyncio
import os
from typing import List, Dict, Any, Optional, Tuple
from datetime import datetime
import sys
from pathlib import Path
import argparse
from openai import AsyncOpenAI
from tenacity import retry, stop_after_attempt, wait_exponential
import tiktoken

# Configuration
INPUT_FILE = "flaring_sources_extracted.json"  # Flaring sources without neighbors
OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY", "")
# Range-based processing
START_INDEX = 0
END_INDEX = 25

# Output file naming
if START_INDEX is not None and END_INDEX is not None:
    OUTPUT_FILE = f"flaring_openai_results_{START_INDEX}_{END_INDEX}.json"
elif START_INDEX is not None:
    OUTPUT_FILE = f"flaring_openai_results_from_{START_INDEX}.json"
elif END_INDEX is not None:
    OUTPUT_FILE = f"flaring_openai_results_to_{END_INDEX}.json"
else:
    OUTPUT_FILE = "flaring_openai_results.json"

# OpenAI Configuration
OPENAI_MODEL = "gpt-5.1"
MAX_TOKENS = 10000
TEMPERATURE = 1.0  # GPT-5 models use temperature 1.0
MAX_CONTEXT_TOKENS = 250000  # Safe limit (model limit is 272k, leave room for response)

# Prompt template (same as bulk_metadata_analysis.py)
ANALYSIS_PROMPT_TEMPLATE = """You are being presented with event data and metadata corresponding to the observation of an astrophysical high energy source with the Chandra X-ray observatory. Please assess the following:

1) What are appropriate spectral models to fit the spectrum of this source? Consider multi-component fits, and provide all options compatible with the data, ranked from more to less likely. Please also provide reasonable ranges for the model parameters

2) What sort of flux variability does the source display? Can you spot anything unusual regarding variability?

3) What are the likely types of this source, given all the information you have available?

The equatorial sexagesimal sky coordinates of the source are: RA: {ra_sex} Dec: {dec_sex}"""


# ============================================================================
# COORDINATE CONVERSION
# ============================================================================

def decimal_to_sexagesimal_ra(ra_deg: float) -> str:
    """Convert decimal degrees RA to sexagesimal format."""
    ra_deg = ra_deg % 360.0
    hours = ra_deg / 15.0
    h = int(hours)
    minutes = (hours - h) * 60.0
    m = int(minutes)
    seconds = (minutes - m) * 60.0
    s = seconds
    return f"{h:02d}h {m:02d}m {s:05.2f}s"


def decimal_to_sexagesimal_dec(dec_deg: float) -> str:
    """Convert decimal degrees Dec to sexagesimal format."""
    sign = '+' if dec_deg >= 0 else '-'
    dec_abs = abs(dec_deg)
    degrees = int(dec_abs)
    arcminutes = (dec_abs - degrees) * 60.0
    arcmin = int(arcminutes)
    arcseconds = (arcminutes - arcmin) * 60.0
    arcsec = arcseconds
    return f"{sign}{degrees:02d}°{arcmin:02d}'{arcsec:05.2f}\""


def format_prompt_with_coordinates(ra: Optional[float], dec: Optional[float]) -> str:
    """Format the analysis prompt with source coordinates."""
    if ra is not None and dec is not None:
        ra_sex = decimal_to_sexagesimal_ra(ra)
        dec_sex = decimal_to_sexagesimal_dec(dec)
        return ANALYSIS_PROMPT_TEMPLATE.format(ra_sex=ra_sex, dec_sex=dec_sex)
    else:
        return ANALYSIS_PROMPT_TEMPLATE.format(
            ra_sex="coordinates not available",
            dec_sex=""
        ).replace("The equatorial sexagesimal sky coordinates of the source are: RA: coordinates not available Dec: ", "")


# ============================================================================
# TOKEN MANAGEMENT
# ============================================================================

def count_tokens(text: str, model: str = "gpt-4") -> int:
    """
    Count tokens in text using tiktoken.
    
    Args:
        text: Text to count tokens for
        model: Model name (uses gpt-4 encoding as proxy for gpt-5)
        
    Returns:
        Number of tokens
    """
    try:
        encoding = tiktoken.encoding_for_model(model)
    except KeyError:
        # Fallback to cl100k_base for newer models
        encoding = tiktoken.get_encoding("cl100k_base")
    
    return len(encoding.encode(text))


def truncate_event_list_to_fit(
    event_list: List[List[float]], 
    prompt: str, 
    max_tokens: int = MAX_CONTEXT_TOKENS
) -> Tuple[List[List[float]], bool]:
    """
    Truncate event list to fit within token limit.
    
    Args:
        event_list: Original event list [[time, energy], ...]
        prompt: The analysis prompt text
        max_tokens: Maximum allowed tokens for input
        
    Returns:
        Tuple of (truncated_event_list, was_truncated)
    """
    # Create the base prompt template
    system_msg = "You are an expert X-ray astronomer specializing in Chandra X-ray Observatory data analysis. Provide accurate, scientific responses based on the event data provided."
    
    event_data_template = """
EVENT DATA:
The event list is provided below in JSON format. Each event is represented as [time, energy]:
- Time: seconds since mission epoch (can be normalized)
- Energy: in eV (electron volts)

{event_list_json}

Please analyze this event data to answer the questions above."""
    
    # Count tokens for fixed parts
    fixed_text = f"{system_msg}\n\n{prompt}\n{event_data_template.replace('{event_list_json}', '')}"
    fixed_tokens = count_tokens(fixed_text)
    
    # Reserve some tokens for JSON structure overhead (braces, quotes, commas)
    json_overhead_estimate = 100
    available_tokens = max_tokens - fixed_tokens - json_overhead_estimate
    
    if available_tokens <= 0:
        print(f"⚠️  WARNING: Prompt itself exceeds token limit!")
        return [], True
    
    # Try full event list first
    full_event_json = json.dumps({"event_list": event_list}, indent=2)
    full_tokens = count_tokens(full_event_json)
    
    if full_tokens <= available_tokens:
        # No truncation needed
        return event_list, False
    
    # Need to truncate - binary search for optimal size
    print(f"⚠️  Event list too large ({full_tokens} tokens), truncating to fit {available_tokens} tokens...")
    
    # Estimate events per token
    tokens_per_event = full_tokens / len(event_list)
    estimated_events = int(available_tokens / tokens_per_event * 0.9)  # 90% safety margin
    
    # Start with estimate and adjust
    low, high = max(1, estimated_events // 2), min(len(event_list), estimated_events * 2)
    best_size = low
    
    while low <= high:
        mid = (low + high) // 2
        truncated = event_list[:mid]
        truncated_json = json.dumps({"event_list": truncated}, indent=2)
        tokens = count_tokens(truncated_json)
        
        if tokens <= available_tokens:
            best_size = mid
            low = mid + 1
        else:
            high = mid - 1
    
    truncated_list = event_list[:best_size]
    print(f"✂️  Truncated from {len(event_list)} to {best_size} events ({len(event_list) - best_size} events removed)")
    
    return truncated_list, True


# ============================================================================
# OpenAI API Client
# ============================================================================

class OpenAIAnalyzer:
    """Analyzer that calls OpenAI gpt-5.1 directly with event list only."""
    
    MAX_ALLOWED_CONCURRENT = 10  # OpenAI can handle more concurrent requests
    
    def __init__(self, api_key: str, max_concurrent: int = 4):
        self.client = AsyncOpenAI(api_key=api_key)
        
        # Enforce hard limit on concurrency
        if max_concurrent > self.MAX_ALLOWED_CONCURRENT:
            print(f"⚠️  WARNING: Requested concurrency ({max_concurrent}) exceeds safe limit!")
            print(f"   Enforcing maximum: {self.MAX_ALLOWED_CONCURRENT} concurrent requests")
            max_concurrent = self.MAX_ALLOWED_CONCURRENT
        
        self.max_concurrent = max_concurrent
        self.semaphore = asyncio.Semaphore(max_concurrent)
        self.completed = 0
        self.total = 0
    
    @retry(
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=1, min=2, max=10),
        reraise=True
    )
    async def call_openai(self, prompt: str, event_list_json: str) -> str:
        """
        Call OpenAI API with retry logic.
        
        Args:
            prompt: The analysis prompt with coordinates
            event_list_json: JSON string of event list
            
        Returns:
            OpenAI response text
        """
        # Combine prompt with event list data
        full_prompt = f"""{prompt}

EVENT DATA:
The event list is provided below in JSON format. Each event is represented as [time, energy]:
- Time: seconds since mission epoch (can be normalized)
- Energy: in eV (electron volts)

{event_list_json}

Please analyze this event data to answer the questions above."""
        
        response = await self.client.chat.completions.create(
            model=OPENAI_MODEL,
            messages=[
                {
                    "role": "system",
                    "content": "You are an expert X-ray astronomer specializing in Chandra X-ray Observatory data analysis. Provide accurate, scientific responses based on the event data provided."
                },
                {
                    "role": "user",
                    "content": full_prompt
                }
            ],
            max_completion_tokens=MAX_TOKENS,
            temperature=TEMPERATURE
        )
        
        return response.choices[0].message.content
    
    async def analyze_source(self, source_data: Dict[str, Any], source_index: int = 0) -> Dict[str, Any]:
        """
        Analyze a single source using OpenAI with only event list data.
        
        Args:
            source_data: Source object (only event_list and coordinates will be used)
            source_index: Index for progress tracking
            
        Returns:
            Dictionary with analysis results
        """
        # Extract information for output (NOT sent to OpenAI)
        source_id = source_data.get('_id', 'unknown')
        source_name = source_data.get('source_name', 'unknown')
        obsid = source_data.get('obsid', 'unknown')
        
        # Extract minimal information for OpenAI (coordinates for prompt, event list for analysis)
        ra = source_data.get('ra')
        dec = source_data.get('dec')
        original_event_list = source_data.get('original_event_list', [])
        original_event_count = len(original_event_list)
        
        # Format prompt with coordinates
        analysis_prompt = format_prompt_with_coordinates(ra, dec)
        
        # Truncate event list if necessary to fit token limits
        event_list_to_use, was_truncated = truncate_event_list_to_fit(
            original_event_list, 
            analysis_prompt, 
            MAX_CONTEXT_TOKENS
        )
        
        # Create event list JSON (ONLY the event list, no other metadata)
        event_data = {
            "event_list": event_list_to_use
        }
        event_list_json = json.dumps(event_data, indent=2)
        
        async with self.semaphore:
            print(f"\n{'='*80}")
            print(f"[{source_index}/{self.total}] 🔒 ACQUIRED slot ({self.semaphore._value}/{self.max_concurrent} available)")
            print(f"Processing: {source_name} (ObsID: {obsid})")
            print(f"Source ID: {source_id}")
            print(f"Original event count: {original_event_count}")
            if was_truncated:
                print(f"⚠️  Truncated to: {len(event_list_to_use)} events (token limit)")
            print(f"{'='*80}")
            
            try:
                print(f"📡 Calling OpenAI {OPENAI_MODEL}...")
                
                # Call OpenAI API
                response_text = await self.call_openai(analysis_prompt, event_list_json)
                
                result = {
                    "source_id": source_id,
                    "source_name": source_name,
                    "obsid": obsid,
                    "status": "success",
                    "question": analysis_prompt,
                    "original_event_count": original_event_count,
                    "event_list_truncated": was_truncated,
                    "truncated_event_count": len(event_list_to_use) if was_truncated else None,
                    "model": OPENAI_MODEL,
                    "final_answer": response_text,
                    "timestamp": datetime.now().isoformat()
                }
                
                self.completed += 1
                print(f"✅ Successfully analyzed ({self.completed}/{self.total} completed)")
                print(f"📝 Response length: {len(response_text)} chars")
                print(f"🔓 RELEASING slot")
                return result
                
            except Exception as e:
                self.completed += 1
                print(f"❌ Error: {str(e)} ({self.completed}/{self.total} completed)")
                print(f"🔓 RELEASING slot (error)")
                return {
                    "source_id": source_id,
                    "source_name": source_name,
                    "obsid": obsid,
                    "status": "error",
                    "error": str(e),
                    "original_event_count": original_event_count,
                    "event_list_truncated": was_truncated,
                    "truncated_event_count": len(event_list_to_use) if was_truncated else None,
                    "timestamp": datetime.now().isoformat()
                }


# ============================================================================
# MAIN
# ============================================================================

async def main():
    """Main execution function."""
    
    # Parse command line arguments
    parser = argparse.ArgumentParser(
        description='Bulk analysis of flaring sources using OpenAI gpt-5.1 with event list only'
    )
    parser.add_argument(
        '--concurrent',
        type=int,
        default=2,
        help='Number of concurrent requests (default: 2, max: 10)'
    )
    parser.add_argument(
        '--start',
        type=int,
        default=None,
        help='Start index for processing (default: 0)'
    )
    parser.add_argument(
        '--end',
        type=int,
        default=None,
        help='End index for processing (default: 25 - all sources)'
    )
    args = parser.parse_args()
    
    max_concurrent = args.concurrent
    
    # Override START_INDEX and END_INDEX if provided via command line
    global START_INDEX, END_INDEX, OUTPUT_FILE
    if args.start is not None:
        START_INDEX = args.start
    if args.end is not None:
        END_INDEX = args.end
    
    # Regenerate output filename with new range
    if START_INDEX is not None and END_INDEX is not None:
        OUTPUT_FILE = f"flaring_openai_results_{START_INDEX}_{END_INDEX}.json"
    elif START_INDEX is not None:
        OUTPUT_FILE = f"flaring_openai_results_from_{START_INDEX}.json"
    elif END_INDEX is not None:
        OUTPUT_FILE = f"flaring_openai_results_to_{END_INDEX}.json"
    else:
        OUTPUT_FILE = "flaring_openai_results.json"
    
    # Validate concurrency value
    if max_concurrent < 1:
        print("❌ Error: --concurrent must be at least 1")
        return 1
    if max_concurrent > OpenAIAnalyzer.MAX_ALLOWED_CONCURRENT:
        print(f"⚠️  WARNING: Requested concurrency ({max_concurrent}) exceeds safe limit!")
        print(f"   Maximum allowed: {OpenAIAnalyzer.MAX_ALLOWED_CONCURRENT}")
        print(f"   Using: {OpenAIAnalyzer.MAX_ALLOWED_CONCURRENT} concurrent requests")
        max_concurrent = OpenAIAnalyzer.MAX_ALLOWED_CONCURRENT
    
    # Get OpenAI API key
    api_key = OPENAI_API_KEY
    if not api_key:
        print("❌ Error: OPENAI_API_KEY environment variable not set")
        print("   Please set it: export OPENAI_API_KEY='your-api-key'")
        return 1
    
    # Get script directory
    script_dir = Path(__file__).parent
    input_path = script_dir / INPUT_FILE
    output_path = script_dir / OUTPUT_FILE
    
    print("\n" + "="*80)
    print("🚀 OpenAI Direct Bulk Analysis")
    print("="*80)
    print(f"Model:        {OPENAI_MODEL}")
    print(f"Input:        {input_path}")
    print(f"Output:       {output_path}")
    print(f"Concurrency:  {max_concurrent} parallel requests")
    if START_INDEX is not None or END_INDEX is not None:
        range_str = f"[{START_INDEX if START_INDEX is not None else 0}:{END_INDEX if END_INDEX is not None else 'end'}]"
        print(f"Range:        Processing sources {range_str}")
    print()
    print("📦 Data Strategy: EVENT LIST ONLY")
    print("   ✅ Sending: original_event_list (time, energy pairs)")
    print("   ✅ Prompt includes: coordinates (for context)")
    print("   ❌ Excluding: ALL other source metadata (name, spectral fits, etc.)")
    print("   🎯 Goal: Test OpenAI's ability to analyze raw event data")
    print("="*80 + "\n")
    
    # Load input sources
    try:
        with open(input_path, 'r') as f:
            sources = json.load(f)
        
        # Apply range if configured
        total_sources = len(sources)
        start_idx = START_INDEX if START_INDEX is not None else 0
        end_idx = END_INDEX if END_INDEX is not None else total_sources
        
        # Validate range
        if start_idx < 0:
            print(f"❌ Error: START_INDEX cannot be negative (got {start_idx})")
            return 1
        if end_idx > total_sources:
            print(f"⚠️  Warning: END_INDEX ({end_idx}) exceeds total sources ({total_sources})")
            print(f"   Adjusting to: END_INDEX={total_sources}")
            end_idx = total_sources
        if start_idx >= end_idx:
            print(f"❌ Error: START_INDEX ({start_idx}) must be less than END_INDEX ({end_idx})")
            return 1
        
        # Slice sources
        if START_INDEX is not None or END_INDEX is not None:
            sources = sources[start_idx:end_idx]
            print(f"✅ Loaded {total_sources} source(s) from {INPUT_FILE}")
            print(f"📊 Processing range [{start_idx}:{end_idx}] = {len(sources)} source(s)")
            print(f"   First source: #{start_idx} - ID: {sources[0].get('_id', 'unknown')}")
            print(f"   Last source:  #{end_idx-1} - ID: {sources[-1].get('_id', 'unknown')}")
        else:
            print(f"✅ Loaded {len(sources)} source(s) from {INPUT_FILE}")
    except FileNotFoundError:
        print(f"❌ Error: Input file not found: {input_path}")
        return 1
    except json.JSONDecodeError as e:
        print(f"❌ Error: Invalid JSON in input file: {e}")
        return 1
    
    if not sources:
        print("⚠️  Warning: No sources to process")
        return 0
    
    # Initialize analyzer
    analyzer = OpenAIAnalyzer(api_key=api_key, max_concurrent=max_concurrent)
    analyzer.total = len(sources)
    
    print(f"📊 Starting analysis of {len(sources)} source(s) with concurrency={max_concurrent}...")
    print(f"⏱️  Estimated time: {len(sources) // max_concurrent * 10}-{len(sources) // max_concurrent * 20} seconds\n")
    
    # Process all sources concurrently
    start_time = datetime.now()
    
    # Create tasks for all sources
    tasks = [
        analyzer.analyze_source(source, i) 
        for i, source in enumerate(sources, 1)
    ]
    
    # Execute all tasks concurrently with error handling
    results = await asyncio.gather(*tasks, return_exceptions=True)
    
    # Convert exceptions to error dictionaries
    processed_results = []
    successful = 0
    failed = 0
    
    for i, result in enumerate(results):
        if isinstance(result, Exception):
            print(f"❌ Fatal error processing source {i+1}: {result}")
            processed_results.append({
                "source_id": sources[i].get("_id", "unknown"),
                "source_name": sources[i].get("source_name", "unknown"),
                "obsid": sources[i].get("obsid", "unknown"),
                "status": "error",
                "error": f"Fatal exception: {str(result)}",
                "timestamp": datetime.now().isoformat()
            })
            failed += 1
        else:
            processed_results.append(result)
            if result.get('status') == 'success':
                successful += 1
            else:
                failed += 1
    
    results = processed_results
    end_time = datetime.now()
    elapsed = (end_time - start_time).total_seconds()
    
    # Write results to output file
    try:
        with open(output_path, 'w') as f:
            json.dump(results, f, indent=2)
        print(f"\n✅ Results saved to: {output_path}")
    except Exception as e:
        print(f"\n❌ Error saving results: {e}")
        return 1
    
    # Print summary
    print("\n" + "="*80)
    print("📊 Analysis Summary")
    print("="*80)
    print(f"Total sources:     {len(sources)}")
    print(f"✅ Successful:     {successful}")
    print(f"❌ Failed:         {failed}")
    print(f"Success rate:      {(successful/len(sources)*100):.1f}%")
    print(f"⏱️  Total time:      {elapsed:.1f}s ({elapsed/len(sources):.1f}s per source)")
    print(f"⚡ Concurrency:     {max_concurrent} parallel requests")
    print(f"💰 Estimated cost:  ~${successful * 0.02:.2f} USD (rough estimate)")
    print("="*80 + "\n")
    
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    try:
        exit_code = asyncio.run(main())
        sys.exit(exit_code)
    except KeyboardInterrupt:
        print("\n⚠️  Interrupted by user")
        sys.exit(130)
    except Exception as e:
        print(f"\n❌ Fatal error: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)

