#!/usr/bin/env python
"""
Script to train the anomaly detection model using embeddings from Pinecone.
This script should be run periodically to update the model with new data.
"""

import asyncio
import numpy as np
import os
import sys
from src.pkg.services.anomaly_service import AnomalyDetectionService
from src.internal.common.logger import get_logger, setup_logger
from src.internal.common.settings import get_settings

logger = setup_logger()

settings = get_settings()

async def main():
    """
    Main function to train the anomaly detection model.
    """
    try:
        logger.info("Initializing anomaly detection service...")
        service = AnomalyDetectionService()
        
        logger.info("Training anomaly detection model...")
        logger.info(f"Training model with embedding dimension: {service.embedding_dimension}")
        
        # Train the model using all available vectors
        result = await service.train_model()
        
        if result["success"]:
            logger.info(f"Model trained successfully on {result['num_embeddings']} embeddings")
            logger.info(f"Model saved to {result['model_path']}")
            return 0
        else:
            logger.error(f"Failed to train model: {result['message']}")
            return 1
            
    except Exception as e:
        logger.error(f"Error training model: {str(e)}")
        return 1

if __name__ == "__main__":
    exit_code = asyncio.run(main())
    sys.exit(exit_code)
