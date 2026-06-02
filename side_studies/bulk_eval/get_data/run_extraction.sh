#!/bin/bash

# MongoDB Data Extraction Runner Script
# This script extracts source data from MongoDB based on test_data.csv

set -e  # Exit on error

echo "======================================"
echo "MongoDB Data Extraction"
echo "======================================"
echo ""

# Get script directory
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$SCRIPT_DIR"

# Check if CSV file exists
if [ ! -f "test_data.csv" ]; then
    echo "❌ Error: test_data.csv not found!"
    exit 1
fi

# Check if pymongo is installed
if ! python3 -c "import pymongo" 2>/dev/null; then
    echo "⚠️  pymongo not found. Installing..."
    pip3 install pymongo
fi

# Run extraction script
echo "🚀 Starting extraction..."
echo ""
python3 extract_from_mongodb.py

echo ""
echo "======================================"
echo "Done!"
echo "======================================"

