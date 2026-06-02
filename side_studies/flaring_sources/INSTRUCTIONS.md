# Instructions for Running Flaring Sources Analysis

## 📦 Dependencies

Before running the analysis scripts, ensure you have the required packages installed:

```bash
# For OpenAI direct analysis (bulk_openai_direct.py):
pip install tiktoken

# Or if using Poetry:
poetry run pip install tiktoken
```

**Note:** `tiktoken` is required for token counting and automatic event list truncation to prevent context length errors.

## 🚀 Quick Start Guide

### 1. Start the Backend Service

Navigate to the project root and start the AstroMind service:

```bash
cd <axia-root>

# Option 1: Start with single worker (simpler, but slower)
poetry run uvicorn main:app --host 0.0.0.0 --port 8000

# Option 2: Start with multiple workers (recommended for better performance)
poetry run uvicorn main:app --host 0.0.0.0 --port 8000 --workers 2 --timeout-keep-alive 1200
```

**Important Notes:**
- Use `--workers 2` (or more) for better concurrent processing
- `--timeout-keep-alive 1200` sets a 20-minute timeout for long analyses
- The service will run on `http://localhost:8000`
- MongoDB persistence is currently disabled for performance (MongoDB Atlas latency issues)

**Check if service is running:**
```bash
curl http://localhost:8000/health
# Should return: {"status":"ok"}
```

### 2. Run the Bulk Analysis Script

In a **new terminal**, navigate to the flaring sources folder:

```bash
cd <axia-root>/side_studies/flaring_sources

# Run analysis for all 25 sources with 2 concurrent requests
poetry run python bulk_metadata_analysis.py --concurrent 2

# Or process a subset (e.g., first 10 sources)
poetry run python bulk_metadata_analysis.py --start 0 --end 10 --concurrent 2

# Or process remaining sources
poetry run python bulk_metadata_analysis.py --start 10 --end 25 --concurrent 2
```

## 📋 Command Options

### Backend Service Options:

| Option | Description | Recommended |
|--------|-------------|-------------|
| `--host 0.0.0.0` | Bind to all interfaces | Required |
| `--port 8000` | Port number | Required |
| `--workers N` | Number of worker processes | 2 (for concurrency) |
| `--timeout-keep-alive N` | Keep-alive timeout (seconds) | 1200 (20 min) |

### Bulk Analysis Script Options:

| Option | Description | Default | Example |
|--------|-------------|---------|---------|
| `--concurrent N` | Number of parallel requests | 2 | `--concurrent 4` |
| `--start N` | Start index (0-based) | 0 | `--start 10` |
| `--end N` | End index (exclusive) | 25 | `--end 20` |

## 📊 What to Expect

### Processing Time:
- **Per source:** ~30-60 seconds (full multi-agent analysis)
- **All 25 sources:** ~20-40 minutes (with 2 concurrent)
- **With 4 concurrent:** ~10-20 minutes

### Agent Configuration:
The script runs with:
- ✅ **EventAnalyst:** Enabled (21 sources have embeddings, 4 will skip)
- ✅ **MetadataAnalyst:** Enabled (all sources)
- ✅ **NeighborAnalyst:** Enabled (21 sources have neighbors, 4 will skip)
- ✅ **Critic:** Enabled (all sources)
- ✅ **ToolAgent:** Enabled (all sources)

### Output Files:

1. **`flaring_output_results_0_25.json`** - Analysis results for all sources
2. **`flaring_failed_sources.txt`** - Any sources that failed (obsid, source_name, error)

### Expected Results Format:

```json
[
  {
    "source_id": "sss_1",
    "source_name": "2CXO J123605.1+622013",
    "obsid": 957,
    "status": "success",
    "final_answer": "... detailed analysis ...",
    "event_analysis": "... or null if no embeddings ...",
    "metadata_analysis": "...",
    "neighbor_analysis": "... or null if no neighbors ...",
    "critic_review": "...",
    "tool_executions": [...],
    "neighbors_count": 10,
    "processing_time_s": 45.2,
    "timestamp": "2026-03-02T..."
  }
]
```

## 🔍 Monitoring Progress

### Watch Backend Logs:
The terminal running `uvicorn` will show:
```
DEBUG: Starting simple workflow for: ...
DEBUG: Step 1 - Calling metadata analysis...
✅ Light curve image generated...
DEBUG: Step 2 - Calling neighbor analysis...
...
```

### Watch Client Progress:
The terminal running `bulk_metadata_analysis.py` will show:
```
[1/25] 🔄 Analyzing 2CXO J123605.1+622013 (obsid: 957)...
   🎟️  Acquired slot 1/2
   📥 Receiving streaming response...
   ✅ Completed in 42.3s
[2/25] 🔄 Analyzing 2CXO J122531.5+130357 (obsid: 803)...
...
```

## ⚠️ Troubleshooting

### Backend Won't Start:
```bash
# Check if port 8000 is already in use
lsof -ti:8000

# Kill existing process
lsof -ti:8000 | xargs kill -9

# Restart the service
poetry run uvicorn main:app --host 0.0.0.0 --port 8000 --workers 2
```

### Script Can't Connect:
```bash
# Verify backend is running
curl http://localhost:8000/health

# Check if you're in the right directory
pwd
# Should be: .../scripts/bulk_eval/get_flaring_sources
```

### Timeouts Occurring:
- The timeout is set to 1000 seconds (16.6 minutes) in the script
- If timeouts persist, run with `--concurrent 1` for sequential processing
- Check backend logs for stuck operations

