#!/usr/bin/env python3
"""
Bulk Metadata Analysis Script for Flaring Sources
==================================================

This script processes the 25 flaring sources using the full multi-agent system.
It reads sources from flaring_sources_with_neighbors.json, sends them to the 
streaming endpoint, and outputs the results to a JSON file.

Usage:
    python bulk_metadata_analysis.py [--concurrent N] [--start START] [--end END]

Options:
    --concurrent N    Number of concurrent requests (default: 2)
    --start START     Start index (default: 0)
    --end END         End index (default: 25, processes all)

Input:  flaring_sources_with_neighbors.json (25 sources)
Output: flaring_output_results_{START}_{END}.json
"""

import os
import json
import asyncio
import aiohttp
from typing import List, Dict, Any, Optional
from datetime import datetime
import sys
from pathlib import Path
import argparse

# Configuration
API_BASE_URL = "http://localhost:8000"
INPUT_FILE = "flaring_sources_with_neighbors.json"  # Flaring sources with neighbors

# Range-based processing: process sources from START_INDEX to END_INDEX
# Set both to None to process all sources
START_INDEX = 0    # Start at this index (0-based, inclusive)
END_INDEX = 25     # End before this index (0-based, exclusive) - all 25 sources
# Examples:
#   START_INDEX=0,  END_INDEX=5   → processes sources 0-4  (first 5)
#   START_INDEX=5,  END_INDEX=20  → processes sources 5-19 (next 15)
#   START_INDEX=20, END_INDEX=50  → processes sources 20-49 (next 30)
#   START_INDEX=None, END_INDEX=None → processes all sources

# Output file naming (auto-generated based on range)
if START_INDEX is not None and END_INDEX is not None:
    OUTPUT_FILE = f"flaring_output_results_{START_INDEX}_{END_INDEX}.json"
elif START_INDEX is not None:
    OUTPUT_FILE = f"flaring_output_results_from_{START_INDEX}.json"
elif END_INDEX is not None:
    OUTPUT_FILE = f"flaring_output_results_to_{END_INDEX}.json"
else:
    OUTPUT_FILE = "flaring_output_results.json"

# Failed sources log file (appended across multiple runs)
FAILED_SOURCES_FILE = "flaring_failed_sources.txt"

# Base prompt template - coordinates will be added per source
ANALYSIS_PROMPT_TEMPLATE = """You are being presented with event data and metadata corresponding to the observation of an astrophysical high energy source with the Chandra X-ray observatory. Please assess the following:

1) What are appropriate spectral models to fit the spectrum of this source? Consider multi-component fits, and provide all options compatible with the data, ranked from more to less likely. Please also provide reasonable ranges for the model parameters

2) What sort of flux variability does the source display? Can you spot anything unusual regarding variability?

3) What are the likely types of this source, given all the information you have available?

The equatorial sexagesimal sky coordinates of the source are: RA: {ra_sex} Dec: {dec_sex}"""


# ============================================================================
# COORDINATE CONVERSION
# ============================================================================

def decimal_to_sexagesimal_ra(ra_deg: float) -> str:
    """
    Convert decimal degrees Right Ascension to sexagesimal format.
    
    Args:
        ra_deg: RA in decimal degrees (0-360)
        
    Returns:
        Formatted string like "16h 26m 23.36s"
    """
    # Ensure RA is in range [0, 360)
    ra_deg = ra_deg % 360.0
    
    # Convert to hours (RA is measured in hours, 360° = 24h)
    hours = ra_deg / 15.0
    h = int(hours)
    
    # Get minutes
    minutes = (hours - h) * 60.0
    m = int(minutes)
    
    # Get seconds
    seconds = (minutes - m) * 60.0
    s = seconds
    
    return f"{h:02d}h {m:02d}m {s:05.2f}s"


def decimal_to_sexagesimal_dec(dec_deg: float) -> str:
    """
    Convert decimal degrees Declination to sexagesimal format.
    
    Args:
        dec_deg: Dec in decimal degrees (-90 to +90)
        
    Returns:
        Formatted string like "-24°21'00.16\""
    """
    # Get sign
    sign = '+' if dec_deg >= 0 else '-'
    
    # Work with absolute value
    dec_abs = abs(dec_deg)
    
    # Get degrees
    degrees = int(dec_abs)
    
    # Get arcminutes
    arcminutes = (dec_abs - degrees) * 60.0
    arcmin = int(arcminutes)
    
    # Get arcseconds
    arcseconds = (arcminutes - arcmin) * 60.0
    arcsec = arcseconds
    
    return f"{sign}{degrees:02d}°{arcmin:02d}'{arcsec:05.2f}\""


