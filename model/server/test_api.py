#!/usr/bin/env python3
"""
Test script for the Deepseek-Qwen-Xray-7B API.
This script demonstrates how to make requests to the API.
"""

import requests
import json
import numpy as np
import argparse
import sys

def test_health(base_url):
    """Test the health check endpoint."""
    url = f"{base_url}/health"
    try:
        response = requests.get(url)
        response.raise_for_status()
        print(f"Health check response: {response.json()}")
        return True
    except Exception as e:
        print(f"Health check failed: {str(e)}")
        return False

def test_inference(base_url, embedding_file=None):
    """Test the inference endpoint with a sample embedding."""
    url = f"{base_url}/inference"
    
    # Create a sample embedding if none provided
    if embedding_file:
        try:
            with open(embedding_file, 'r') as f:
                data = json.load(f)
                if isinstance(data, list) and len(data) > 0:
                    # If it's a list of samples, take the first one
                    sample = data[0]
                    if 'embedding' in sample:
                        embedding = sample['embedding']
                    else:
                        embedding = sample
                else:
                    # If it's a single sample
                    if 'embedding' in data:
                        embedding = data['embedding']
                    else:
                        embedding = data
        except Exception as e:
            print(f"Error loading embedding file: {str(e)}")
            print("Using random embedding instead.")
            embedding = np.random.randn(64).tolist()
    else:
        # Generate a random embedding for testing
        embedding = np.random.randn(64).tolist()
    
    # Prepare the payload
    payload = {
        "xray_embedding": embedding,
        "prompt": "What type of source is this? Provide a detailed analysis.",
        "max_new_tokens": 100,  # Smaller for testing
        "temperature": 0.7
    }
    
    print("\nSending inference request...")
    try:
        response = requests.post(url, json=payload)
        response.raise_for_status()
        result = response.json()
        
        print("\nInference successful!")
        print("\nPrompt:")
        print(result["full_prompt"])
        print("\nGenerated Answer:")
        print(result["answer"])
        
        return True
    except requests.exceptions.HTTPError as e:
        print(f"HTTP Error: {e}")
        if hasattr(e, 'response') and e.response is not None:
            print(f"Response: {e.response.text}")
        return False
    except Exception as e:
        print(f"Error during inference: {str(e)}")
        return False

def main():
    parser = argparse.ArgumentParser(description="Test the Deepseek-Qwen-Xray-7B API")
    parser.add_argument("--url", default="http://localhost:8000", help="Base URL of the API")
    parser.add_argument("--embedding-file", help="Path to a JSON file containing embeddings")
    parser.add_argument("--health-only", action="store_true", help="Only test the health endpoint")
    
    args = parser.parse_args()
    
    # Test health endpoint
    if not test_health(args.url):
        print("Health check failed. Make sure the API is running.")
        sys.exit(1)
    
    # Test inference endpoint
    if not args.health_only:
        if not test_inference(args.url, args.embedding_file):
            print("Inference test failed.")
            sys.exit(1)
    
    print("\nAll tests completed successfully!")

if __name__ == "__main__":
    main() 