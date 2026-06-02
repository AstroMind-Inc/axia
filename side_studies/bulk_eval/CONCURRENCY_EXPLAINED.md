# Concurrency Control Explanation

## How the Semaphore Works

The script uses `asyncio.Semaphore` to ensure **maximum 5 concurrent streams** are active at any time.

### Code Structure

```python
class MetadataAnalyzer:
    MAX_ALLOWED_CONCURRENT = 5  # Hard limit
    
    def __init__(self, max_concurrent: int = 4):
        # Semaphore controls how many tasks can run simultaneously
        self.semaphore = asyncio.Semaphore(max_concurrent)
    
    async def analyze_source(self, source_data, source_index):
        # CRITICAL: Semaphore wraps the ENTIRE request/response cycle
        async with self.semaphore:
            # 1. Acquire slot (waits if 5 streams already active)
            print(f"🔒 ACQUIRED slot")
            
            # 2. Send request
            async with session.post(url, json=payload) as response:
                # 3. Stream entire response
                async for chunk in response.content.iter_chunked(65536):
                    # Process streaming data...
                    pass
            
            # 4. Return result
            print(f"🔓 RELEASING slot")
            return result
        # Semaphore automatically releases here
```

## Execution Flow

### With 15 sources and max_concurrent=4:

```
Time →
─────────────────────────────────────────────────────────────────

Slot 1: [Source 1 ████████████████] [Source 5 ████████████] [Source 9 ████]
Slot 2: [Source 2 ██████████████████] [Source 6 ██████████] [Source 10 ███]
Slot 3: [Source 3 ████████████] [Source 7 ████████████████] [Source 11 ████]
Slot 4: [Source 4 ██████████] [Source 8 ██████████████] [Source 12 ██████]

Waiting: [Source 13] [Source 14] [Source 15]
         ↑ Waits for slot to free up
```

### Key Points:

1. **Only 4 streams active** at any time (if max_concurrent=4)
2. **Source 5 waits** until Source 1 completes
3. **Source 6 waits** until Source 2 completes
4. **Each stream holds its slot** for the entire request/response cycle
5. **Slot releases** when response is fully processed

## Why This Protects Your Backend

### Without Semaphore (❌ Bad):
```python
# All 15 requests sent immediately!
tasks = [analyze_source(s) for s in sources]
results = await asyncio.gather(*tasks)
# Backend receives 15 simultaneous streams → OVERLOAD!
```

### With Semaphore (✅ Good):
```python
# Semaphore limits to 4 concurrent
async with self.semaphore:  # Blocks if 4 already active
    # Only 4 requests active at once
    async with session.post(...) as response:
        # Stream entire response while holding slot
        pass
# Slot released, next waiting task can proceed
```

## Console Output Example

### Starting (4 slots acquired):
```
[1/15] 🔒 ACQUIRED slot (3/4 available)
Processing: Source A
📡 Sending request...

[2/15] 🔒 ACQUIRED slot (2/4 available)
Processing: Source B
📡 Sending request...

[3/15] 🔒 ACQUIRED slot (1/4 available)
Processing: Source C
📡 Sending request...

[4/15] 🔒 ACQUIRED slot (0/4 available)
Processing: Source D
📡 Sending request...

[5/15] ⏳ WAITING for slot... (0/4 available)
```

### After Source A completes:
```
✅ Successfully analyzed Source A (1/15 completed)
🔓 RELEASING slot (semaphore will have 1/4 available)

[5/15] 🔒 ACQUIRED slot (0/4 available)  ← Source E takes freed slot
Processing: Source E
📡 Sending request...
```

## Verification

### Test with 2 sources (should see immediate acquisition):
```python
START_INDEX = 0
END_INDEX = 2
max_concurrent = 4
```

Output:
```
[1/2] 🔒 ACQUIRED slot (3/4 available)  ← Immediate
[2/2] 🔒 ACQUIRED slot (2/4 available)  ← Immediate
```

### Test with 10 sources (should see waiting):
```python
START_INDEX = 0
END_INDEX = 10
max_concurrent = 4
```

Output:
```
[1/10] 🔒 ACQUIRED slot (3/4 available)  ← Immediate
[2/10] 🔒 ACQUIRED slot (2/4 available)  ← Immediate
[3/10] 🔒 ACQUIRED slot (1/4 available)  ← Immediate
[4/10] 🔒 ACQUIRED slot (0/4 available)  ← Immediate
[5/10] ⏳ Waiting...                     ← WAITS until slot frees
...
✅ Successfully analyzed Source 1
🔓 RELEASING slot
[5/10] 🔒 ACQUIRED slot (0/4 available)  ← Takes freed slot
```

## Maximum Concurrency Enforcement

### Hard Limit (Class Level):
```python
MAX_ALLOWED_CONCURRENT = 5  # Cannot exceed this
```

### Enforcement (Two Layers):

**Layer 1: Constructor**
```python
if max_concurrent > self.MAX_ALLOWED_CONCURRENT:
    max_concurrent = self.MAX_ALLOWED_CONCURRENT  # Cap at 5
self.semaphore = asyncio.Semaphore(max_concurrent)
```

**Layer 2: Command-line**
```python
if args.concurrent > MetadataAnalyzer.MAX_ALLOWED_CONCURRENT:
    max_concurrent = MetadataAnalyzer.MAX_ALLOWED_CONCURRENT  # Cap at 5
```

### Examples:

```bash
# Safe: 4 concurrent
python3 bulk_metadata_analysis.py --concurrent 4
# ✅ Uses 4 slots

# At limit: 5 concurrent
python3 bulk_metadata_analysis.py --concurrent 5
# ✅ Uses 5 slots (maximum)

# Exceeds limit: Automatically capped
python3 bulk_metadata_analysis.py --concurrent 10
# ⚠️  WARNING: Requested 10, enforcing maximum: 5
# ✅ Uses 5 slots (capped)
```

## Why Semaphore Wraps Everything

### Critical Design:

```python
async with self.semaphore:  # ← Acquire slot
    # Build payload
    # Send request
    # Stream ENTIRE response
    # Process all events
    # Return result
# ← Release slot (automatic)
```

### Why This Works:

1. **Slot acquired** before sending request
2. **Slot held** during entire streaming response
3. **Slot released** only after response fully processed
4. **Next task** can only start when slot is freed

### What Would Be Wrong:

```python
# ❌ BAD: Semaphore only around request creation
async with self.semaphore:
    # Send request
    pass  # Slot released immediately!

# Stream response (no slot held)
async for chunk in response:  # ← Multiple streams active!
    pass
```

This would allow unlimited concurrent streams after initial request!

## Backend Protection

With semaphore properly wrapping the entire cycle:

✅ **Maximum 5 HTTP connections** to backend  
✅ **Maximum 5 streaming responses** being processed  
✅ **Maximum 5 OpenAI API calls** in flight  
✅ **Controlled memory usage** (5 responses buffered)  
✅ **Predictable load** on backend service  

## Summary

The semaphore ensures:
- ✅ **At most 5 concurrent streams** at any time
- ✅ **Each stream holds a slot** for its entire lifecycle
- ✅ **New streams wait** until a slot is freed
- ✅ **Backend is protected** from overload
- ✅ **Console shows** slot acquisition/release

Your backend is now properly protected! 🛡️

