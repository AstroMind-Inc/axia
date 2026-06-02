# Bulk Metadata Analysis Script

This script processes astronomical sources using **only the MetadataAnalyst agent** from the AstroMind multi-agent system.

## 🎯 What It Does

- Reads sources from `input_sources.json`
- Sends each source to the streaming API endpoint (`/v1/chat/stream`)
- Captures real-time streaming responses (Server-Sent Events)
- Extracts metadata analysis, critic review, and final answers
- Outputs results to `output_results.json`

## 🔧 Configuration

**Enabled Agents:**
- ✅ **MetadataAnalyst** - Analyzes spectral/variability metadata
- ✅ **Critic** - Reviews and critiques the metadata analysis

**Disabled Agents:**
- ❌ EventAnalyst - Fine-tuned model analysis (disabled)
- ❌ NeighborAnalyst - Similarity comparison (disabled)
- ❌ ToolAgent - External research tools (disabled)

## 📋 Prerequisites

1. **Backend Running**: The AstroMind service must be running on `localhost:8000`
   ```bash
   # In the project root, run:
   python main.py
   ```

2. **Python Dependencies**: Install required packages
   ```bash
   pip install aiohttp
   ```

3. **Input File**: Ensure `input_sources.json` exists in the `scripts/` directory (already created)

## 🚀 How to Run

### Step 1: Ensure Backend is Running

```bash
# Terminal 1 - Start the backend service
cd <axia-root>
python main.py
```

Wait for the message:
```
INFO:     Uvicorn running on http://0.0.0.0:8000 (Press CTRL+C to quit)
```

### Step 2: Run the Analysis Script

```bash
# Terminal 2 - Run the bulk analysis (default: 4 concurrent requests)
cd <axia-root>/side_studies
python bulk_metadata_analysis.py

# Or specify custom concurrency
python bulk_metadata_analysis.py --concurrent 8
```

**Concurrency Options:**
- `--concurrent N` - Number of parallel requests (default: 4)
- Recommended: 3-5 for localhost, 10-20 for production servers
- Higher concurrency = faster but more server load

### Step 3: Monitor Progress

The script will show real-time progress with parallel processing:

```
================================================================================
🚀 AstroMind Bulk Metadata Analysis
================================================================================
API URL:      http://localhost:8000
Input:        scripts/input_sources.json
Output:       scripts/output_results.json
Agent:        MetadataAnalyst ONLY
Concurrency:  4 parallel requests
================================================================================

✅ Loaded 10 source(s) from input_sources.json

📊 Starting analysis of 10 source(s) with concurrency=4...
⏱️  Estimated time: 112-150 seconds

================================================================================
[1/10] Processing: 2CXO J064059.9+092850 (ID: sss_1)
================================================================================
[2/10] Processing: 2CXO J060921.5+241525 (ID: sss_2)
================================================================================
[3/10] Processing: 2CXO J160111.1-514025 (ID: sss_3)
================================================================================
[4/10] Processing: 2CXO J020816.1+110504 (ID: sss_4)
================================================================================
  ▶️  Started: Starting multi-agent analysis...
  ⏳ MetadataAnalyst: running - Analyzing metadata and spectral characteristics...
  ✅ MetadataAnalyst: Result received (2456 chars)
  🎯 Final response received (2678 chars)
  ✅ Analysis complete!
✅ Successfully analyzed 2CXO J064059.9+092850 (1/10 completed)
✅ Successfully analyzed 2CXO J060921.5+241525 (2/10 completed)
✅ Successfully analyzed 2CXO J160111.1-514025 (3/10 completed)
✅ Successfully analyzed 2CXO J020816.1+110504 (4/10 completed)

✅ Results saved to: scripts/output_results.json

================================================================================
📊 Analysis Summary
================================================================================
Total sources:     10
✅ Successful:     10
❌ Failed:         0
Success rate:      100.0%
⏱️  Total time:      125.3s (12.5s per source)
⚡ Concurrency:     4 parallel requests
================================================================================
```

## 📤 Output Format

The script generates `output_results.json` with this structure:

