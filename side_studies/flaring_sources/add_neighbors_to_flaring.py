#!/usr/bin/env python3
"""
Add Nearest Neighbors to Flaring Sources
=========================================

This script enriches flaring_sources_extracted.json with nearest neighbors.
It uses MongoDB Atlas Vector Search to find the 10 most similar sources based on pca_64d vectors.

For sources without pca_64d vectors (those 4 sources with missing embeddings),
neighbors will be set to an empty array [].

Usage:
    python3 add_neighbors_to_flaring.py

Input:  flaring_sources_extracted.json
Output: flaring_sources_with_neighbors.json
"""

import json
import os
from typing import List, Dict, Any, Optional
from pymongo import MongoClient
from bson import ObjectId
from datetime import datetime

# ============================================================================
# CONFIGURATION
# ============================================================================

# MongoDB connection
MONGODB_URI = os.environ.get("MONGODB_URI", "")
DATABASE_NAME = "filedata"
COLLECTION_NAME = "51k_v2_shuffled"  # Collection to search for neighbors
VECTOR_INDEX_NAME = "pca_64_vector_search"  # Atlas Vector Search index name

# File paths
INPUT_FILE = "flaring_sources_extracted.json"
OUTPUT_FILE = "flaring_sources_with_neighbors.json"

# Neighbor search parameters
NUM_NEIGHBORS = 10  # Number of neighbors to fetch per source
VECTOR_SEARCH_CANDIDATES = 500  # Number of candidates to consider

# ============================================================================
# HELPER FUNCTIONS
# ============================================================================

def clean_mongodb_value(value: Any) -> Any:
    """
    Clean MongoDB-specific types for JSON serialization.
    
    Args:
        value: Value to clean
        
    Returns:
        Cleaned value suitable for JSON
    """
    if isinstance(value, ObjectId):
        return str(value)
    elif isinstance(value, datetime):
        return value.isoformat()
    elif isinstance(value, dict):
        if "$numberDouble" in value:
            return float(value["$numberDouble"])
        return {k: clean_mongodb_value(v) for k, v in value.items()}
    elif isinstance(value, list):
        return [clean_mongodb_value(item) for item in value]
    return value


def find_nearest_neighbors(
    collection,
    pca_vector: List[float],
    source_id: str,
    limit: int = NUM_NEIGHBORS
) -> List[Dict[str, Any]]:
    """
    Find nearest neighbors using MongoDB Atlas Vector Search.
    
    Args:
        collection: MongoDB collection
        pca_vector: PCA 64D vector to search with
        source_id: ID of the source (to exclude from results)
        limit: Number of neighbors to return
        
    Returns:
        List of neighbor documents
    """
    try:
        # MongoDB aggregation pipeline for vector search
        pipeline = [
            {
                "$vectorSearch": {
                    "index": VECTOR_INDEX_NAME,
                    "path": "pca_64d",
                    "queryVector": pca_vector,
                    "numCandidates": VECTOR_SEARCH_CANDIDATES,
                    "limit": limit + 1  # +1 to account for self
                }
            },
            {
                "$project": {
                    # Core identification
                    "_id": 1,
                    "obsid": 1,
                    "source_name": 1,
                    "source_type": 1,
                    "source_type_category": 1,
                    
                    # Event data (CRITICAL for NeighborAnalyst)
                    "event_list": 1,
                    
                    # Hardness ratios
                    "hard_hs": 1,
                    "hard_hm": 1,
                    "hard_ms": 1,
                    
                    # Flux and variability
                    "flux_significance_b": 1,
                    "var_index_b": 1,
                    
                    # Spectral model parameters
                    "bb_kt": 1,
                    "powlaw_gamma": 1,
                    "brems_kt": 1,
                    "apec_kt": 1,
                    
                    # Spectral fit statistics
                    "powlaw_stat": 1,
                    "bb_stat": 1,
                    "brems_stat": 1,
                    "apec_stat": 1,
                    
                    # NH parameters
                    "powlaw_nh": 1,
                    "apec_nh": 1,
                    "bb_nh": 1,
                    
                    # Model recommendation
                    "recommended_model": 1,
                    
                    # Similarity score from vector search
                    "score": {"$meta": "vectorSearchScore"}
                }
            }
        ]
        
        # Execute aggregation
        neighbors = list(collection.aggregate(pipeline))
        
        # Filter out the source itself
        filtered_neighbors = []
        for neighbor in neighbors:
            neighbor_id = str(neighbor.get("_id", ""))
            if neighbor_id != source_id:
                # Clean MongoDB types
                cleaned = clean_mongodb_value(neighbor)
                filtered_neighbors.append(cleaned)
                
                if len(filtered_neighbors) >= limit:
                    break
        
        return filtered_neighbors
        
    except Exception as e:
        print(f"   ⚠️  Error in vector search: {e}")
        return []


