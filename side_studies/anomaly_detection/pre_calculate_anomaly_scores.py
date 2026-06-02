#!/usr/bin/env python
"""
Script to pre-calculate anomaly scores for all vectors in Pinecone index
and store them in MongoDB for faster retrieval.

This script always drops previous anomaly data and performs a fresh calculation
to ensure the most up-to-date anomaly scores.

Usage:
    python pre_calculate_anomaly_scores.py [--batch-size BATCH_SIZE] [--max-vectors MAX_VECTORS]

Options:
    --batch-size         Batch size for processing vectors (default: 1000)
    --max-vectors        Maximum number of vectors to process (default: 100000)
"""

import argparse
import asyncio
import time
import os
import sys
import numpy as np
import pymongo
from datetime import datetime
import gc
import joblib
from typing import List, Dict, Any

# Add the project root to the Python path
script_dir = os.path.dirname(os.path.abspath(__file__))
project_root = os.path.dirname(os.path.dirname(script_dir))
sys.path.append(project_root)

from src.internal.common.logger import setup_logger
from src.internal.common.settings import get_settings
from src.pkg.services.anomaly_service import AnomalyDetectionService
from src.pkg.services.pinecorn import PineconeService
from src.pkg.utils.anomaly import load_model, detect_anomalies, calculate_anomaly_scores
from src.pkg.services.mongoDB import get_mongodb_service

# Initialize logger and settings
logger = setup_logger()
settings = get_settings()

# MongoDB collection configuration
MONGODB_DATABASE = "anomaly_detection"
MONGODB_COLLECTION = "anomaly_scores"
MONGODB_METADATA_COLLECTION = "anomaly_metadata"


async def get_mongodb_collection(collection_name):
    """Get MongoDB collection for storing anomaly scores."""
    mongodb_service = get_mongodb_service()
    return mongodb_service.get_collection(MONGODB_DATABASE, collection_name)


async def update_calculation_metadata(vectors_processed=0):
    """Update the metadata about the current calculation."""
    metadata_collection = await get_mongodb_collection(MONGODB_METADATA_COLLECTION)
    if metadata_collection is None:
        logger.error("Failed to get metadata collection")
        return

    # Prepare metadata
    current_time = datetime.utcnow()

    # Create model version based on model file timestamp
    model_version = None
    try:
        anomaly_service = AnomalyDetectionService()
        if os.path.exists(anomaly_service.model_path):
            mod_time = os.path.getmtime(anomaly_service.model_path)
            model_version = datetime.fromtimestamp(mod_time).isoformat()
    except Exception as e:
        logger.error(f"Error getting model version: {str(e)}")

    # Create metadata document
    metadata = {
        "metadata_type": "last_calculation",
        "timestamp": current_time,
        "last_updated": current_time,
        "vectors_processed": vectors_processed
    }

    if model_version:
        metadata["model_version"] = model_version

    # Remove any existing metadata and insert new
    try:
        metadata_collection.delete_many({"metadata_type": "last_calculation"})
        metadata_collection.insert_one(metadata)
        logger.info(f"Updated calculation metadata: {metadata}")
    except Exception as e:
        logger.error(f"Error updating calculation metadata: {str(e)}")


async def clear_existing_data():
    """Clear all existing anomaly scores and metadata from MongoDB."""
    # Clear scores
    scores_collection = await get_mongodb_collection(MONGODB_COLLECTION)
    if scores_collection is not None:  # Fixed the condition - compare with None
        try:
            result = scores_collection.delete_many({})
            logger.info(f"Cleared {result.deleted_count} existing anomaly scores")
        except Exception as e:
            logger.error(f"Error clearing existing scores: {str(e)}")

    # Clear metadata
    metadata_collection = await get_mongodb_collection(MONGODB_METADATA_COLLECTION)
    if metadata_collection is not None:  # Fixed the condition - compare with None
        try:
            result = metadata_collection.delete_many({})
            logger.info(f"Cleared {result.deleted_count} metadata documents")
        except Exception as e:
            logger.error(f"Error clearing metadata: {str(e)}")


