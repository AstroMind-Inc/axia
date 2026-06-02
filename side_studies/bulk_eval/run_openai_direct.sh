#!/bin/bash

# Run bulk OpenAI direct analysis

cd "$(dirname "$0")"

# Check if OPENAI_API_KEY is set
if [ -z "$OPENAI_API_KEY" ]; then
    echo "❌ Error: OPENAI_API_KEY environment variable not set"
    echo "   Please set it: export OPENAI_API_KEY='your-api-key'"
    exit 1
fi

echo "Running OpenAI direct analysis..."
python3 bulk_openai_direct.py "$@"

if [ $? -eq 0 ]; then
    echo ""
    echo "✅ Analysis completed successfully!"
else
    echo ""
    echo "❌ Analysis failed!"
    exit 1
fi

