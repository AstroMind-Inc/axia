#!/bin/bash

# Merge multiple bulk analysis result files into a single flattened JSON

cd "$(dirname "$0")"

echo "Merging bulk analysis results..."
python3 merge_results.py

if [ $? -eq 0 ]; then
    echo ""
    echo "✅ Merge completed successfully!"
    echo "📄 Check: combined_results.json"
else
    echo ""
    echo "❌ Merge failed!"
    exit 1
fi

