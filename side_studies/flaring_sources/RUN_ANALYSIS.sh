#!/bin/bash
# Quick script to run flaring source analysis

echo "=========================================="
echo "Flaring Sources Analysis Runner"
echo "=========================================="
echo ""

# Check which analysis to run
PS3="Select analysis type: "
options=("PLLM Multi-Agent (needs backend)" "OpenAI Direct (no backend)" "Both" "Quit")
select opt in "${options[@]}"
do
    case $opt in
        "PLLM Multi-Agent (needs backend)")
            echo ""
            echo "Starting PLLM analysis..."
            echo "Make sure backend is running on port 8000!"
            echo ""
            poetry run python bulk_metadata_analysis.py --concurrent 2
            break
            ;;
        "OpenAI Direct (no backend)")
            echo ""
            echo "Starting OpenAI direct analysis..."
            echo ""
            poetry run python bulk_openai_direct.py --concurrent 2
            break
            ;;
        "Both")
            echo ""
            echo "Starting both analyses..."
            echo "Make sure backend is running on port 8000!"
            echo ""
            echo "1. Running OpenAI direct..."
            poetry run python bulk_openai_direct.py --concurrent 2
            echo ""
            echo "2. Running PLLM multi-agent..."
            poetry run python bulk_metadata_analysis.py --concurrent 2
            break
            ;;
        "Quit")
            break
            ;;
        *) echo "Invalid option $REPLY";;
    esac
done

echo ""
echo "=========================================="
echo "Analysis complete! Check output files:"
echo "  - flaring_openai_results_0_25.json"
echo "  - flaring_output_results_0_25.json"
echo "=========================================="