def format_prompt_with_coordinates(ra: Optional[float], dec: Optional[float]) -> str:
    """
    Format the analysis prompt with source coordinates.
    
    Args:
        ra: Right Ascension in decimal degrees
        dec: Declination in decimal degrees
        
    Returns:
        Formatted prompt with coordinates
    """
    if ra is not None and dec is not None:
        ra_sex = decimal_to_sexagesimal_ra(ra)
        dec_sex = decimal_to_sexagesimal_dec(dec)
        return ANALYSIS_PROMPT_TEMPLATE.format(ra_sex=ra_sex, dec_sex=dec_sex)
    else:
        # Fallback if coordinates are missing
        return ANALYSIS_PROMPT_TEMPLATE.format(
            ra_sex="coordinates not available",
            dec_sex=""
        ).replace("The equatorial sexagesimal sky coordinates of the source are: RA: coordinates not available Dec: ", "")


class MetadataAnalyzer:
    """Analyzer that uses all multi-agent workflow agents."""
    
    # HARD LIMIT: Maximum concurrent streams to protect backend
    MAX_ALLOWED_CONCURRENT = 10
    
    def __init__(self, api_base_url: str, max_concurrent: int = 4, failed_log_file: str = None):
        self.api_base_url = api_base_url.rstrip('/')
        self.failed_log_file = failed_log_file
        
        # Enforce hard limit on concurrency
        if max_concurrent > self.MAX_ALLOWED_CONCURRENT:
            print(f"⚠️  WARNING: Requested concurrency ({max_concurrent}) exceeds safe limit!")
            print(f"   Enforcing maximum: {self.MAX_ALLOWED_CONCURRENT} concurrent streams")
            max_concurrent = self.MAX_ALLOWED_CONCURRENT
        
        self.max_concurrent = max_concurrent
        self.semaphore = asyncio.Semaphore(max_concurrent)
        self.completed = 0
        self.total = 0
    
    def log_failed_source(self, obsid: Any, source_name: str, error: str):
        """
        Log a failed source to the failed sources file.
        
        Args:
            obsid: Observation ID
            source_name: Source name
            error: Error message
        """
        if not self.failed_log_file:
            return
        
        try:
            timestamp = datetime.now().isoformat()
            with open(self.failed_log_file, 'a', encoding='utf-8') as f:
                f.write(f"{timestamp}\t{obsid}\t{source_name}\t{error}\n")
        except Exception as e:
            print(f"⚠️  Warning: Could not write to failed log: {e}")
        
    async def analyze_source(self, source_data: Dict[str, Any], source_index: int = 0) -> Dict[str, Any]:
        """
        Analyze a single source using full multi-agent workflow.
        
        Args:
            source_data: Source object with event_list, metadata, neighbors, etc.
            
        Returns:
            Dictionary with analysis results from all agents
        """
        source_id = source_data.get('_id', 'unknown')
        source_name = source_data.get('source_name', 'unknown')
        ra = source_data.get('ra')
        dec = source_data.get('dec')
        
        # Format prompt with coordinates
        analysis_prompt = format_prompt_with_coordinates(ra, dec)
        
        # CRITICAL: Semaphore must wrap the ENTIRE HTTP request/response cycle
        async with self.semaphore:
            print(f"\n{'='*80}")
            print(f"[{source_index}/{self.total}] 🔒 ACQUIRED slot ({self.semaphore._value}/{self.max_concurrent} available)")
            print(f"Processing: {source_name} (ID: {source_id})")
            print(f"{'='*80}")
            
            # Build request payload - ALL agents enabled
        # data_obj contains ONLY essential fields, NO pre-computed metadata
        # This ensures the AI analyzes from scratch without seeing "answers"
        #
        # Excluded fields (pre-computed, should not leak to AI):
        #   - Spectral stats: powlaw_stat, bb_stat, brems_stat, apec_stat
        #   - Model parameters: powlaw_gamma, bb_kt, brems_kt, apec_kt, etc.
        #   - Hardness ratios: hard_hs, hard_hm, hard_ms
        #   - Classifications: source_type, thermal_classification, recommended_model
        #   - Other metadata: flux_significance_b, var_index_b, ra, dec, etc.
        #
        # Included fields (raw observational data only):
        #   - Identifiers: _id, obsid, source_name
        #   - Event data: event_list, original_event_list
        #   - Embeddings: pca_64d, umap_2d (for similarity, not classification)
        
            # Create minimal data object with only essential fields
            # IMPORTANT: Include ra, dec for ToolAgent (needed for SIMBAD, HiPS2FITS, etc.)
            data_obj = {
                "_id": source_data.get("_id"),
                "obsid": source_data.get("obsid"),
                "source_name": source_data.get("source_name"),
                "ra": source_data.get("ra"),           # ✅ REQUIRED for ToolAgent
                "dec": source_data.get("dec"),         # ✅ REQUIRED for ToolAgent
                "event_list": source_data.get("event_list", []),
                "original_event_list": source_data.get("original_event_list", []),
                "pca_64d": source_data.get("pca_64d"),
                "umap_2d": source_data.get("umap_2d"),
            }
            
            payload = {
                "message": analysis_prompt,  # Use formatted prompt with coordinates
                "history": [],
                "model": "astromind-multi-agent",
                "response_format": "Normal",
                "model_api_url": os.environ.get("MODEL_SERVER_URL", ""),
                "openai_model": "gpt-5.1",
                "thread_id": f"full_multiagent_{source_id}_{int(datetime.now().timestamp())}",
                "data_obj": data_obj,
                "event_list": source_data.get("event_list", []),
                "neighbors": source_data.get("neighbors", []),  # Get neighbors from source data
                "agent_config": {
                    "eventAnalyst": True,       # ENABLED
                    "metadataAnalyst": True,    # ENABLED
                    "neighborAnalyst": True,    # ENABLED
                    "critic": True,             # ENABLED
                    "toolAgent": True           # ENABLED
                },
                "context_settings": {
                    "enabled": False,
                    "selectedFields": [],
                    "dataset": "51k_v2_shuffled_without_test_data"
                }
            }
            
            url = f"{self.api_base_url}/v1/chat/stream"
            
            print(f"📡 Sending request to: {url}")
            
            try:
                # Create session with increased buffer sizes for large responses
                # Increase timeout for full multi-agent workflow (tools can take longer)
                timeout = aiohttp.ClientTimeout(total=1000)  # ~17 minutes per source
                connector = aiohttp.TCPConnector(limit=100)
                
                async with aiohttp.ClientSession(connector=connector, timeout=timeout) as session:
                    async with session.post(url, json=payload) as response:
                        if response.status != 200:
                            error_text = await response.text()
                            print(f"❌ HTTP Error {response.status}: {error_text}")
                            return {
                                "source_id": source_id,
                                "source_name": source_name,
                                "obsid": source_data.get("obsid"),
                                "status": "error",
                                "error": f"HTTP {response.status}: {error_text}",
                                "timestamp": datetime.now().isoformat()
                            }
                        
                        # Collect streaming events from all agents
                        final_response = None
                        event_analysis = None
                        metadata_analysis = None
                        neighbor_analysis = None
                        critic_review = None
                        tool_executions = []
                        agent_conversation = []
                        processing_steps = []
                        
                        print(f"📥 Receiving streaming response...")
                        
                        # Read response in larger chunks to avoid "Chunk too big" error
                        # Buffer for accumulating partial lines
                        buffer = ""
                        
                        # Read response in 64KB chunks
                        async for chunk in response.content.iter_chunked(65536):
                            buffer += chunk.decode('utf-8', errors='ignore')
                            
                            # Process complete lines
                            while '\n' in buffer:
                                line_text, buffer = buffer.split('\n', 1)
                                line_text = line_text.strip()
                                
                                # Skip empty lines and non-data lines
                                if not line_text or not line_text.startswith('data: '):
                                    continue
                                
                                # Extract JSON from SSE format
                                data_text = line_text[6:]  # Remove 'data: ' prefix
                                
                                try:
                                    event = json.loads(data_text)
                                    event_type = event.get('type')
                                    
                                    # Log progress
                                    if event_type == 'start':
                                        print(f"  ▶️  Started: {event.get('message')}")
                                        
                                    elif event_type == 'progress':
                                        agent = event.get('agent', 'Unknown')
                                        status = event.get('status', 'unknown')
                                        message = event.get('message', '')
                                        print(f"  ⏳ {agent}: {status} - {message}")
                                        processing_steps.append({
                                            "agent": agent,
                                            "status": status,
                                            "message": message
                                        })
                                        
                                    elif event_type == 'result':
                                        agent = event.get('agent', 'Unknown')
                                        content = event.get('content', '')
                                        print(f"  ✅ {agent}: Result received ({len(content)} chars)")
                                        
                                        # Capture results from all agents
                                        if agent == 'EventAnalyst':
                                            event_analysis = content
                                        elif agent == 'MetadataAnalyst':
                                            metadata_analysis = content
                                        elif agent == 'NeighborAnalyst':
                                            neighbor_analysis = content
                                        elif agent == 'Critic':
                                            critic_review = content
                                        elif agent == 'ToolAgent':
                                            # Tool agent results are usually in tool_executions
                                            pass
                                            
                                    elif event_type == 'final':
                                        full_result = event.get('full_result', {})
                                        final_response = full_result.get('response')
                                        agent_conversation = full_result.get('agent_conversation', [])
                                        tool_executions = full_result.get('tool_executions', [])
                                        print(f"  🎯 Final response received ({len(final_response) if final_response else 0} chars)")
                                        
                                    elif event_type == 'complete':
                                        print(f"  ✅ Analysis complete!")
                                        # Break out of the outer loop
                                        buffer = ""
                                        break
                                        
                                    elif event_type == 'error':
                                        error_msg = event.get('message', 'Unknown error')
                                        print(f"  ❌ Error: {error_msg}")
                                        return {
                                            "source_id": source_id,
                                            "source_name": source_name,
                                            "obsid": source_data.get("obsid"),
                                            "status": "error",
                                            "error": error_msg,
                                            "timestamp": datetime.now().isoformat()
                                        }
                                
                                except json.JSONDecodeError as e:
                                    # Skip malformed JSON lines
                                    continue
                        
                        # Extract agent results from agent conversation if not captured via streaming
                        if agent_conversation:
                            for entry in agent_conversation:
                                agent_name = entry.get('agent')
                                content = entry.get('content')
                                
                                if agent_name == 'EventAnalyst' and not event_analysis:
                                    event_analysis = content
                                elif agent_name == 'MetadataAnalyst' and not metadata_analysis:
                                    metadata_analysis = content
                                elif agent_name == 'NeighborAnalyst' and not neighbor_analysis:
                                    neighbor_analysis = content
                                elif agent_name == 'Critic' and not critic_review:
                                    critic_review = content
                        
                        result = {
                            "source_id": source_id,
                            "source_name": source_name,
                            "obsid": source_data.get("obsid"),
                            "status": "success",
                            "question": analysis_prompt,  # Save the actual prompt used
                            "event_analysis": event_analysis,
                            "metadata_analysis": metadata_analysis,
                            "neighbor_analysis": neighbor_analysis,
                            "critic_review": critic_review,
                            "final_answer": final_response,
                            "agent_conversation": agent_conversation,
                            "tool_executions": tool_executions,
                            "processing_steps": processing_steps,
                            "payload_fields_sent": list(data_obj.keys()),
                            "neighbors_count": len(source_data.get("neighbors", [])),
                            "timestamp": datetime.now().isoformat()
                        }
                        
                        self.completed += 1
                        print(f"✅ Successfully analyzed {source_name} ({self.completed}/{self.total} completed)")
                        print(f"🔓 RELEASING slot (semaphore will have {self.semaphore._value + 1}/{self.max_concurrent} available)")
                        return result

                            
            except asyncio.TimeoutError:
                self.completed += 1
                obsid = source_data.get("obsid")
                error_msg = "Request timeout (>1000s)"
                print(f"❌ Timeout error for {source_name} ({self.completed}/{self.total} completed)")
                print(f"🔓 RELEASING slot (timeout)")
                
                # Log to failed sources file
                self.log_failed_source(obsid, source_name, error_msg)
                
                return {
                    "source_id": source_id,
                    "source_name": source_name,
                    "obsid": obsid,
                    "status": "error",
                    "error": error_msg,
                    "timestamp": datetime.now().isoformat()
                }
            except Exception as e:
                self.completed += 1
                obsid = source_data.get("obsid")
                error_msg = str(e)
                print(f"❌ Exception for {source_name}: {error_msg} ({self.completed}/{self.total} completed)")
                print(f"🔓 RELEASING slot (exception)")
                
                # Log to failed sources file
                self.log_failed_source(obsid, source_name, error_msg)
                
                return {
                    "source_id": source_id,
                    "source_name": source_name,
                    "obsid": obsid,
                    "status": "error",
                    "error": error_msg,
                    "timestamp": datetime.now().isoformat()
                }


