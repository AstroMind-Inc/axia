#!/bin/bash

# Script to create comparison files from evaluation outputs

echo "Creating comparison files from evaluation outputs..."
echo ""

cd "$(dirname "$0")"

python3 create_comparison.py

echo ""
echo "Done!"