### Out of Memory:
- Reduce concurrent requests: `--concurrent 1`
- Process in smaller batches: `--start 0 --end 10`

## 📁 File Structure

```
scripts/bulk_eval/get_flaring_sources/
├── sources.json                           # Original 25 sources list
├── flaring_sources_extracted.json         # Extracted from MongoDB (13 MB)
├── flaring_sources_with_neighbors.json    # With neighbors (57 MB) ← INPUT
├── bulk_metadata_analysis.py              # Analysis script
├── flaring_output_results_0_25.json       # Results ← OUTPUT
├── flaring_failed_sources.txt             # Failed sources log
├── extract_flaring_sources.py             # Extraction script
├── add_neighbors_to_flaring.py            # Neighbor enrichment script
├── check_alternative_uploads.py           # Upload checker
└── README*.md                             # Documentation
```

## 🎯 Example Workflow

### Full Analysis (All 25 Sources):
```bash
# Terminal 1: Start backend
cd <axia-root>
poetry run uvicorn main:app --host 0.0.0.0 --port 8000 --workers 2 --timeout-keep-alive 1200

# Terminal 2: Run analysis
cd <axia-root>/side_studies/flaring_sources
poetry run python bulk_metadata_analysis.py --concurrent 2

# Wait ~20-40 minutes
# Check output: flaring_output_results_0_25.json
```

### Test Run (First 5 Sources):
```bash
# Terminal 1: Start backend (same as above)

# Terminal 2: Test with first 5
poetry run python bulk_metadata_analysis.py --start 0 --end 5 --concurrent 2

# Should complete in ~5-10 minutes
# Check output: flaring_output_results_0_5.json
```

### Process in Batches:
```bash
# Batch 1: First 10
poetry run python bulk_metadata_analysis.py --start 0 --end 10 --concurrent 2

# Batch 2: Next 10
poetry run python bulk_metadata_analysis.py --start 10 --end 20 --concurrent 2

# Batch 3: Last 5
poetry run python bulk_metadata_analysis.py --start 20 --end 25 --concurrent 2
```

## ✅ Success Checklist

- [ ] Backend service is running on port 8000
- [ ] You're in the correct directory (`get_flaring_sources/`)
- [ ] Input file exists: `flaring_sources_with_neighbors.json`
- [ ] Python environment is activated (Poetry)
- [ ] MongoDB Atlas is accessible (if you get connection errors, that's OK - persistence is disabled)
- [ ] Sufficient disk space (~100 MB for output)

## 📞 Quick Reference

| Task | Command |
|------|---------|
| Install dependencies | `poetry run pip install tiktoken` |
| Start backend | `poetry run uvicorn main:app --host 0.0.0.0 --port 8000 --workers 2` |
| Stop backend | `Ctrl+C` or `lsof -ti:8000 \| xargs kill -9` |
| Run PLLM analysis (all) | `poetry run python bulk_metadata_analysis.py --concurrent 2` |
| Run PLLM analysis (test) | `poetry run python bulk_metadata_analysis.py --end 5 --concurrent 2` |
| Run OpenAI analysis (all) | `poetry run python bulk_openai_direct.py --concurrent 2` |
| Run OpenAI analysis (test) | `poetry run python bulk_openai_direct.py --end 5 --concurrent 2` |
| Create comparison | `poetry run python create_comparison_wo_meta_only_agent.py` |
| Check backend health | `curl http://localhost:8000/health` |
| View output | `cat flaring_output_results_0_25.json \| jq '.[0]'` (if jq installed) |

---

## 🔬 OpenAI Direct Analysis (Optional)

If you want to compare PLLM results with OpenAI's direct analysis:

```bash
# Run OpenAI direct analysis (no backend needed)
cd <axia-root>/side_studies/flaring_sources

# Process all 25 sources
poetry run python bulk_openai_direct.py --concurrent 2

# Or test with first 5
poetry run python bulk_openai_direct.py --start 0 --end 5 --concurrent 2
```

**This will create:**
- `flaring_openai_results_0_25.json` - OpenAI direct results

**Notes:**
- No backend service needed (calls OpenAI API directly)
- Uses only event list data (no metadata leak)
- Takes ~15-30 minutes for all 25 sources
- Useful for comparison studies
- **Automatic token management**: If event lists exceed 250k tokens, they are automatically truncated to fit. The output includes:
  - `"event_list_truncated": true/false` - Whether truncation occurred
  - `"original_event_count"` - Original number of events
  - `"truncated_event_count"` - Number of events after truncation (if applicable)

---

## 📊 Creating Comparison Files

After running both analyses (PLLM and OpenAI), create comparison files:

```bash
cd <axia-root>/side_studies/flaring_sources

# Create comparison JSON files
poetry run python create_comparison_wo_meta_only_agent.py
```

**This will create:**
- `flaring_comparison_of_all_models.json` - Basic comparison (answers only)
- `flaring_comparison_of_all_models_with_catalog_data.json` - Comparison with full catalog metadata

**Comparison files include:**
- Side-by-side answers from OpenAI and PLLM
- Truncation metadata (which sources had event lists truncated)
- Agent metadata (which PLLM agents were used)
- Catalog data (for the version with catalog data)

**Requirements:**
- Both `flaring_openai_results_0_25.json` and `flaring_output_results_0_25.json` must exist
- Only includes sources where BOTH systems have answers (skips sources with failures)

Good luck with your flaring source analysis! 🌟
