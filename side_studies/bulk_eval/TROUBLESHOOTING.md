# Troubleshooting Full Multi-Agent Analysis

## Common Errors and Solutions

### 1. "Invalid image" Error

**Error Message:**
```
Error code: 400 - {'error': {'message': 'Invalid image.', 'type': 'invalid_request_error', 'param': None, 'code': 'invalid_image'}}
```

**Cause:**
The backend is trying to send an image (light curve or dE-dt map) to OpenAI's vision API, but the image is malformed or invalid.

**Possible Reasons:**
1. **Empty event list**: Source has too few events to create a valid visualization
2. **Base64 encoding issue**: Image encoding is incorrect
3. **Image too large**: Exceeds OpenAI's size limits
4. **PNG format issue**: Image generation failed

**Solutions:**

#### Solution 1: Check Backend Logs
```bash
# Check the backend logs for more details
tail -f /path/to/backend/logs/error.log
```

Look for errors from:
- `spectrum_processor.py` (light curve generation)
- `de_dt_map.py` (energy-time map generation)
- `infer.py` (OpenAI API calls)

#### Solution 2: Verify Event List Data
```python
# In your script, add validation:
event_list = source_data.get("original_event_list", [])
if len(event_list) < 10:
    print(f"⚠️  Warning: Only {len(event_list)} events - may cause image errors")
```

#### Solution 3: Backend Fix (if you have access)
In `src/internal/utils/spectrum_processor.py`:
```python
def create_light_curve_image(data_obj: Dict[str, Any]) -> Optional[str]:
    try:
        # Add validation
        event_list = data_obj.get("original_event_list") or data_obj.get("event_list", [])
        if not event_list or len(event_list) < 10:
            logger.warning(f"Insufficient events for light curve: {len(event_list)}")
            return None  # Skip image generation
        
        # ... existing code ...
    except Exception as e:
        logger.error(f"Error creating light curve image: {e}")
        return None  # Fail gracefully
```

#### Solution 4: Disable Image Generation (Temporary)
If the backend allows, you can disable image generation for MetadataAnalyst:
- This would require backend configuration changes
- Images are helpful but not strictly required for analysis

### 2. Timeout Error

**Error Message:**
```
❌ Timeout error for 2CXO J142003.6-493542 (1/2 completed)
🔓 RELEASING slot (timeout)
```

**Cause:**
The request exceeded the 600-second (10-minute) timeout.

**Possible Reasons:**
1. **ToolAgent stuck**: Research tool taking too long or hanging
2. **Backend overload**: Server processing is slow
3. **Network latency**: Slow connection to backend/OpenAI
4. **Model inference slow**: Fine-tuned model taking too long

**Solutions:**

#### Solution 1: Increase Timeout (Already Applied)
The timeout has been increased to 600 seconds (10 minutes). If still timing out:

```python
# In bulk_metadata_analysis.py, line ~218
timeout = aiohttp.ClientTimeout(total=900)  # Increase to 15 minutes
```

#### Solution 2: Disable ToolAgent Temporarily
If ToolAgent is causing issues, you can disable it:

```python
"agent_config": {
    "eventAnalyst": True,
    "metadataAnalyst": True,
    "neighborAnalyst": True,
    "critic": True,
    "toolAgent": False  # DISABLE if causing timeouts
}
```

#### Solution 3: Process One Source at a Time
Reduce concurrency to isolate the issue:

```bash
python3 bulk_metadata_analysis.py --concurrent 1
```

This helps identify if the issue is with a specific source or general slowness.

#### Solution 4: Check Backend Health
```bash
# Check if backend is responsive
curl http://localhost:8000/health

# Check backend logs for bottlenecks
tail -f /path/to/backend/logs/app.log
```

### 3. Processing Takes Too Long

**Expected Times:**
- **EventAnalyst**: ~15-20 seconds
- **MetadataAnalyst**: ~15-20 seconds
- **NeighborAnalyst**: ~10-15 seconds
- **Critic**: ~10-15 seconds
- **ToolAgent**: ~5-10 seconds
- **Total**: ~60-90 seconds per source

**If Taking Longer:**

1. **Check Backend Resources**:
   - CPU usage
   - Memory usage
   - GPU availability (for fine-tuned model)

2. **Check Network**:
   - Latency to backend
   - Latency to OpenAI API
   - Latency to fine-tuned model endpoint

3. **Reduce Concurrency**:
   ```bash
   # Use fewer concurrent requests
   python3 bulk_metadata_analysis.py --concurrent 2
   ```

### 4. Both Sources Failed

In your output:
```
Total sources:     2
✅ Successful:     0
❌ Failed:         2
Success rate:      0.0%
```

**Diagnosis Steps:**

