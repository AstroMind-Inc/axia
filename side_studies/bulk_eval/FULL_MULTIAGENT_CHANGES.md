# Full Multi-Agent Analysis Configuration

## Overview

The `bulk_metadata_analysis.py` script has been updated to run **full multi-agent analysis** with all agents enabled, using sources enriched with nearest neighbors.

## Changes Made

### 1. Input File (Line 31)
**Before:**
```python
INPUT_FILE = "input_sources.json"
```

**After:**
```python
INPUT_FILE = "input_sources_with_neighbors.json"  # Updated to use neighbors
```

### 2. Agent Configuration (Lines 142-148)
**Before:**
```python
"agent_config": {
    "eventAnalyst": False,      # DISABLED
    "metadataAnalyst": True,     # ENABLED
    "neighborAnalyst": False,    # DISABLED
    "critic": True,              # ENABLED
    "toolAgent": False           # DISABLED
}
```

**After:**
```python
"agent_config": {
    "eventAnalyst": True,       # ENABLED ✅
    "metadataAnalyst": True,    # ENABLED ✅
    "neighborAnalyst": True,    # ENABLED ✅
    "critic": True,             # ENABLED ✅
    "toolAgent": True           # ENABLED ✅
}
```

### 3. Model API URL (Line 136)
**Before:**
```python
"model_api_url": "https://placeholder-not-used.com/",
```

**After:**
```python
"model_api_url": "<MODEL_SERVER_URL>",  # e.g. https://abc-8000.proxy.runpod.net/
```

### 4. Neighbors in Payload (Line 141)
**Before:**
```python
"neighbors": [],  # Empty array - neighbor analysis disabled
```

**After:**
```python
"neighbors": source_data.get("neighbors", []),  # Get neighbors from source data
```

### 5. Streaming Response Handling (Lines 179-192)
**Before:**
```python
# Collect streaming events
final_response = None
metadata_analysis = None
critic_review = None
agent_conversation = []
processing_steps = []
```

**After:**
```python
# Collect streaming events from all agents
final_response = None
event_analysis = None          # NEW ✅
metadata_analysis = None
neighbor_analysis = None        # NEW ✅
critic_review = None
tool_executions = []            # NEW ✅
agent_conversation = []
processing_steps = []
```

### 6. Agent Result Capture (Lines 227-241)
**Before:**
```python
# Capture metadata analysis and critic review
if agent == 'MetadataAnalyst':
    metadata_analysis = content
elif agent == 'Critic':
    critic_review = content
```

**After:**
```python
# Capture results from all agents
if agent == 'EventAnalyst':
    event_analysis = content
elif agent == 'MetadataAnalyst':
    metadata_analysis = content
elif agent == 'NeighborAnalyst':
    neighbor_analysis = content
elif agent == 'Critic':
    critic_review = content
elif agent == 'ToolAgent':
    # Tool agent results are usually in tool_executions
    pass
```

### 7. Final Result Extraction (Line 239)
**Before:**
```python
full_result = event.get('full_result', {})
final_response = full_result.get('response')
agent_conversation = full_result.get('agent_conversation', [])
```

**After:**
```python
full_result = event.get('full_result', {})
final_response = full_result.get('response')
agent_conversation = full_result.get('agent_conversation', [])
tool_executions = full_result.get('tool_executions', [])  # NEW ✅
```

### 8. Agent Conversation Fallback (Lines 266-276)
**Before:**
```python
# Extract metadata analysis and critic review from agent conversation if not captured
if not metadata_analysis and agent_conversation:
    for entry in agent_conversation:
        if entry.get('agent') == 'MetadataAnalyst':
            metadata_analysis = entry.get('content')
        elif entry.get('agent') == 'Critic':
            critic_review = entry.get('content')
```

**After:**
```python
# Extract agent results from agent conversation if not captured via streaming
if agent_conversation:
    for entry in agent_conversation:
        agent_name = entry.get('agent')
        content = entry.get('content')
        
        if agent_name == 'EventAnalyst' and not event_analysis:
            event_analysis = content
        elif agent_name == 'MetadataAnalyst' and not metadata_analysis:
            metadata_analysis = content
        elif agent_name == 'NeighborAnalyst' and not neighbor_analysis:
            neighbor_analysis = content
        elif agent_name == 'Critic' and not critic_review:
            critic_review = content
```

### 9. Output Result Structure (Lines 274-287)
**Before:**
```python
result = {
    "source_id": source_id,
    "source_name": source_name,
    "obsid": source_data.get("obsid"),
    "status": "success",
    "question": ANALYSIS_PROMPT,
    "metadata_analysis": metadata_analysis,
    "critic_review": critic_review,
    "final_answer": final_response,
    "agent_conversation": agent_conversation,
    "processing_steps": processing_steps,
    "payload_fields_sent": list(data_obj.keys()),
    "timestamp": datetime.now().isoformat()
}
```

**After:**
```python
result = {
    "source_id": source_id,
    "source_name": source_name,
    "obsid": source_data.get("obsid"),
    "status": "success",
    "question": ANALYSIS_PROMPT,
    "event_analysis": event_analysis,              # NEW ✅
    "metadata_analysis": metadata_analysis,
    "neighbor_analysis": neighbor_analysis,        # NEW ✅
    "critic_review": critic_review,
    "final_answer": final_response,
    "agent_conversation": agent_conversation,
    "tool_executions": tool_executions,            # NEW ✅
    "processing_steps": processing_steps,
    "payload_fields_sent": list(data_obj.keys()),
    "neighbors_count": len(source_data.get("neighbors", [])),  # NEW ✅
    "timestamp": datetime.now().isoformat()
}
```

