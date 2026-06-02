#!/bin/bash

# Add nearest neighbors to input sources using MongoDB Vector Search

cd "$(dirname "$0")"

echo "Adding nearest neighbors to input sources..."
echo ""

# Check if input file exists
if [ ! -f "../input_sources.json" ]; then
    echo "❌ Error: input_sources.json not found!"
    echo "   Expected location: ../input_sources.json"
    exit 1
fi

# Run the script
python3 add_neighbors.py

if [ $? -eq 0 ]; then
    echo ""
    echo "✅ Neighbor enrichment completed successfully!"
    echo "📄 Output: ../input_sources_with_neighbors.json"
else
    echo ""
    echo "❌ Neighbor enrichment failed!"
    exit 1
fi

