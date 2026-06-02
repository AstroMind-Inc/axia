#!/bin/bash

# CSV Cleanup Runner Script
# Removes records with missing/X source_type and sorts by null count

set -e  # Exit on error

echo "======================================"
echo "CSV Cleanup"
echo "======================================"
echo ""

# Get script directory
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$SCRIPT_DIR"

# Check if input file exists
if [ ! -f "test_data.csv" ]; then
    echo "❌ Error: test_data.csv not found!"
    exit 1
fi

# Backup original file
if [ ! -f "test_data.csv.backup" ]; then
    echo "💾 Creating backup of test_data.csv..."
    cp test_data.csv test_data.csv.backup
    echo "   ✅ Backup saved as test_data.csv.backup"
    echo ""
fi

# Run cleanup script
echo "🚀 Starting cleanup..."
echo ""
python3 cleanup_csv.py

echo ""
echo "======================================"
echo "Done!"
echo "======================================"
echo ""
echo "Output file: processed_test_data.csv"

