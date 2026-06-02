#!/usr/bin/env python3
"""
Script to extract flaring source data from MongoDB appdata.user_uploaded_sources collection.

This script:
1. Reads sources.json to get (obsid, source_name) pairs
2. Connects to MongoDB and queries the user_uploaded_sources collection
3. Searches through nested objects arrays to find matches
4. Extracts matching objects with event_list and original_event_list
5. Generates a JSON array suitable for bulk analysis
"""

import json
import sys
from typing import List, Dict, Any, Optional, Tuple
from pymongo import MongoClient
from pymongo.errors import ConnectionFailure, OperationFailure

# MongoDB connection string
MONGODB_URI = os.environ.get("MONGODB_URI", "")
DATABASE_NAME = "appdata"
COLLECTION_NAME = "user_uploaded_sources"

# File paths
SOURCES_FILE = "sources.json"
OUTPUT_JSON = "flaring_sources_extracted.json"


def load_target_sources(filepath: str) -> List[Dict[str, Any]]:
    """
    Load the list of target sources to search for.
    
    Args:
        filepath: Path to sources.json file
    
    Returns:
        List of source dictionaries with obsid and source_name
    """
    try:
        with open(filepath, 'r') as f:
            sources = json.load(f)
        print(f"✅ Loaded {len(sources)} target sources from {filepath}")
        return sources
    except FileNotFoundError:
        print(f"❌ Error: File not found - {filepath}")
        sys.exit(1)
    except json.JSONDecodeError as e:
        print(f"❌ Error: Invalid JSON - {e}")
        sys.exit(1)


def connect_to_mongodb(uri: str) -> MongoClient:
    """
    Connect to MongoDB and verify connection.
    
    Args:
        uri: MongoDB connection string
    
    Returns:
        MongoClient instance
    """
    try:
        client = MongoClient(uri)
        # Verify connection
        client.admin.command('ping')
        print("✅ Connected to MongoDB")
        return client
    except ConnectionFailure as e:
        print(f"❌ Failed to connect to MongoDB: {e}")
        sys.exit(1)


def search_for_source(
    collection, 
    obsid: int, 
    source_name: str
) -> Optional[Dict[str, Any]]:
    """
    Search for a specific source in the nested user_uploaded_sources structure.
    
    The collection has documents with this structure:
    {
        "_id": ...,
        "prefix": "...",
        "objects": [
            {
                "_id": "...",
                "obsid": 9769,
                "source_name": "2CXO J064059.9+092850",
                "event_list": [...],
                "original_event_list": [...],
                "pca_64d": [...],
                "umap_2d": [...]
            }
        ]
    }
    
    Args:
        collection: MongoDB collection object
        obsid: Observation ID
        source_name: Source name
    
    Returns:
        Source object if found, None otherwise
    """
    try:
        # Query for documents that have an object matching both obsid and source_name
        # Using $elemMatch to match objects within the objects array
        query = {
            "objects": {
                "$elemMatch": {
                    "obsid": obsid,
                    "source_name": source_name
                }
            }
        }
        
        # Find the document
        document = collection.find_one(query)
        
        if not document:
            return None
        
        # Extract the matching object from the objects array
        for obj in document.get("objects", []):
            if obj.get("obsid") == obsid and obj.get("source_name") == source_name:
                return obj
        
        return None
    
    except Exception as e:
        print(f"  ❌ Error searching for {source_name} (obsid: {obsid}): {e}")
        return None


def extract_source_data(source_obj: Dict[str, Any]) -> Dict[str, Any]:
    """
    Extract and format source data for output.
    
    Args:
        source_obj: Source object from MongoDB
    
    Returns:
        Formatted source dictionary
    """
    return {
        "_id": source_obj.get("_id"),
        "obsid": source_obj.get("obsid"),
        "source_name": source_obj.get("source_name"),
        "event_list": source_obj.get("event_list", []),
        "original_event_list": source_obj.get("original_event_list", []),
        "pca_64d": source_obj.get("pca_64d"),
        "umap_2d": source_obj.get("umap_2d"),
        "ra": source_obj.get("ra"),
        "dec": source_obj.get("dec")
    }


def main():
    print("=" * 80)
    print("Extracting Flaring Sources from MongoDB")
    print("=" * 80)
    print()
    
    # Load target sources
    print("📖 Loading target sources...")
    target_sources = load_target_sources(SOURCES_FILE)
    print()
    
    # Connect to MongoDB
    print("🔌 Connecting to MongoDB...")
    client = connect_to_mongodb(MONGODB_URI)
    db = client[DATABASE_NAME]
    collection = db[COLLECTION_NAME]
    print(f"📊 Connected to database: {DATABASE_NAME}")
    print(f"📦 Using collection: {COLLECTION_NAME}")
    print()
    
    # Count total documents in collection
    total_docs = collection.count_documents({})
    print(f"📈 Total documents in collection: {total_docs}")
    print()
    
    # Search for each target source
    print("=" * 80)
    print("Searching for Sources")
    print("=" * 80)
    print()
    
    extracted_sources = []
    found_count = 0
    not_found_count = 0
    not_found_list = []
    
    for idx, target in enumerate(target_sources, 1):
        obsid = target.get("obsid")
        source_name = target.get("source_name")
        
        print(f"[{idx}/{len(target_sources)}] Searching for {source_name} (obsid: {obsid})...")
        
        # Search for the source
        source_obj = search_for_source(collection, obsid, source_name)
        
        if source_obj:
            print(f"  ✅ Found!")
            extracted_data = extract_source_data(source_obj)
            extracted_sources.append(extracted_data)
            found_count += 1
            
            # Log data availability
            event_count = len(extracted_data.get("event_list", []))
            orig_event_count = len(extracted_data.get("original_event_list", []))
            has_pca = extracted_data.get("pca_64d") is not None
            has_umap = extracted_data.get("umap_2d") is not None
            
            print(f"     Event list: {event_count} events")
            print(f"     Original event list: {orig_event_count} events")
            print(f"     PCA 64D: {'✓' if has_pca else '✗'}")
            print(f"     UMAP 2D: {'✓' if has_umap else '✗'}")
        else:
            print(f"  ❌ Not found")
            not_found_count += 1
            not_found_list.append({
                "obsid": obsid,
                "source_name": source_name
            })
    
    print()
    print("=" * 80)
    print("Summary")
    print("=" * 80)
    print(f"Total target sources: {len(target_sources)}")
    print(f"✅ Found: {found_count}")
    print(f"❌ Not found: {not_found_count}")
    print(f"📊 Success rate: {100 * found_count / len(target_sources):.1f}%")
    print()
    
    if not_found_list:
        print("❌ Sources not found:")
        for src in not_found_list:
            print(f"   - {src['source_name']} (obsid: {src['obsid']})")
        print()
    
    # Save extracted sources
    if extracted_sources:
        print("💾 Saving extracted sources...")
        try:
            with open(OUTPUT_JSON, 'w') as f:
                json.dump(extracted_sources, f, indent=2)
            print(f"✅ Saved {len(extracted_sources)} sources to {OUTPUT_JSON}")
            
            # Calculate file size
            import os
            file_size_mb = os.path.getsize(OUTPUT_JSON) / (1024 * 1024)
            print(f"📁 File size: {file_size_mb:.2f} MB")
        except Exception as e:
            print(f"❌ Error saving file: {e}")
    else:
        print("⚠️  No sources found, skipping file save")
    
    print()
    print("=" * 80)
    print("✅ Extraction complete!")
    print("=" * 80)
    
    # Close MongoDB connection
    client.close()


if __name__ == "__main__":
    main()
