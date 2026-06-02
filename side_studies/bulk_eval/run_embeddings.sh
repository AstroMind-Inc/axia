#!/bin/bash

# Script to generate embeddings for system outputs

echo "Generating embeddings for system outputs..."
echo ""

cd "$(dirname "$0")"

# Check if OPENAI_API_KEY is set
if [ -z "$OPENAI_API_KEY" ]; then
    echo "Error: OPENAI_API_KEY environment variable not set"
    echo "Please set it with: export OPENAI_API_KEY=your_api_key_here"
    exit 1
fi

python3 generate_embeddings.py

echo ""
echo "Done!"