#### Step 1: Test Backend Directly
```bash
# Test the streaming endpoint with curl
curl -X POST http://localhost:8000/v1/chat/stream \
  -H "Content-Type: application/json" \
  -d '{
    "message": "Test message",
    "history": [],
    "model": "astromind-multi-agent",
    "agent_config": {
      "eventAnalyst": false,
      "metadataAnalyst": true,
      "neighborAnalyst": false,
      "critic": false,
      "toolAgent": false
    }
  }'
```

#### Step 2: Test with Minimal Agent Config
Temporarily disable most agents to isolate the issue:

```python
"agent_config": {
    "eventAnalyst": False,
    "metadataAnalyst": True,   # Only this one
    "neighborAnalyst": False,
    "critic": False,
    "toolAgent": False
}
```

If this works, gradually enable agents one by one.

#### Step 3: Check Output File
```bash
cat scripts/bulk_eval/output_results_0_2.json | jq '.'
```

Look at the error messages in the output for more clues.

### 5. Backend Issues

#### Invalid Image - Backend Fix Required

The "Invalid image" error needs to be fixed in the backend. Here's what to check:

**File: `src/internal/utils/spectrum_processor.py`**

```python
def make_spectrum_snapshot(src: Dict[str, Any], bin_width: float = 0.25) -> Dict[str, Any]:
    # ... existing code ...
    
    # ISSUE: Check if event_list is valid before processing
    raw_event_list = src.get("original_event_list", [])
    if isinstance(raw_event_list, list) and len(raw_event_list) > 0:
        event_list = energy_filter_and_time_normalize_event_list(raw_event_list, 500, 7000)
    else:
        event_list = src.get("event_list", [])
    
    # ADD THIS CHECK:
    if not event_list or len(event_list) < 10:
        logger.warning(f"Insufficient events for spectrum: {len(event_list)}")
        return {"error": "Insufficient event data"}  # Return error instead of failing
```

**File: `src/internal/llm/openai/infer.py`**

```python
async def generate_openai_response(...):
    try:
        # Create images
        light_curve_image = create_light_curve_image(data_obj)
        de_dt_image = create_de_dt_image(data_obj)
        
        # ADD VALIDATION:
        images = []
        if light_curve_image and isinstance(light_curve_image, str) and len(light_curve_image) > 100:
            images.append(light_curve_image)
        else:
            logger.warning("Skipping invalid light curve image")
        
        if de_dt_image and isinstance(de_dt_image, str) and len(de_dt_image) > 100:
            images.append(de_dt_image)
        else:
            logger.warning("Skipping invalid dE-dt image")
        
        # Only pass images if we have valid ones
        images = images if images else None
        
        # ... rest of code ...
    except Exception as e:
        logger.error(f"Error in generate_openai_response: {e}")
        # Don't fail the entire request - return text-only response
        return await call_openai_api(prompt=formatted_prompt, ..., images=None)
```

## Recommended Workflow for Troubleshooting

### 1. Start Simple
```python
# Edit bulk_metadata_analysis.py
START_INDEX = 0
END_INDEX = 1  # Just one source

# Disable problematic agents
"agent_config": {
    "eventAnalyst": True,
    "metadataAnalyst": True,
    "neighborAnalyst": False,  # Disable
    "critic": False,           # Disable
    "toolAgent": False         # Disable
}
```

### 2. Test Incrementally
Once one source works:
1. Enable NeighborAnalyst
2. Enable Critic
3. Enable ToolAgent
4. Increase to 2 sources
5. Increase concurrency

### 3. Monitor Backend
While running:
```bash
# Terminal 1: Run script
python3 bulk_metadata_analysis.py

# Terminal 2: Monitor backend
tail -f backend_logs.txt

# Terminal 3: Monitor system resources
htop  # or Activity Monitor on macOS
```

## Quick Fixes Summary

| Error | Quick Fix |
|-------|-----------|
| Invalid image | Disable ToolAgent temporarily |
| Timeout | Increase timeout to 900s, reduce concurrency to 1 |
| Both failed | Test with minimal agent config (MetadataAnalyst only) |
| Slow processing | Reduce concurrency, check backend resources |
| Backend not responding | Restart backend, check health endpoint |

## Contact Backend Team

If issues persist, provide them with:
1. Full error message from `output_results_*.json`
2. Backend logs during the failed request
3. Source data that caused the error (RA, Dec, event count)
4. Agent configuration used

Example issue report:
```
Issue: Invalid image error during MetadataAnalyst execution
Source: 2CXO J142003.6-493542 (ID: 6814624b5072697270caaa92)
RA: 215.0150833, Dec: -49.59500000
Original event list: 150 events
Error: Error code: 400 - {'error': {'message': 'Invalid image.', ...}}
Agent config: All agents enabled
Backend version: [check]
```

