"""
Script to extract source data from MongoDB user_uploaded_sources collection
based on (obsid, source_name) pairs in test_data.csv

This script:
1. Reads test_data.csv to get (obsid, source_name) combinations
2. Connects to MongoDB and queries the user_uploaded_sources collection
3. Extracts matching objects from the objects array
4. Generates a JSON array suitable for bulk_metadata_analysis.py input
"""

import csv
import json
import os
from typing import List, Dict, Any, Optional
from pymongo import MongoClient
from pymongo.errors import ConnectionFailure, OperationFailure

# MongoDB connection string
MONGODB_URI = os.environ.get("MONGODB_URI", "")
DATABASE_NAME = "filedata"
COLLECTION_PROCESSED = "51k_v2_shuffled"  # Contains processed event_list, embeddings
COLLECTION_RAW = "raw_events"  # Contains original event_list, all metadata

# File paths
CSV_FILE = "processed_test_data.csv"  # Use cleaned CSV by default
OUTPUT_JSON = "../input_sources.json"

# Limit to top N records (sorted by quality, best first)
TOP_N_RECORDS = 1000


def read_csv_pairs(csv_path: str, limit: int = None) -> List[Dict[str, Any]]:
    """
    Read CSV file and extract (obsid, source_name) pairs along with metadata.
    
    Args:
        csv_path: Path to CSV file
        limit: Maximum number of records to read (None = all records)
    
    Returns:
        List of dictionaries with obsid, source_name, and metadata fields
    """
    pairs = []
    
    with open(csv_path, 'r', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        for idx, row in enumerate(reader, 1):
            # Convert numeric fields, handling NaN values
            obsid = int(row['obsid']) if row['obsid'] else None
            source_name = row['source_name']
            
            # Extract metadata fields from CSV
            def parse_float(value: str) -> Optional[float]:
                """Parse float value, return None for NaN or empty strings"""
                if not value or value.strip().upper() in ['NAN', 'NULL', '']:
                    return None
                try:
                    return float(value)
                except ValueError:
                    return None
            
            metadata = {
                'obsid': obsid,
                'source_name': source_name,
                'source_type': row.get('source_type') if row.get('source_type') != 'NaN' else None,
                'source_type_category': row.get('source_type_category') if row.get('source_type_category') else 'Other',
                'flux_significance_b': parse_float(row.get('flux_significance_b')),
                'powlaw_stat': parse_float(row.get('powlaw_stat')),
                'bb_stat': parse_float(row.get('bb_stat')),
                'brems_stat': parse_float(row.get('brems_stat')),
                'apec_stat': parse_float(row.get('apec_stat')),
                'powlaw_gamma': parse_float(row.get('powlaw_gamma')),
                'powlaw_nh': parse_float(row.get('powlaw_nh')),
                'powlaw_ampl': parse_float(row.get('powlaw_ampl')),
                'brems_kt': parse_float(row.get('brems_kt')),
                'bb_kt': parse_float(row.get('bb_kt')),
                'bb_nh': parse_float(row.get('bb_nh')),
                'bb_ampl': parse_float(row.get('bb_ampl')),
                'apec_kt': parse_float(row.get('apec_kt')),
                'apec_nh': parse_float(row.get('apec_nh')),
                'apec_norm': parse_float(row.get('apec_norm')),
                'apec_abund': parse_float(row.get('apec_abund')),
                'apec_z': parse_float(row.get('apec_z')),
                'hard_hs': parse_float(row.get('hard_hs')),
                'hard_hm': parse_float(row.get('hard_hm')),
                'hard_ms': parse_float(row.get('hard_ms')),
                'var_index_b': parse_float(row.get('var_index_b'))
            }
            
            pairs.append(metadata)
            
            # Check if we've reached the limit
            if limit and idx >= limit:
                print(f"⚠️  Limiting to top {limit} records")
                break
    
    print(f"✅ Read {len(pairs)} (obsid, source_name) pairs from CSV")
    return pairs


def connect_to_mongodb() -> Optional[MongoClient]:
    """
    Connect to MongoDB and return client.
    """
    try:
        client = MongoClient(MONGODB_URI, serverSelectionTimeoutMS=5000)
        # Test connection
        client.admin.command('ping')
        print("✅ Connected to MongoDB successfully")
        return client
    except ConnectionFailure as e:
        print(f"❌ Failed to connect to MongoDB: {e}")
        return None
    except Exception as e:
        print(f"❌ Unexpected error connecting to MongoDB: {e}")
        return None


def extract_sources_from_mongodb(
    client: MongoClient,
    csv_pairs: List[Dict[str, Any]]
) -> List[Dict[str, Any]]:
    """
    Extract source objects from MongoDB based on CSV pairs.
    
    Queries two collections:
    1. raw_events: Contains original_event_list and all observational metadata
    2. 51k_v2_shuffled: Contains processed event_list and embeddings
    
    Args:
        client: MongoDB client
        csv_pairs: List of (obsid, source_name) pairs with metadata from CSV
        
    Returns:
        List of source objects with all required fields merged from both collections
    """
    db = client[DATABASE_NAME]
    collection_raw = db[COLLECTION_RAW]
    collection_processed = db[COLLECTION_PROCESSED]
    
    results = []
    found_count = 0
    not_found_count = 0
    
    print(f"\n🔍 Searching for {len(csv_pairs)} sources across 2 collections...")
    print(f"   Collection 1: {DATABASE_NAME}.{COLLECTION_RAW} (original event_list + metadata)")
    print(f"   Collection 2: {DATABASE_NAME}.{COLLECTION_PROCESSED} (processed event_list + embeddings)\n")
    
    for i, csv_data in enumerate(csv_pairs, 1):
        obsid = csv_data['obsid']
        source_name = csv_data['source_name']
        
        if not obsid or not source_name:
            print(f"⚠️  [{i}/{len(csv_pairs)}] Skipping invalid entry: obsid={obsid}, source_name={source_name}")
            not_found_count += 1
            continue
        
        # Query for matching (obsid, source_name)
        query = {
            "obsid": obsid,
            "source_name": source_name
        }
        
        try:
            # Query Collection 1: raw_events (original event_list + metadata)
            raw_doc = collection_raw.find_one(query)
            
            # Query Collection 2: 51k_v2_shuffled (processed event_list + embeddings)
            processed_doc = collection_processed.find_one(query)
            
            if not raw_doc and not processed_doc:
                print(f"❌ [{i}/{len(csv_pairs)}] {source_name} (obsid={obsid}): Not found in any collection")
                not_found_count += 1
                continue
            
            # Start with raw_events data (has most metadata)
            merged_obj = {}
            
            if raw_doc:
                # Copy all fields from raw_events
                merged_obj = {**raw_doc}
                
                # Rename event_list to original_event_list
                if 'event_list' in merged_obj:
                    merged_obj['original_event_list'] = merged_obj.pop('event_list')
            
            if processed_doc:
                # Add processed event_list (overwrites if exists)
                if 'event_list' in processed_doc:
                    merged_obj['event_list'] = processed_doc['event_list']
                
                # Add embeddings
                if 'pca_64d' in processed_doc:
                    merged_obj['pca_64d'] = processed_doc['pca_64d']
                if 'umap_2d' in processed_doc:
                    merged_obj['umap_2d'] = processed_doc['umap_2d']
                
                # Add theta if not in raw_events
                if 'theta' not in merged_obj and 'theta' in processed_doc:
                    merged_obj['theta'] = processed_doc['theta']
            
            # Override with CSV metadata (CSV takes precedence for spectral stats)
            for key, value in csv_data.items():
                if key in ['obsid', 'source_name']:
                    continue  # Keep these from MongoDB
                if value is not None:  # Only override if CSV has a non-null value
                    merged_obj[key] = value
            
            # Validate required fields
            missing_fields = []
            if 'event_list' not in merged_obj or not merged_obj['event_list']:
                missing_fields.append('event_list')
            if 'original_event_list' not in merged_obj or not merged_obj['original_event_list']:
                missing_fields.append('original_event_list')
            
            if missing_fields:
                print(f"⚠️  [{i}/{len(csv_pairs)}] {source_name} (obsid={obsid}): "
                      f"Missing required fields: {', '.join(missing_fields)}")
                not_found_count += 1
                continue
            
            # Add display name if not present
            if 'name' not in merged_obj:
                merged_obj['name'] = f"{obsid} - {source_name}"
            
            # Convert MongoDB special types to regular Python types
            merged_obj = clean_mongodb_document(merged_obj)
            
            results.append(merged_obj)
            found_count += 1
            
            # Log key fields
            has_pca = 'pca_64d' in merged_obj and merged_obj['pca_64d']
            has_umap = 'umap_2d' in merged_obj and merged_obj['umap_2d']
            event_len = len(merged_obj['event_list'])
            original_len = len(merged_obj['original_event_list'])
            
            print(f"✅ [{i}/{len(csv_pairs)}] {source_name} (obsid={obsid}): "
                  f"events={event_len}, original={original_len}, "
                  f"pca={has_pca}, umap={has_umap}")
                
        except OperationFailure as e:
            print(f"❌ [{i}/{len(csv_pairs)}] MongoDB operation failed for {source_name}: {e}")
            not_found_count += 1
        except Exception as e:
            print(f"❌ [{i}/{len(csv_pairs)}] Error processing {source_name}: {e}")
            not_found_count += 1
    
    print(f"\n📊 Summary:")
    print(f"   Found: {found_count}")
    print(f"   Not found: {not_found_count}")
    print(f"   Total: {len(csv_pairs)}")
    
    return results


def clean_mongodb_document(doc: Dict[str, Any]) -> Dict[str, Any]:
    """
    Clean MongoDB document by converting special types to regular Python types.
    
    Args:
        doc: MongoDB document
        
    Returns:
        Cleaned document with regular Python types
    """
    import math
    from bson import ObjectId
    
    cleaned = {}
    for key, value in doc.items():
        # Convert ObjectId to string
        if isinstance(value, ObjectId):
            cleaned[key] = str(value)
        # Convert NaN to None
        elif isinstance(value, float) and math.isnan(value):
            cleaned[key] = None
        # Handle nested dicts (like $numberDouble)
        elif isinstance(value, dict):
            if '$numberDouble' in value:
                try:
                    num_val = float(value['$numberDouble'])
                    cleaned[key] = None if math.isnan(num_val) else num_val
                except (ValueError, TypeError):
                    cleaned[key] = None
            else:
                cleaned[key] = clean_mongodb_document(value)
        # Handle lists
        elif isinstance(value, list):
            cleaned[key] = [
                clean_mongodb_document(item) if isinstance(item, dict) else item
                for item in value
            ]
        else:
            cleaned[key] = value
    
    return cleaned


def save_to_json(data: List[Dict[str, Any]], output_path: str):
    """
    Save extracted data to JSON file.
    """
    try:
        with open(output_path, 'w', encoding='utf-8') as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
        print(f"\n✅ Saved {len(data)} sources to {output_path}")
        
        # Print file size
        file_size = os.path.getsize(output_path)
        size_mb = file_size / (1024 * 1024)
        print(f"   File size: {size_mb:.2f} MB")
        
    except Exception as e:
        print(f"❌ Failed to save JSON file: {e}")


def main():
    """Main execution function."""
    print("=" * 70)
    print("MongoDB Source Extraction Script")
    print("=" * 70)
    
    # Change to script directory
    script_dir = os.path.dirname(os.path.abspath(__file__))
    os.chdir(script_dir)
    print(f"📁 Working directory: {script_dir}\n")
    
    # Step 1: Read CSV
    print("Step 1: Reading CSV file...")
    print(f"   📊 Limiting to top {TOP_N_RECORDS} highest-quality records")
    csv_pairs = read_csv_pairs(CSV_FILE, limit=TOP_N_RECORDS)
    
    if not csv_pairs:
        print("❌ No data found in CSV file")
        return
    
    # Step 2: Connect to MongoDB
    print("\nStep 2: Connecting to MongoDB...")
    client = connect_to_mongodb()
    
    if not client:
        print("❌ Cannot proceed without MongoDB connection")
        return
    
    try:
        # Step 3: Extract sources
        print("\nStep 3: Extracting sources from MongoDB...")
        sources = extract_sources_from_mongodb(client, csv_pairs)
        
        if not sources:
            print("⚠️  No sources extracted from MongoDB")
            return
        
        # Step 4: Save to JSON
        print("\nStep 4: Saving to JSON file...")
        save_to_json(sources, OUTPUT_JSON)
        
        print("\n" + "=" * 70)
        print("✅ Extraction complete!")
        print("=" * 70)
        
    finally:
        # Always close MongoDB connection
        client.close()
        print("\n🔌 MongoDB connection closed")


if __name__ == "__main__":
    main()