```json
[
  {
    "source_id": "sss_1",
    "source_name": "2CXO J064059.9+092850",
    "obsid": 9769,
    "status": "success",
    "question": "You are being presented with event data...",
    "metadata_analysis": "Full analysis from MetadataAnalyst...",
    "final_answer": "Final synthesized answer...",
    "agent_conversation": [
      {
        "agent": "MetadataAnalyst",
        "action": "analysis",
        "content": "Detailed analysis...",
        "prompt": "...",
        "model": "gpt-4"
      }
    ],
    "processing_steps": [
      {
        "agent": "MetadataAnalyst",
        "status": "running",
        "message": "Analyzing metadata..."
      }
    ],
    "timestamp": "2025-01-07T12:34:56.789012"
  }
]
```

## 🎨 Customization

### Change Concurrency

Run with different concurrency levels:

```bash
# Low concurrency (safer for limited resources)
python bulk_metadata_analysis.py --concurrent 2

# Default
python bulk_metadata_analysis.py --concurrent 4

# High concurrency (faster, needs good server)
python bulk_metadata_analysis.py --concurrent 10
```

### Change the API URL

Edit the script:

```python
API_BASE_URL = "http://localhost:8000"  # Change to your backend URL
```

### Change the Prompt

Edit the `ANALYSIS_PROMPT` variable in `bulk_metadata_analysis.py`:

```python
ANALYSIS_PROMPT = """Your custom prompt here..."""
```

### Add More Sources

Add more objects to `input_sources.json`:

```json
[
  {
    "_id": "source_1",
    "obsid": 9769,
    "source_name": "2CXO J064059.9+092850",
    "event_list": [...],
    "original_event_list": [...],
    "pca_64d": [...],
    "umap_2d": [...]
  },
  {
    "_id": "source_2",
    "obsid": 12345,
    "source_name": "Another Source",
    ...
  }
]
```

### Enable Other Agents

To enable additional agents, modify the `agent_config` in the script:

```python
"agent_config": {
    "eventAnalyst": True,        # Enable event analysis
    "metadataAnalyst": True,     # Keep metadata
    "neighborAnalyst": False,    # Keep disabled
    "critic": True,              # Enable critic
    "toolAgent": False           # Keep disabled
}
```

## 🐛 Troubleshooting

### Error: "Connection refused"

**Problem**: Backend is not running

**Solution**:
```bash
# Start the backend first
python main.py
```

### Error: "Input file not found"

**Problem**: Running script from wrong directory

**Solution**:
```bash
# Make sure you're in the scripts directory
cd <axia-root>/side_studies
python bulk_metadata_analysis.py
```

### Error: "ModuleNotFoundError: No module named 'aiohttp'"

**Problem**: Missing dependencies

**Solution**:
```bash
pip install aiohttp
```

### Timeout Errors

**Problem**: Analysis takes too long (>300 seconds)

**Solution**: Increase timeout in the script:
```python
async with session.post(url, json=payload, timeout=aiohttp.ClientTimeout(total=600)) as response:
```

### Empty Results

**Problem**: MetadataAnalyst didn't produce output

**Solution**: Check the backend logs for errors:
```bash
# In the terminal running main.py, look for error messages
```

## 📊 Next Steps

1. **Review Results**: Open `output_results.json` to see the analysis
2. **Add More Sources**: Edit `input_sources.json` to process multiple sources
3. **Analyze Output**: Use the results for your research
4. **Export to CSV**: Convert JSON to CSV for easier analysis:

```python
import json
import pandas as pd

with open('output_results.json', 'r') as f:
    results = json.load(f)

df = pd.DataFrame(results)
df.to_csv('analysis_results.csv', index=False)
```

## 🔍 Understanding the Results

- **metadata_analysis**: Raw output from MetadataAnalyst agent
- **final_answer**: Final synthesized response (since no critic/moderator, this is just the metadata analysis)
- **agent_conversation**: Full conversation log with all agent interactions
- **processing_steps**: Timeline of processing steps
- **timestamp**: When the analysis was completed

## 📞 Support

If you encounter issues:

1. Check that the backend is running and accessible
2. Verify the input JSON is valid
3. Check backend logs for error messages
4. Ensure all dependencies are installed


