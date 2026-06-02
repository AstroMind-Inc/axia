#!/usr/bin/env python3
"""
Script to generate embeddings for system outputs using OpenAI's text-embedding-ada-002 model.

This script reads the comparison file and generates embeddings for each system's output:
- open_ai_only
- pllm_meta_analyst_only
- pllm_full

The embeddings are generated using OpenAI's text-embedding-ada-002 model.
"""

import json
import os
import sys
from typing import Dict, List, Any, Optional
from datetime import datetime
from openai import OpenAI

# Configuration
INPUT_FILE = "outputs/gpt-5-1_1000/comparison_of_all_models.json"
OUTPUT_FILE = "embeddings_from_all.json"
EMBEDDING_MODEL = "text-embedding-ada-002"

# Range-based processing (set to None to process all)
START_INDEX = 0  # Inclusive
END_INDEX = 1000    # Exclusive (e.g., 0 to 5 processes indices 0,1,2,3,4)

# OpenAI API configuration
OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY", "")

if not OPENAI_API_KEY:
    print("Error: OPENAI_API_KEY environment variable not set")
    sys.exit(1)


def get_embedding(text: str, client: OpenAI, model: str = EMBEDDING_MODEL) -> Optional[List[float]]:
    """
    Get embedding for a text using OpenAI's embeddings API.
    
    Args:
        text: The text to embed
        client: OpenAI client instance
        model: The embedding model to use
    
    Returns:
        List of floats representing the embedding, or None if error
    """
    try:
        # Handle empty or "Not available" texts
        if not text or text == "Not available":
            return None
        
        response = client.embeddings.create(
            model=model,
            input=text,
            encoding_format="float"
        )
        
        return response.data[0].embedding
    
    except Exception as e:
        print(f"  ❌ Error generating embedding: {str(e)}")
        return None


def process_comparison_item(
    item: Dict[str, Any], 
    client: OpenAI, 
    index: int
) -> Dict[str, Any]:
    """
    Process a single comparison item and generate embeddings for all system outputs.
    
    Args:
        item: The comparison item containing system outputs
        client: OpenAI client instance
        index: Index of the item (for logging)
    
    Returns:
        Dictionary with embeddings for each system
    """
    source_id = item.get("id", "unknown")
    source_name = item.get("source_name", "unknown")
    obsid = item.get("obsid", "unknown")
    
    print(f"\n[{index + 1}] Processing {source_name} (obsid: {obsid}, id: {source_id})")
    
    result = {
        "id": source_id,
        "obsid": obsid,
        "source_name": source_name
    }
    
    # Process each system's output
    systems = [
        ("open_ai_only", "OpenAI"),
        ("pllm_full", "PLLM Full")
    ]
    
    for key, display_name in systems:
        text = item.get(key, "")
        
        if not text or text == "Not available":
            print(f"  ⚠️  {display_name}: No text available, skipping")
            result[key] = None
            continue
        
        text_length = len(text)
        print(f"  🔄 {display_name}: Generating embedding (text length: {text_length} chars)...")
        
        embedding = get_embedding(text, client)
        
        if embedding:
            print(f"  ✅ {display_name}: Generated embedding ({len(embedding)} dimensions)")
            result[key] = embedding
        else:
            print(f"  ❌ {display_name}: Failed to generate embedding")
            result[key] = None
    
    return result


def main():
    print("=" * 80)
    print("Generating Embeddings for System Outputs")
    print("=" * 80)
    print(f"Model: {EMBEDDING_MODEL}")
    print(f"Input: {INPUT_FILE}")
    print(f"Output: {OUTPUT_FILE}")
    
    if START_INDEX is not None and END_INDEX is not None:
        print(f"Range: {START_INDEX} to {END_INDEX} (processing {END_INDEX - START_INDEX} items)")
    else:
        print("Range: All items")
    
    print("=" * 80)
    
    # Initialize OpenAI client
    print("\nInitializing OpenAI client...")
    client = OpenAI(api_key=OPENAI_API_KEY)
    print("  ✅ Client initialized")
    
    # Load input file
    print(f"\nLoading {INPUT_FILE}...")
    try:
        with open(INPUT_FILE, 'r') as f:
            comparison_data = json.load(f)
        print(f"  ✅ Loaded {len(comparison_data)} comparison items")
    except FileNotFoundError:
        print(f"  ❌ Error: File not found - {INPUT_FILE}")
        sys.exit(1)
    except json.JSONDecodeError as e:
        print(f"  ❌ Error: Invalid JSON - {e}")
        sys.exit(1)
    
    # Apply range filtering
    if START_INDEX is not None and END_INDEX is not None:
        original_count = len(comparison_data)
        comparison_data = comparison_data[START_INDEX:END_INDEX]
        print(f"  📊 Filtered to range [{START_INDEX}:{END_INDEX}] = {len(comparison_data)} items (from {original_count} total)")
    
    # Process each item
    print("\n" + "=" * 80)
    print("Processing Items")
    print("=" * 80)
    
    embeddings_results = []
    successful = 0
    partial = 0
    failed = 0
    
    for idx, item in enumerate(comparison_data):
        try:
            result = process_comparison_item(item, client, START_INDEX + idx if START_INDEX else idx)
            embeddings_results.append(result)
            
            # Count success status
            embeddings_count = sum(1 for v in [result.get("open_ai_only"), result.get("pllm_full")] if v is not None)
            
            if embeddings_count == 2:
                successful += 1
            elif embeddings_count > 0:
                partial += 1
            else:
                failed += 1
        
        except Exception as e:
            print(f"  ❌ Unexpected error processing item {idx}: {str(e)}")
            failed += 1
    
    # Save results
    print("\n" + "=" * 80)
    print("Saving Results")
    print("=" * 80)
    
    try:
        with open(OUTPUT_FILE, 'w') as f:
            json.dump(embeddings_results, f, indent=2)
        print(f"  ✅ Saved {len(embeddings_results)} embedding results to {OUTPUT_FILE}")
    except Exception as e:
        print(f"  ❌ Error saving results: {str(e)}")
        sys.exit(1)
    
    # Summary statistics
    print("\n" + "=" * 80)
    print("Summary Statistics")
    print("=" * 80)
    print(f"Total items processed: {len(embeddings_results)}")
    print(f"  ✅ Successful (both embeddings): {successful}")
    print(f"  ⚠️  Partial (1 embedding): {partial}")
    print(f"  ❌ Failed (0 embeddings): {failed}")
    print()
    
    # Calculate embedding dimensions (from first successful embedding)
    for result in embeddings_results:
        for key in ["open_ai_only", "pllm_full"]:
            if result.get(key) is not None:
                print(f"Embedding dimensions: {len(result[key])}")
                break
        else:
            continue
        break
    
    print("\n✅ Embedding generation complete!")
    print("=" * 80)


if __name__ == "__main__":
    main()

