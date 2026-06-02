#!/bin/bash

# AstroMind Bulk Metadata Analysis Runner
# ========================================
# 
# This script runs the bulk metadata analysis with proper error checking.
#
# Usage: ./run_analysis.sh

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}================================================${NC}"
echo -e "${BLUE}🚀 AstroMind Bulk Metadata Analysis${NC}"
echo -e "${BLUE}================================================${NC}"
echo ""

# Get script directory
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$SCRIPT_DIR"

# Check if input file exists
if [ ! -f "input_sources.json" ]; then
    echo -e "${RED}❌ Error: input_sources.json not found${NC}"
    echo "   Please ensure the input file exists in the scripts/ directory"
    exit 1
fi

# Check if backend is running
echo -e "${YELLOW}🔍 Checking if backend is running...${NC}"
if ! curl -s http://localhost:8000/docs > /dev/null 2>&1; then
    echo -e "${RED}❌ Error: Backend is not running on localhost:8000${NC}"
    echo ""
    echo "   Please start the backend first:"
    echo -e "   ${GREEN}cd <axia-root>${NC}"
    echo -e "   ${GREEN}python main.py${NC}"
    echo ""
    exit 1
fi

echo -e "${GREEN}✅ Backend is running${NC}"
echo ""

# Check if Python is available
if ! command -v python3 &> /dev/null; then
    echo -e "${RED}❌ Error: python3 not found${NC}"
    exit 1
fi

# Check if aiohttp is installed
echo -e "${YELLOW}🔍 Checking dependencies...${NC}"
if ! python3 -c "import aiohttp" 2>/dev/null; then
    echo -e "${YELLOW}⚠️  aiohttp not found. Installing...${NC}"
    pip install aiohttp
fi

echo -e "${GREEN}✅ Dependencies OK${NC}"
echo ""

# Run the analysis
echo -e "${GREEN}🚀 Starting analysis...${NC}"
echo ""

python3 bulk_metadata_analysis.py

# Check exit code
if [ $? -eq 0 ]; then
    echo ""
    echo -e "${GREEN}================================================${NC}"
    echo -e "${GREEN}✅ Analysis completed successfully!${NC}"
    echo -e "${GREEN}================================================${NC}"
    echo ""
    echo -e "📄 Results saved to: ${BLUE}output_results.json${NC}"
    echo ""
    
    # Show quick summary
    if [ -f "output_results.json" ]; then
        echo "Quick view of results:"
        echo "---------------------"
        python3 -c "
import json
with open('output_results.json', 'r') as f:
    results = json.load(f)
    for r in results:
        status = '✅' if r.get('status') == 'success' else '❌'
        print(f\"{status} {r.get('source_name', 'Unknown')}: {r.get('status', 'unknown')}\")
"
    fi
else
    echo ""
    echo -e "${RED}================================================${NC}"
    echo -e "${RED}❌ Analysis failed${NC}"
    echo -e "${RED}================================================${NC}"
    exit 1
fi