# ============================================================================
# MAIN PROCESSING
# ============================================================================

def main():
    """Main processing function."""
    print("=" * 80)
    print("ADD NEAREST NEIGHBORS TO FLARING SOURCES")
    print("=" * 80)
    print()
    print(f"📂 Input:  {INPUT_FILE}")
    print(f"📂 Output: {OUTPUT_FILE}")
    print(f"🔍 Collection: {DATABASE_NAME}.{COLLECTION_NAME}")
    print(f"🎯 Neighbors per source: {NUM_NEIGHBORS}")
    print()
    
    # Load input sources
    print("📥 Loading flaring sources...")
    try:
        with open(INPUT_FILE, 'r', encoding='utf-8') as f:
            sources = json.load(f)
        print(f"✅ Loaded {len(sources)} source(s)")
    except FileNotFoundError:
        print(f"❌ Error: Input file not found: {INPUT_FILE}")
        return 1
    except json.JSONDecodeError as e:
        print(f"❌ Error: Invalid JSON in input file: {e}")
        return 1
    
    if not sources:
        print("⚠️  No sources to process")
        return 0
    
    # Connect to MongoDB
    print()
    print("🔌 Connecting to MongoDB...")
    try:
        client = MongoClient(MONGODB_URI, serverSelectionTimeoutMS=5000)
        # Test connection
        client.server_info()
        print(f"✅ Connected to MongoDB")
        
        db = client[DATABASE_NAME]
        collection = db[COLLECTION_NAME]
        
        # Verify collection exists
        collection_names = db.list_collection_names()
        if COLLECTION_NAME not in collection_names:
            print(f"❌ Error: Collection '{COLLECTION_NAME}' not found in database '{DATABASE_NAME}'")
            print(f"   Available collections: {', '.join(collection_names)}")
            return 1
        
        print(f"✅ Using collection: {DATABASE_NAME}.{COLLECTION_NAME}")
        
    except Exception as e:
        print(f"❌ Error connecting to MongoDB: {e}")
        print(f"   Connection string: {MONGODB_URI[:50]}...")
        return 1
    
    # Process each source
    print()
    print("=" * 80)
    print("PROCESSING SOURCES")
    print("=" * 80)
    print()
    
    enriched_sources = []
    success_count = 0
    no_vector_count = 0
    no_neighbors_count = 0
    error_count = 0
    
    for i, source in enumerate(sources, 1):
        source_id = str(source.get("_id", "unknown"))
        source_name = source.get("source_name", "unknown")
        obsid = source.get("obsid", "unknown")
        
        print(f"[{i}/{len(sources)}] {source_name} (obsid: {obsid})")
        
        # Check if source has pca_64d vector
        pca_vector = source.get("pca_64d")
        if not pca_vector or not isinstance(pca_vector, list) or len(pca_vector) == 0:
            print(f"   ⚠️  No pca_64d vector available - neighbors set to []")
            no_vector_count += 1
            # Add source without neighbors (set to empty array like original script)
            source["neighbors"] = []
            enriched_sources.append(source)
            continue
        
        # Find nearest neighbors
        try:
            neighbors = find_nearest_neighbors(
                collection=collection,
                pca_vector=pca_vector,
                source_id=source_id,
                limit=NUM_NEIGHBORS
            )
            
            if neighbors:
                print(f"   ✅ Found {len(neighbors)} neighbor(s) (avg score: {sum(n.get('score', 0) for n in neighbors)/len(neighbors):.4f})")
                success_count += 1
            else:
                print(f"   ⚠️  No neighbors found")
                no_neighbors_count += 1
            
            # Add neighbors to source
            source["neighbors"] = neighbors
            enriched_sources.append(source)
            
        except Exception as e:
            print(f"   ❌ Error: {e}")
            error_count += 1
            # Add source with empty neighbors array
            source["neighbors"] = []
            enriched_sources.append(source)
    
    # Close MongoDB connection
    client.close()
    
    # Save enriched sources
    print()
    print("=" * 80)
    print("SAVING RESULTS")
    print("=" * 80)
    print()
    
    try:
        with open(OUTPUT_FILE, 'w', encoding='utf-8') as f:
            json.dump(enriched_sources, f, indent=2, ensure_ascii=False)
        
        # Get file size
        file_size = os.path.getsize(OUTPUT_FILE)
        size_mb = file_size / (1024 * 1024)
        
        print(f"✅ Saved enriched sources to: {OUTPUT_FILE}")
        print(f"📊 File size: {size_mb:.2f} MB")
        
    except Exception as e:
        print(f"❌ Error saving output file: {e}")
        return 1
    
    # Print summary
    print()
    print("=" * 80)
    print("SUMMARY")
    print("=" * 80)
    print(f"Total sources:           {len(sources)}")
    print(f"✅ With neighbors:       {success_count}")
    print(f"⚠️  No vector:            {no_vector_count}")
    print(f"⚠️  No neighbors found:   {no_neighbors_count}")
    print(f"❌ Errors:               {error_count}")
    print()
    
    # Breakdown by embedding status
    sources_with_empty = sum(1 for s in enriched_sources if len(s.get("neighbors", [])) == 0)
    sources_with_neighbors = sum(1 for s in enriched_sources if len(s.get("neighbors", [])) > 0)
    print(f"📊 Final breakdown:")
    print(f"   - Sources with neighbors: {sources_with_neighbors}")
    print(f"   - Sources with empty neighbors []: {sources_with_empty}")
    print()
    
    # Sample neighbor
    sources_with_actual_neighbors = [s for s in enriched_sources if s.get("neighbors")]
    if sources_with_actual_neighbors:
        print("=" * 80)
        print("SAMPLE NEIGHBOR (from first source with neighbors)")
        print("=" * 80)
        sample_source = sources_with_actual_neighbors[0]
        sample_neighbor = sample_source["neighbors"][0]
        print(f"Source: {sample_source.get('source_name')} (obsid: {sample_source.get('obsid')})")
        print(f"Neighbor: {sample_neighbor.get('source_name')} (score: {sample_neighbor.get('score', 0):.4f})")
        print(f"Fields included in neighbor:")
        for key in sorted(sample_neighbor.keys()):
            value = sample_neighbor[key]
            if isinstance(value, list):
                print(f"  - {key}: [{len(value)} items]")
            elif isinstance(value, (int, float)):
                print(f"  - {key}: {value}")
            else:
                print(f"  - {key}: {type(value).__name__}")
        print()
    
    print("✅ Neighbor enrichment complete!")
    print()
    
    return 0


if __name__ == "__main__":
    try:
        exit_code = main()
        exit(exit_code)
    except KeyboardInterrupt:
        print("\n⚠️  Interrupted by user")
        exit(130)
    except Exception as e:
        print(f"\n❌ Fatal error: {e}")
        import traceback
        traceback.print_exc()
        exit(1)