### 10. Console Output Updates
**Before:**
```
Agents:       MetadataAnalyst + Critic
📦 Payload Strategy: MINIMAL DATA ONLY
   ✅ Sending: _id, obsid, source_name, event_list, original_event_list, embeddings
   ❌ Excluding: ALL pre-computed metadata
```

**After:**
```
Agents:       ALL ENABLED (Event, Metadata, Neighbor, Critic, Tool)
📦 Payload Strategy: MINIMAL DATA + NEIGHBORS
   ✅ Sending: _id, obsid, source_name, event_list, original_event_list, embeddings
   ✅ Neighbors: Each source includes 10 nearest neighbors with event_list
   ❌ Excluding: Pre-computed metadata
   🎯 Goal: Full multi-agent analysis with all specialized agents
```

## Updated merge_results.py

The merge script now includes all agent outputs:

```python
FIELDS_TO_KEEP = [
    "source_id",
    "source_name",
    "obsid",
    "status",
    "question",
    "payload_fields_sent",
    "neighbors_count",          # NEW ✅
    "timestamp",
    "event_analysis",           # NEW ✅
    "metadata_analysis",
    "neighbor_analysis",        # NEW ✅
    "critic_review",
    "final_answer",
]
```

## Output Structure

### Previous Output (Metadata Only)
```json
{
  "source_id": "...",
  "source_name": "...",
  "obsid": 17249,
  "status": "success",
  "question": "...",
  "metadata_analysis": "...",
  "critic_review": "...",
  "final_answer": "...",
  "payload_fields_sent": [...],
  "timestamp": "..."
}
```

### New Output (Full Multi-Agent)
```json
{
  "source_id": "...",
  "source_name": "...",
  "obsid": 17249,
  "status": "success",
  "question": "...",
  "event_analysis": "Analysis of raw event patterns...",
  "metadata_analysis": "Spectral analysis and models...",
  "neighbor_analysis": "Comparison with 10 similar sources...",
  "critic_review": "Critical review of all analyses...",
  "final_answer": "Synthesized final answer...",
  "agent_conversation": [...],
  "tool_executions": [...],
  "payload_fields_sent": [...],
  "neighbors_count": 10,
  "timestamp": "..."
}
```

## Agent Workflow

The full multi-agent workflow now runs in this sequence:

1. **EventAnalyst** → Analyzes raw event patterns using fine-tuned Qwen-7B model
2. **MetadataAnalyst** → Performs spectral analysis and model fitting
3. **NeighborAnalyst** → Compares with 10 nearest neighbors
4. **Critic** → Reviews all analyses for consistency
5. **ToolAgent** → Creates visualizations (light curves, dE-dt maps)
6. **ConversationModerator** → Synthesizes final answer

## Running the Updated Script

### Prerequisites
1. Run `add_neighbors.py` to create `input_sources_with_neighbors.json`
2. Ensure backend is running on `localhost:8000`
3. Fine-tuned model endpoint is accessible

### Execution
```bash
cd scripts/bulk_eval/

# Process a small batch first (to test)
# Edit START_INDEX=0, END_INDEX=2 in bulk_metadata_analysis.py
python3 bulk_metadata_analysis.py --concurrent 4

# Output: output_results_0_2.json
```

### Expected Processing Time
- **Previous (Metadata only)**: ~30-45 seconds per source
- **New (Full multi-agent)**: ~60-90 seconds per source
  - EventAnalyst: ~15-20 seconds (fine-tuned model inference)
  - MetadataAnalyst: ~15-20 seconds (spectrum analysis)
  - NeighborAnalyst: ~10-15 seconds (comparing 10 neighbors)
  - Critic: ~10-15 seconds (reviewing all analyses)
  - ToolAgent: ~5-10 seconds (generating visualizations)
  - Moderator: ~5-10 seconds (synthesizing final answer)

### For 100 Sources
- **Sequential**: ~100-150 minutes
- **With concurrency=4**: ~25-40 minutes
- **With concurrency=5** (max): ~20-30 minutes

## Important Notes

### Memory Usage
Full multi-agent analysis uses more memory:
- Neighbors data: ~10MB per source (10 neighbors × ~1MB each)
- Model inference: ~2GB VRAM for fine-tuned model
- Total: Monitor backend memory usage

### Error Handling
Each agent can fail independently:
- If EventAnalyst fails → Other agents continue
- If NeighborAnalyst fails → Check neighbors data
- Final answer is still generated even if some agents fail

### Debugging
To debug a specific agent:
1. Check `processing_steps` in output
2. Review `agent_conversation` for individual agent outputs
3. Check backend logs for model inference issues

## Verification Checklist

Before running on all 100 sources:

- [ ] `input_sources_with_neighbors.json` exists and has neighbors
- [ ] Backend is running and accessible
- [ ] Fine-tuned model endpoint is responsive
- [ ] Test with 2-3 sources first
- [ ] Check output has all agent results
- [ ] Verify neighbors are being used (check `neighbors_count` in output)

## Rollback

To revert to metadata-only analysis:

```python
# bulk_metadata_analysis.py
INPUT_FILE = "input_sources.json"

"agent_config": {
    "eventAnalyst": False,
    "metadataAnalyst": True,
    "neighborAnalyst": False,
    "critic": True,
    "toolAgent": False
}

"neighbors": [],
```

## See Also

- `add_neighbors.py` - Script to enrich sources with neighbors
- `README_NEIGHBORS.md` - Neighbor enrichment documentation
- `CONCURRENCY_EXPLAINED.md` - Concurrency control details
- `WORKFLOW.md` - Complete workflow documentation

