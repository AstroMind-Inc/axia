# OpenAI Direct Analysis - README

## Overview

The `bulk_openai_direct.py` script calls OpenAI GPT-5-mini **directly** with only the event list data, excluding all other source metadata. This provides a baseline comparison to see how well OpenAI can analyze raw X-ray event data without pre-computed spectral fits or classifications.

## Purpose

Compare OpenAI's direct analysis (with event list only) against the full multi-agent system (with metadata, neighbors, specialized models).

## What Gets Sent to OpenAI

### Included:
- ✅ **Event list only**: `original_event_list` (time, energy pairs)
- ✅ **Coordinates**: RA/Dec in prompt (for astronomical context)
- ✅ **Analysis questions**: Same prompt as multi-agent system

### Excluded (to avoid leaking information):
- ❌ Source name
- ❌ ObsID
- ❌ Pre-computed spectral fits (powlaw_stat, bb_stat, etc.)
- ❌ Model parameters (powlaw_gamma, bb_kt, etc.)
- ❌ Hardness ratios
- ❌ Flux significance
- ❌ Variability index
- ❌ Source type classification
- ❌ Recommended models
- ❌ Neighbors
- ❌ Embeddings (PCA, UMAP)

## Configuration

Edit the top of `bulk_openai_direct.py`:

```python
INPUT_FILE = "input_sources.json"  # Original input (no neighbors needed)

# Range-based processing
START_INDEX = 0
END_INDEX = 2

# OpenAI Configuration
OPENAI_MODEL = "gpt-5-mini"
MAX_TOKENS = 10000
TEMPERATURE = 1.0  # GPT-5 uses temperature 1.0
```

## Prerequisites

### 1. OpenAI API Key

```bash
export OPENAI_API_KEY='your-api-key-here'
```

Get your API key from: https://platform.openai.com/api-keys

### 2. Install OpenAI Python Library

```bash
# In your Poetry environment
poetry add openai tenacity

# Or with pip
pip install openai tenacity
```

## Usage

### Option 1: Direct execution
```bash
cd scripts/bulk_eval/
export OPENAI_API_KEY='your-key'
python3 bulk_openai_direct.py --concurrent 4
```

### Option 2: Helper script
```bash
cd scripts/bulk_eval/
export OPENAI_API_KEY='your-key'
./run_openai_direct.sh --concurrent 4
```

## Example Run

```bash
# Test with 2 sources first
# Edit: START_INDEX=0, END_INDEX=2
python3 bulk_openai_direct.py --concurrent 4

# Output: openai_results_0_2.json
```

## Output Structure

```json
[
  {
    "source_id": "6814624c5072697270caeb78",
    "source_name": "2CXO J162623.3-242059",
    "obsid": 17249,
    "status": "success",
    "question": "You are being presented with event data... RA: 16h 26m 23.36s Dec: -24°21'00.16\"",
    "event_count": 1089,
    "model": "gpt-5-mini",
    "final_answer": "Based on the event data provided...",
    "timestamp": "2026-01-09T23:45:12.123456"
  },
  {
    "source_id": "6814624b5072697270caaa92",
    "source_name": "2CXO J142003.6-493542",
    "obsid": 18567,
    "status": "success",
    "question": "You are being presented with event data... RA: 14h 20m 03.62s Dec: -49°35'42.00\"",
    "event_count": 856,
    "model": "gpt-5-mini",
    "final_answer": "The X-ray event data shows...",
    "timestamp": "2026-01-09T23:45:15.456789"
  }
]
```

**Note**: `source_name` and `obsid` are included in the output for reference, but are **NOT** sent to OpenAI. Only the event list and coordinates are sent to the API.

## Performance

### Processing Time
- **Per source**: ~5-15 seconds (OpenAI API latency)
- **With concurrency=4**: Process 4 sources in parallel
- **For 100 sources**: ~8-20 minutes total

### API Costs
- **GPT-5-mini pricing**: ~$0.02-0.05 per source (estimated)
- **100 sources**: ~$2-5 USD total
- **Actual cost**: Depends on token usage

Check current pricing: https://openai.com/api/pricing/

## Comparison with Multi-Agent System

### OpenAI Direct (`bulk_openai_direct.py`)
- **Input**: Event list only (time, energy pairs)
- **Model**: GPT-5-mini
- **Processing**: Single OpenAI API call
- **Time**: ~5-15 seconds per source
- **Cost**: ~$0.02-0.05 per source

### Multi-Agent System (`bulk_metadata_analysis.py`)
- **Input**: Event list + neighbors (no pre-computed metadata)
- **Models**: Fine-tuned Qwen-7B + GPT-5-mini (multiple agents)
- **Processing**: EventAnalyst → MetadataAnalyst → NeighborAnalyst → Critic → ToolAgent
- **Time**: ~60-90 seconds per source
- **Cost**: Higher (multiple API calls + fine-tuned model inference)

## Event List Format

The event list is sent as JSON:

```json
{
  "event_list": [
    [528961712.8357176, 4706.927734375],
    [528961756.8097301, 1898.6405029296875],
    [528961766.23275054, 1292.361328125],
    ...
  ]
}
```