async def create_indexes():
    """Create indexes for faster querying."""
    collection = await get_mongodb_collection(MONGODB_COLLECTION)
    if collection is None:  # Fixed: compare with None instead of boolean check
        logger.error("Failed to get collection for creating indexes")
        return

    try:
        # Drop existing indexes
        collection.drop_indexes()
        logger.info("Dropped existing indexes")

        # Create index on score for sorting
        collection.create_index([("score", pymongo.DESCENDING)], background=True)

        # Create index on vector_id for lookups
        collection.create_index([("vector_id", pymongo.ASCENDING)], unique=True, background=True)

        # Create index on observation_id for filtering
        collection.create_index([("observation_id", pymongo.ASCENDING)], background=True)

        # Create index on source_name for filtering
        collection.create_index([("source_name", pymongo.ASCENDING)], background=True)

        # Create compound index for filtering by both source_name and observation_id
        collection.create_index(
            [("source_name", pymongo.ASCENDING), ("observation_id", pymongo.ASCENDING)],
            background=True
        )

        logger.info("Created indexes for anomaly scores collection")
    except Exception as e:
        logger.error(f"Error creating indexes: {str(e)}")


async def store_anomaly_scores(scores_batch):
    """Store pre-calculated anomaly scores in MongoDB."""
    if not scores_batch:
        logger.warning("No scores to store")
        return 0

    collection = await get_mongodb_collection(MONGODB_COLLECTION)
    if collection is None:  # Fixed: compare with None instead of boolean check
        logger.error("Failed to get collection for storing scores")
        return 0

    try:
        # Ensure each document has a timestamp
        current_time = datetime.utcnow()
        for score in scores_batch:
            score["calculated_at"] = current_time

            # Convert NumPy types to Python native types for MongoDB compatibility
            for key, value in score.items():
                if isinstance(value, np.float32) or isinstance(value, np.float64):
                    score[key] = float(value)
                elif isinstance(value, np.int32) or isinstance(value, np.int64):
                    score[key] = int(value)

        # Use bulk insert for better performance
        result = collection.insert_many(scores_batch)
        return len(result.inserted_ids)
    except Exception as e:
        logger.error(f"Error storing anomaly scores: {str(e)}")
        return 0


async def calculate_batch_anomaly_scores(model, vectors_batch, pca_model=None):
    """
    Calculate anomaly scores for a batch of vectors.

    Args:
        model: Trained RandomForestClassifier
        vectors_batch: List of vectors with id, embedding, and metadata
        pca_model: Optional PCA model for dimension reduction

    Returns:
        List of dicts with vector_id, score, and metadata
    """
    try:
        # Extract embeddings
        embeddings = np.array([vector['embedding'] for vector in vectors_batch])

        # Apply PCA if available
        if pca_model is not None:
            original_dim = embeddings.shape[1]
            reduced_dim = pca_model.n_components_
            logger.info(f"Reducing dimensions from {original_dim} to {reduced_dim} with PCA")
            embeddings = pca_model.transform(embeddings)

        # Build similarity matrix for the batch
        from src.pkg.utils.anomaly import build_similarity_matrix
        sim_mat = build_similarity_matrix(model, embeddings, batch_size=100)

        # Calculate anomaly scores
        anomaly_scores = calculate_anomaly_scores(sim_mat)

        # Format results
        results = []
        for i, vector in enumerate(vectors_batch):
            # Extract observation_id and source_name from id or metadata
            observation_id = None
            source_name = None

            if '_' in vector['id']:
                parts = vector['id'].split('_', 2)
                if len(parts) >= 2:
                    observation_id = parts[1]
                if len(parts) >= 3:
                    source_name = parts[2]

            # Use metadata values if available
            metadata = vector['metadata']
            if not observation_id and 'observation_id' in metadata:
                observation_id = metadata['observation_id']
            elif not observation_id and 'obsid' in metadata:
                observation_id = str(metadata['obsid'])

            if not source_name and 'source_name' in metadata:
                source_name = metadata['source_name']
            elif not source_name and 'source' in metadata:
                source_name = metadata['source']

            # Create essential metadata (lightweight version)
            essential_metadata = {}
            for key, value in metadata.items():
                if key in ['observation_id', 'obsid', 'source_name', 'source', 'timestamp', 'source_type']:
                    essential_metadata[key] = value

            # Create result object
            result = {
                'vector_id': vector['id'],
                'score': float(anomaly_scores[i]),
                'metadata': essential_metadata,
                'observation_id': observation_id,
                'source_name': source_name
            }
            results.append(result)

        return results
    except Exception as e:
        logger.error(f"Error calculating batch anomaly scores: {str(e)}")
        return []


