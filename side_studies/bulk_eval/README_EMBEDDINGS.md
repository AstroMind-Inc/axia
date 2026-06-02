# Embeddings Generation for System Outputs

This script generates vector embeddings for all system outputs using OpenAI's `text-embedding-ada-002` model. The embeddings can be used for similarity analysis, clustering, and comparing the semantic content of different systems' responses.

## Overview

The script processes the comparison file (`comparison_of_all_models.json`) and generates embeddings for each system's output:
- **open_ai_only** - Direct OpenAI GPT responses
- **pllm_meta_analyst_only** - AstroMind metadata analyst responses
- **pllm_full** - Full multi-agent AstroMind responses

## Requirements

- OpenAI API key set as environment variable: `OPENAI_API_KEY`
- Python 3.x with `openai` package installed

## Installation

```bash
# Install OpenAI Python client if not already installed
pip install openai
```

## Configuration

Edit `generate_embeddings.py` to configure:

```python
# Input/Output files
INPUT_FILE = "outputs/gpt-5.1/comparison_of_all_models.json"
OUTPUT_FILE = "embeddings_from_all.json"

# Embedding model
EMBEDDING_MODEL = "text-embedding-ada-002"

# Range-based processing (set to None to process all)
START_INDEX = 0   # Inclusive
END_INDEX = 5     # Exclusive (processes items 0,1,2,3,4)
```

## Usage

### Quick Start

```bash
# Set your OpenAI API key
export OPENAI_API_KEY=your_api_key_here

# Run the script
./run_embeddings.sh
```

### Manual Execution

```bash
cd scripts/bulk_eval
export OPENAI_API_KEY=your_api_key_here
python3 generate_embeddings.py
```

### Testing with Sample Data

For testing, use a small range by editing the script:

```python
START_INDEX = 0
END_INDEX = 5  # Only process first 5 items
```

### Processing All Data

To process all items, set the range variables to `None`:

```python
START_INDEX = None
END_INDEX = None
```

## Input Format

The script expects a JSON array from `comparison_of_all_models.json`:

```json
[
  {
    "id": "6814624b5072697270ca365f",
    "obsid": 18838,
    "source_name": "2CXO J123048.3+122334",
    "open_ai_only": "Long text response from OpenAI...",
    "pllm_meta_analyst_only": "Long text response from PLLM meta...",
    "pllm_full": "Long text response from PLLM full..."
  },
  ...
]
```

## Output Format

The script generates `embeddings_from_all.json` with embeddings replacing the text:

```json
[
  {
    "id": "6814624b5072697270ca365f",
    "obsid": 18838,
    "source_name": "2CXO J123048.3+122334",
    "open_ai_only": [0.012, -0.034, 0.056, ..., 0.078],
    "pllm_meta_analyst_only": [0.023, -0.045, 0.067, ..., 0.089],
    "pllm_full": [0.034, -0.056, 0.078, ..., 0.090]
  },
  ...
]
```

Each embedding is a 1536-dimensional vector (for `text-embedding-ada-002`).

## Features

- **Range-based Processing**: Process a subset of items for testing
- **Error Handling**: Gracefully handles missing or invalid text
- **Progress Tracking**: Displays detailed progress for each item
- **Statistics**: Reports success/failure counts
- **Null Handling**: Sets embedding to `null` if text is "Not available" or empty

## Example Output

```
================================================================================
Generating Embeddings for System Outputs
================================================================================
Model: text-embedding-ada-002
Input: outputs/gpt-5.1/comparison_of_all_models.json
Output: embeddings_from_all.json
Range: 0 to 5 (processing 5 items)
================================================================================

Initializing OpenAI client...
  ✅ Client initialized

Loading outputs/gpt-5.1/comparison_of_all_models.json...
  ✅ Loaded 100 comparison items
  📊 Filtered to range [0:5] = 5 items (from 100 total)

================================================================================
Processing Items
================================================================================

[1] Processing 2CXO J123048.3+122334 (obsid: 18838, id: 6814624b5072697270ca365f)
  🔄 OpenAI: Generating embedding (text length: 12543 chars)...
  ✅ OpenAI: Generated embedding (1536 dimensions)
  🔄 PLLM Meta: Generating embedding (text length: 8234 chars)...
  ✅ PLLM Meta: Generated embedding (1536 dimensions)
  🔄 PLLM Full: Generating embedding (text length: 15678 chars)...
  ✅ PLLM Full: Generated embedding (1536 dimensions)

...

================================================================================
Saving Results
================================================================================
  ✅ Saved 5 embedding results to embeddings_from_all.json

================================================================================
Summary Statistics
================================================================================
Total items processed: 5
  ✅ Successful (all 3 embeddings): 5
  ⚠️  Partial (1-2 embeddings): 0
  ❌ Failed (0 embeddings): 0

Embedding dimensions: 1536

✅ Embedding generation complete!
================================================================================
```

## Error Handling

The script handles various error conditions:

1. **Missing OpenAI API Key**: Exits with error message
2. **Missing Input File**: Reports error and exits
3. **Invalid JSON**: Reports parse error and exits
4. **Empty/Missing Text**: Sets embedding to `null`
5. **API Errors**: Logs error and sets embedding to `null` for that system

## Cost Considerations

OpenAI's `text-embedding-ada-002` model pricing (as of 2026):
- **Cost**: ~$0.10 per 1M tokens

For 100 sources with ~10,000 characters each per system (3 systems):
- Estimated tokens: ~750,000 tokens
- Estimated cost: ~$0.075

**Recommendation**: Always test with a small range first (e.g., 0-5) before processing all data.

## Use Cases

The generated embeddings can be used for:

1. **Similarity Analysis**: Compute cosine similarity between systems' responses
2. **Clustering**: Group similar responses using k-means or hierarchical clustering
3. **Dimensionality Reduction**: Apply t-SNE or UMAP to visualize response distributions
4. **Semantic Comparison**: Quantify how semantically different the systems' answers are
5. **Answer Quality Assessment**: Compare embeddings to ground-truth embeddings

## Next Steps

After generating embeddings, you can:

1. **Compute Similarity Scores**: Calculate cosine similarity between system pairs
2. **Visualize Embeddings**: Use t-SNE/UMAP to create 2D visualizations
3. **Cluster Analysis**: Identify patterns in how systems respond
4. **Ground Truth Comparison**: If you have expert annotations, compare embeddings

## Related Scripts

- `create_comparison.py` - Generates the input comparison file
- `merge_results.py` - Combines multiple result files
- `bulk_metadata_analysis.py` - Generates PLLM system results
- `bulk_openai_direct.py` - Generates OpenAI direct results

## Troubleshooting

### "OPENAI_API_KEY not set"
```bash
export OPENAI_API_KEY=your_api_key_here
```

### "Rate limit exceeded"
The script processes items sequentially. If you hit rate limits, add a delay between requests or reduce the batch size.

### "File not found"
Ensure you're running the script from the correct directory and the input file path is correct.

## Technical Details

- **Model**: `text-embedding-ada-002`
- **Embedding Dimensions**: 1536
- **Encoding Format**: float (default)
- **Input Token Limit**: ~8,191 tokens (automatically handled by OpenAI)
- **Processing**: Sequential (to avoid rate limits)

## OpenAI API Reference

For more information about the embeddings API:
- [OpenAI Embeddings Guide](https://platform.openai.com/docs/guides/embeddings)
- [API Reference](https://platform.openai.com/docs/api-reference/embeddings)