Each event: `[time_seconds, energy_eV]`

## Prompt Example

```
You are being presented with event data and metadata corresponding to the observation of an astrophysical high energy source with the Chandra X-ray observatory. Please assess the following:

1) What are appropriate spectral models to fit the spectrum of this source? Consider multi-component fits, and provide all options compatible with the data, ranked from more to less likely. Please also provide reasonable ranges for the model parameters

2) What sort of flux variability does the source display? Can you spot anything unusual regarding variability?

3) What are the likely types of this source, given all the information you have available?

The equatorial sexagesimal sky coordinates of the source are: RA: 16h 26m 23.36s Dec: -24°21'00.16"

EVENT DATA:
The event list is provided below in JSON format. Each event is represented as [time, energy]:
- Time: seconds since mission epoch (can be normalized)
- Energy: in eV (electron volts)

{
  "event_list": [
    [528961712.8357176, 4706.927734375],
    [528961756.8097301, 1898.6405029296875],
    ...
  ]
}

Please analyze this event data to answer the questions above.
```

## Error Handling

### Retry Logic
The script uses automatic retry with exponential backoff:
- **Attempts**: 3 retries
- **Wait time**: 2, 4, 10 seconds
- **Handles**: Rate limits, temporary API errors

### Rate Limits
OpenAI has rate limits:
- **Requests per minute**: Varies by tier
- **Tokens per minute**: Varies by tier

If you hit rate limits:
1. Reduce `--concurrent` value
2. Upgrade your OpenAI tier
3. Add delays between batches

### Error Output
```json
{
  "source_id": "...",
  "source_name": "2CXO J162623.3-242059",
  "obsid": 17249,
  "status": "error",
  "error": "Error message from OpenAI",
  "event_count": 1089,
  "timestamp": "..."
}
```

## Batching Strategy

For 100 sources, process in batches:

```bash
# Batch 1: 0-20
python3 bulk_openai_direct.py  # START_INDEX=0, END_INDEX=20

# Batch 2: 20-40
python3 bulk_openai_direct.py  # START_INDEX=20, END_INDEX=40

# Batch 3: 40-60
python3 bulk_openai_direct.py  # START_INDEX=40, END_INDEX=60

# Batch 4: 60-80
python3 bulk_openai_direct.py  # START_INDEX=60, END_INDEX=80

# Batch 5: 80-100
python3 bulk_openai_direct.py  # START_INDEX=80, END_INDEX=100
```

Then merge all outputs:
```bash
python3 << 'EOF'
import json
files = [f"openai_results_{i}_{i+20}.json" for i in range(0, 100, 20)]
all_results = []
for f in files:
    with open(f, 'r') as file:
        all_results.extend(json.load(file))
with open("openai_results_combined.json", 'w') as f:
    json.dump(all_results, f, indent=2)
print(f"✅ Combined {len(all_results)} results")
EOF
```

## Analysis Comparison

After running both systems, compare:

### 1. Spectral Model Predictions
- Which models did each system recommend?
- How accurate were the parameters?

### 2. Source Type Classifications
- Did OpenAI identify the correct source type?
- How did it compare to multi-agent + neighbors?

### 3. Variability Analysis
- Did OpenAI detect variability correctly?
- Were unusual features identified?

### 4. Confidence & Reasoning
- How confident was each system?
- What reasoning did they provide?

## Security Note

**Important**: This script intentionally excludes source names and metadata from being **sent to OpenAI**. However, `source_name` and `obsid` are included in the **output file** for your reference and later analysis.

**What OpenAI sees**: Only the event list (time, energy pairs) and coordinates in the prompt
**What you see in output**: source_id, source_name, obsid, analysis, etc.

This way, you can track which source was analyzed without identifying it to OpenAI during the analysis.

## Troubleshooting

### Issue: "OPENAI_API_KEY not set"
**Solution:**
```bash
export OPENAI_API_KEY='sk-proj-...'
python3 bulk_openai_direct.py
```

### Issue: Rate limit exceeded
**Solution:**
```bash
# Reduce concurrency
python3 bulk_openai_direct.py --concurrent 2

# Or add delays between batches
```

### Issue: Token limit exceeded
**Solution:**
Sources with very large event lists (>100K events) may exceed token limits. The script will fail for those sources. You can:
1. Skip sources with >50K events
2. Sample events (every Nth event)
3. Increase MAX_TOKENS (but costs more)

### Issue: Slow processing
OpenAI API latency varies:
- **GPT-5-mini**: Usually 5-15 seconds
- **Peak times**: May be slower
- **Solution**: Be patient or try off-peak hours

## Next Steps

1. **Run on small batch** (2-5 sources) to test
2. **Compare with multi-agent results** from `bulk_metadata_analysis.py`
3. **Analyze differences** in spectral models, source types, variability
4. **Scale up** to full 100 sources if results look good

## See Also

- `bulk_metadata_analysis.py` - Full multi-agent system
- `merge_results.py` - Merge batch results
- `COMPARISON.md` - Compare systems (create this after running both)

