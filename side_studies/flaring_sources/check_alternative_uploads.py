import os
#!/usr/bin/env python3
"""
Script to check for alternative uploads of sources with missing embeddings.

This script searches across ALL documents in user_uploaded_sources to find
all instances of the sources that are missing embeddings, and checks if
any upload has complete data.
"""

import json
import sys
from typing import List, Dict, Any, Optional
from pymongo import MongoClient

# MongoDB connection string
MONGODB_URI = os.environ.get("MONGODB_URI", "")
DATABASE_NAME = "appdata"
COLLECTION_NAME = "user_uploaded_sources"

# Sources with missing embeddings (from previous extraction)
MISSING_EMBEDDINGS_SOURCES = [
    {"obsid": 3877, "source_name": "2CXO J163553.8-472540"},
    {"obsid": 7151, "source_name": "2CXO J025616.7+585756"},
    {"obsid": 15211, "source_name": "2CXO J095959.4+024646"},
    {"obsid": 24604, "source_name": "2CXO J134856.4+263944"}
]


def connect_to_mongodb(uri: str) -> MongoClient:
    """Connect to MongoDB and verify connection."""
    try:
        client = MongoClient(uri)
        client.admin.command('ping')
        print("✅ Connected to MongoDB")
        return client
    except Exception as e:
        print(f"❌ Failed to connect to MongoDB: {e}")
        sys.exit(1)


def find_all_instances(collection, obsid: int, source_name: str) -> List[Dict[str, Any]]:
    """
    Find ALL instances of a source across all upload documents.
    
    Returns list of dictionaries with:
    - document_id: The parent document _id
    - prefix: The upload prefix
    - source: The source object
    - upload_date: When it was uploaded
    """
    instances = []
    
    # Query for all documents containing this source
    query = {
        "objects": {
            "$elemMatch": {
                "obsid": obsid,
                "source_name": source_name
            }
        }
    }
    
    documents = collection.find(query)
    
    for doc in documents:
        # Extract matching objects
        for obj in doc.get("objects", []):
            if obj.get("obsid") == obsid and obj.get("source_name") == source_name:
                instances.append({
                    "document_id": str(doc.get("_id")),
                    "prefix": doc.get("prefix", "unknown"),
                    "upload_date": doc.get("uploadDate"),
                    "source": obj
                })
    
    return instances


def check_embeddings_quality(source_obj: Dict[str, Any]) -> Dict[str, bool]:
    """Check which embedding fields are present and valid."""
    return {
        "has_event_list": len(source_obj.get("event_list", [])) > 0,
        "has_original_event_list": len(source_obj.get("original_event_list", [])) > 0,
        "has_pca_64d": source_obj.get("pca_64d") is not None,
        "has_umap_2d": source_obj.get("umap_2d") is not None,
        "event_list_count": len(source_obj.get("event_list", [])),
        "original_event_list_count": len(source_obj.get("original_event_list", []))
    }


def is_complete(quality: Dict[str, bool]) -> bool:
    """Check if source has complete embeddings."""
    return (quality["has_event_list"] and 
            quality["has_pca_64d"] and 
            quality["has_umap_2d"])


def main():
    print("=" * 80)
    print("Checking Alternative Uploads for Missing Embeddings")
    print("=" * 80)
    print()
    
    # Connect to MongoDB
    print("🔌 Connecting to MongoDB...")
    client = connect_to_mongodb(MONGODB_URI)
    db = client[DATABASE_NAME]
    collection = db[COLLECTION_NAME]
    print(f"📊 Connected to: {DATABASE_NAME}.{COLLECTION_NAME}")
    print()
    
    # Check each source with missing embeddings
    print("=" * 80)
    print("Searching for Alternative Uploads")
    print("=" * 80)
    print()
    
    results = []
    
    for idx, target in enumerate(MISSING_EMBEDDINGS_SOURCES, 1):
        obsid = target["obsid"]
        source_name = target["source_name"]
        
        print(f"[{idx}/{len(MISSING_EMBEDDINGS_SOURCES)}] {source_name} (obsid: {obsid})")
        print("-" * 80)
        
        # Find all instances
        instances = find_all_instances(collection, obsid, source_name)
        
        if not instances:
            print("  ❌ No instances found")
            print()
            continue
        
        print(f"  📊 Found {len(instances)} upload(s)")
        print()
        
        complete_instances = []
        
        for i, instance in enumerate(instances, 1):
            quality = check_embeddings_quality(instance["source"])
            is_comp = is_complete(quality)
            
            status = "✅ COMPLETE" if is_comp else "⚠️  INCOMPLETE"
            
            print(f"  Upload {i}:")
            print(f"    Document ID: {instance['document_id']}")
            print(f"    Prefix: {instance['prefix']}")
            print(f"    Upload Date: {instance['upload_date']}")
            print(f"    Status: {status}")
            print(f"    Event list: {quality['event_list_count']} events {'✓' if quality['has_event_list'] else '✗'}")
            print(f"    Original event list: {quality['original_event_list_count']} events {'✓' if quality['has_original_event_list'] else '✗'}")
            print(f"    PCA 64D: {'✓' if quality['has_pca_64d'] else '✗'}")
            print(f"    UMAP 2D: {'✓' if quality['has_umap_2d'] else '✗'}")
            print()
            
            if is_comp:
                complete_instances.append(instance)
        
        results.append({
            "obsid": obsid,
            "source_name": source_name,
            "total_instances": len(instances),
            "complete_instances": len(complete_instances),
            "has_complete_alternative": len(complete_instances) > 0,
            "best_instance": complete_instances[0] if complete_instances else instances[0]
        })
        
        if complete_instances:
            print(f"  ✅ Found {len(complete_instances)} complete upload(s)!")
        else:
            print(f"  ❌ No complete uploads found")
        
        print()
    
    # Summary
    print("=" * 80)
    print("Summary")
    print("=" * 80)
    print()
    
    sources_with_alternatives = sum(1 for r in results if r["has_complete_alternative"])
    sources_without_alternatives = len(results) - sources_with_alternatives
    
    print(f"Sources checked: {len(results)}")
    print(f"✅ Sources with complete alternatives: {sources_with_alternatives}")
    print(f"❌ Sources still incomplete: {sources_without_alternatives}")
    print()
    
    if sources_with_alternatives > 0:
        print("✅ Sources that CAN be fixed:")
        for r in results:
            if r["has_complete_alternative"]:
                print(f"   - {r['source_name']} (obsid: {r['obsid']}) - {r['complete_instances']} complete upload(s)")
        print()
    
    if sources_without_alternatives > 0:
        print("❌ Sources that CANNOT be fixed (no complete uploads exist):")
        for r in results:
            if not r["has_complete_alternative"]:
                print(f"   - {r['source_name']} (obsid: {r['obsid']}) - {r['total_instances']} upload(s), all incomplete")
        print()
    
    # Save results
    output_file = "alternative_uploads_report.json"
    with open(output_file, 'w') as f:
        json.dump(results, f, indent=2, default=str)
    print(f"💾 Saved detailed report to {output_file}")
    print()
    
    print("=" * 80)
    
    # Close connection
    client.close()


if __name__ == "__main__":
    main()