async def main():
    """Main function to pre-calculate anomaly scores."""
    parser = argparse.ArgumentParser(description='Pre-calculate anomaly scores and store in MongoDB')
    parser.add_argument('--batch-size', type=int, default=1000, help='Batch size for processing')
    parser.add_argument('--max-vectors', type=int, default=100000, help='Maximum vectors to process')
    args = parser.parse_args()

    try:
        # Start timing
        start_time = time.time()
        logger.info(f"Starting anomaly score pre-calculation with args: {args}")

        # Initialize the anomaly detection service
        logger.info("Initializing anomaly detection service...")
        anomaly_service = AnomalyDetectionService()

        # Check if model exists
        if not os.path.exists(anomaly_service.model_path):
            logger.error(f"Model file not found: {anomaly_service.model_path}")
            logger.error("Please train the model first using the 'train_model' endpoint")
            return 1

        # Load the model
        logger.info(f"Loading model from {anomaly_service.model_path}")
        model = load_model(anomaly_service.model_path)

        # Always clear existing data
        logger.info("Clearing all existing anomaly data")
        await clear_existing_data()

        # Create indexes
        await create_indexes()

        # Fetch all vectors with appropriate parameters
        logger.info(f"Fetching vectors from Pinecone (max: {args.max_vectors})")
        vectors = await anomaly_service.fetch_all_vectors(
            max_vectors=args.max_vectors,
            force_refresh=True  # Always get fresh data from Pinecone
        )

        if not vectors:
            logger.error("No vectors found in Pinecone")
            return 1

        logger.info(f"Fetched {len(vectors)} vectors from Pinecone")

        # Load PCA model if available
        pca_model = None
        if os.path.exists(anomaly_service._pca_model_path):
            logger.info(f"Loading PCA model from {anomaly_service._pca_model_path}")
            try:
                pca_model = joblib.load(anomaly_service._pca_model_path)
                logger.info(f"PCA model loaded, reducing dimensions to {pca_model.n_components_}")
            except Exception as e:
                logger.error(f"Error loading PCA model: {str(e)}")

        # Process vectors in batches
        batch_size = args.batch_size
        total_batches = (len(vectors) + batch_size - 1) // batch_size
        total_stored = 0

        logger.info(f"Processing {len(vectors)} vectors in {total_batches} batches of size {batch_size}")

        for batch_idx in range(total_batches):
            batch_start = batch_idx * batch_size
            batch_end = min((batch_idx + 1) * batch_size, len(vectors))
            batch = vectors[batch_start:batch_end]

            # Calculate progress percentage
            progress = (batch_idx / total_batches) * 100
            logger.info(f"Processing batch {batch_idx + 1}/{total_batches} ({progress:.1f}%)")

            # Calculate anomaly scores for batch
            scores = await calculate_batch_anomaly_scores(model, batch, pca_model)

            # Store scores in MongoDB
            stored_count = await store_anomaly_scores(scores)
            total_stored += stored_count
            logger.info(f"Stored {stored_count} anomaly scores (total: {total_stored})")

            # Run garbage collection to free memory
            gc.collect()

            # Small delay to avoid overloading the system
            await asyncio.sleep(0.1)

        # Update calculation metadata
        await update_calculation_metadata(vectors_processed=len(vectors))

        # Log completion
        elapsed_time = time.time() - start_time
        logger.info(f"Anomaly score pre-calculation completed in {elapsed_time:.2f} seconds")
        logger.info(f"Processed {len(vectors)} vectors and stored {total_stored} anomaly scores")

        return 0
    except Exception as e:
        logger.error(f"Error in pre-calculation script: {str(e)}", exc_info=True)
        return 1


if __name__ == "__main__":
    exit_code = asyncio.run(main())
    sys.exit(exit_code)