async def main():
    """Main execution function."""
    
    # Parse command line arguments
    parser = argparse.ArgumentParser(
        description='Bulk analysis of flaring sources using full multi-agent workflow'
    )
    parser.add_argument(
        '--concurrent',
        type=int,
        default=2,
        help='Number of concurrent requests (default: 2, recommended: 2-4)'
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
        OUTPUT_FILE = f"flaring_output_results_{START_INDEX}_{END_INDEX}.json"
    elif START_INDEX is not None:
        OUTPUT_FILE = f"flaring_output_results_from_{START_INDEX}.json"
    elif END_INDEX is not None:
        OUTPUT_FILE = f"flaring_output_results_to_{END_INDEX}.json"
    else:
        OUTPUT_FILE = "flaring_output_results.json"
    
    # Validate concurrency value
    if max_concurrent < 1:
        print("❌ Error: --concurrent must be at least 1")
        return 1
    if max_concurrent > MetadataAnalyzer.MAX_ALLOWED_CONCURRENT:
        print(f"⚠️  WARNING: Requested concurrency ({max_concurrent}) exceeds safe limit!")
        print(f"   Maximum allowed: {MetadataAnalyzer.MAX_ALLOWED_CONCURRENT} (to protect backend)")
        print(f"   Using: {MetadataAnalyzer.MAX_ALLOWED_CONCURRENT} concurrent streams")
        max_concurrent = MetadataAnalyzer.MAX_ALLOWED_CONCURRENT
    
    # Get script directory
    script_dir = Path(__file__).parent
    input_path = script_dir / INPUT_FILE
    output_path = script_dir / OUTPUT_FILE
    
    print("\n" + "="*80)
    print("🚀 AstroMind Bulk Metadata Analysis")
    print("="*80)
    print(f"API URL:      {API_BASE_URL}")
    print(f"Input:        {input_path}")
    print(f"Output:       {output_path}")
    print(f"Agents:       ALL ENABLED (Event, Metadata, Neighbor, Critic, Tool)")
    print(f"Concurrency:  {max_concurrent} parallel requests")
    if START_INDEX is not None or END_INDEX is not None:
        range_str = f"[{START_INDEX if START_INDEX is not None else 0}:{END_INDEX if END_INDEX is not None else 'end'}]"
        print(f"Range:        Processing sources {range_str}")
    print()
    print("📦 Payload Strategy: MINIMAL DATA + NEIGHBORS")
    print("   ✅ Sending: _id, obsid, source_name, event_list, original_event_list, embeddings")
    print("   ✅ Neighbors: Each source includes 10 nearest neighbors with event_list")
    print("   ❌ Excluding: Pre-computed metadata (spectral stats, hardness ratios, etc.)")
    print("   🎯 Goal: Full multi-agent analysis with all specialized agents")
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
            print(f"   First source: #{start_idx} - {sources[0].get('source_name', 'unknown')}")
            print(f"   Last source:  #{end_idx-1} - {sources[-1].get('source_name', 'unknown')}")
        else:
            print(f"✅ Loaded {len(sources)} source(s) from {INPUT_FILE}")
    except FileNotFoundError:
        print(f"❌ Error: Input file not found: {input_path}")
        print(f"   Please ensure {INPUT_FILE} exists in the scripts/ directory")
        return 1
    except json.JSONDecodeError as e:
        print(f"❌ Error: Invalid JSON in input file: {e}")
        return 1
    
    if not sources:
        print("⚠️  Warning: No sources to process")
        return 0
    
    # Initialize analyzer
    failed_log_path = script_dir / FAILED_SOURCES_FILE
    analyzer = MetadataAnalyzer(
        api_base_url=API_BASE_URL, 
        max_concurrent=max_concurrent,
        failed_log_file=str(failed_log_path)
    )
    analyzer.total = len(sources)
    
    print(f"📊 Starting analysis of {len(sources)} source(s) with concurrency={max_concurrent}...")
    print(f"⏱️  Estimated time: {len(sources) // max_concurrent * 45}-{len(sources) // max_concurrent * 60} seconds\n")
    
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
            source = sources[i]
            obsid = source.get("obsid", "unknown")
            source_name = source.get("source_name", "unknown")
            error_msg = f"Fatal exception: {str(result)}"
            
            print(f"❌ Fatal error processing source {i+1}: {result}")
            
            # Log to failed sources file
            analyzer.log_failed_source(obsid, source_name, error_msg)
            
            processed_results.append({
                "source_id": source.get("_id", "unknown"),
                "source_name": source_name,
                "obsid": obsid,
                "status": "error",
                "error": error_msg,
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
    
    if failed > 0:
        print(f"\n📝 Failed sources logged to: {FAILED_SOURCES_FILE}")
        print(f"   (appended {failed} failed source(s))")
    
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


