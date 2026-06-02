# Coordinates in Analysis Prompt - Implementation

## Overview

The bulk analysis script now includes source coordinates in the prompt, converted from decimal degrees to sexagesimal format.

## Changes Made

### 1. Coordinate Conversion Functions

Added two functions to convert coordinates:

```python
def decimal_to_sexagesimal_ra(ra_deg: float) -> str:
    """
    Convert decimal degrees RA to sexagesimal format.
    
    Example: 246.5973127° → "16h 26m 23.36s"
    """
    ra_deg = ra_deg % 360.0
    hours = ra_deg / 15.0  # RA in hours (360° = 24h)
    h = int(hours)
    minutes = (hours - h) * 60.0
    m = int(minutes)
    seconds = (minutes - m) * 60.0
    s = seconds
    return f"{h:02d}h {m:02d}m {s:05.2f}s"


def decimal_to_sexagesimal_dec(dec_deg: float) -> str:
    """
    Convert decimal degrees Dec to sexagesimal format.
    
    Example: -24.35004466° → "-24°21'00.16\""
    """
    sign = '+' if dec_deg >= 0 else '-'
    dec_abs = abs(dec_deg)
    degrees = int(dec_abs)
    arcminutes = (dec_abs - degrees) * 60.0
    arcmin = int(arcminutes)
    arcseconds = (arcminutes - arcmin) * 60.0
    arcsec = arcseconds
    return f"{sign}{degrees:02d}°{arcmin:02d}'{arcsec:05.2f}\""
```

### 2. Prompt Template

Changed from hardcoded prompt to template:

**Before:**
```python
ANALYSIS_PROMPT = """...(questions)..."""
```

**After:**
```python
ANALYSIS_PROMPT_TEMPLATE = """...(questions)...

The equatorial sexagesimal sky coordinates of the source are: RA: {ra_sex} Dec: {dec_sex}"""
```

### 3. Prompt Formatting Function

```python
def format_prompt_with_coordinates(ra: Optional[float], dec: Optional[float]) -> str:
    """Format the analysis prompt with source coordinates."""
    if ra is not None and dec is not None:
        ra_sex = decimal_to_sexagesimal_ra(ra)
        dec_sex = decimal_to_sexagesimal_dec(dec)
        return ANALYSIS_PROMPT_TEMPLATE.format(ra_sex=ra_sex, dec_sex=dec_sex)
    else:
        # Fallback if coordinates are missing
        return ANALYSIS_PROMPT_TEMPLATE.format(
            ra_sex="coordinates not available",
            dec_sex=""
        ).replace("The equatorial sexagesimal sky coordinates of the source are: RA: coordinates not available Dec: ", "")
```

### 4. Usage in analyze_source()

```python
async def analyze_source(self, source_data: Dict[str, Any], source_index: int = 0):
    source_id = source_data.get('_id', 'unknown')
    source_name = source_data.get('source_name', 'unknown')
    ra = source_data.get('ra')           # Get RA
    dec = source_data.get('dec')         # Get Dec
    
    # Format prompt with coordinates
    analysis_prompt = format_prompt_with_coordinates(ra, dec)
    
    # ... use analysis_prompt in payload ...
    payload = {
        "message": analysis_prompt,  # Customized per source
        # ...
    }
```

## Example Output

### Input Data
```json
{
  "_id": "6814624c5072697270caeb78",
  "source_name": "2CXO J162623.3-242059",
  "ra": 246.5973127,
  "dec": -24.35004466,
  "event_list": [...],
  "neighbors": [...]
}
```

### Generated Prompt
```
You are being presented with event data and metadata corresponding to the observation of an astrophysical high energy source with the Chandra X-ray observatory. Please assess the following:

1) What are appropriate spectral models to fit the spectrum of this source? Consider multi-component fits, and provide all options compatible with the data, ranked from more to less likely. Please also provide reasonable ranges for the model parameters

2) What sort of flux variability does the source display? Can you spot anything unusual regarding variability?

3) What are the likely types of this source, given all the information you have available?

The equatorial sexagesimal sky coordinates of the source are: RA: 16h 26m 23.36s Dec: -24°21'00.16"
```

## Conversion Examples

| Decimal | Sexagesimal |
|---------|-------------|
| RA: 246.5973127° | 16h 26m 23.36s |
| Dec: -24.35004466° | -24°21'00.16" |
| RA: 215.0150833° | 14h 20m 03.62s |
| Dec: -49.59500000° | -49°35'42.00" |
| RA: 0.0° | 00h 00m 00.00s |
| Dec: +90.0° | +90°00'00.00" |

## Benefits

1. **Standard Format**: Astronomers typically use sexagesimal coordinates
2. **Human Readable**: Easier to verify and understand
3. **Catalog Matching**: Can be cross-referenced with other catalogs
4. **LLM Context**: Helps the AI understand source location for classification

## Handling Missing Coordinates

If a source doesn't have RA/Dec:
```python
# Prompt will omit the coordinate line
# AI will still analyze other data
```

## Integration with Output

The generated prompt is saved in the output:

```json
{
  "source_id": "...",
  "source_name": "2CXO J162623.3-242059",
  "question": "You are being presented with event data... RA: 16h 26m 23.36s Dec: -24°21'00.16\"",
  "event_analysis": "...",
  "metadata_analysis": "...",
  "final_answer": "..."
}
```

## Testing

To test coordinate conversion:

```python
from bulk_metadata_analysis import decimal_to_sexagesimal_ra, decimal_to_sexagesimal_dec

# Test cases
test_coords = [
    (246.5973127, -24.35004466),  # 2CXO J162623.3-242059
    (215.0150833, -49.59500000),  # 2CXO J142003.6-493542
    (0.0, 0.0),                   # Origin
    (180.0, -90.0),               # South pole
]

for ra, dec in test_coords:
    ra_sex = decimal_to_sexagesimal_ra(ra)
    dec_sex = decimal_to_sexagesimal_dec(dec)
    print(f"({ra:>12.7f}, {dec:>12.7f}) → RA: {ra_sex:>15s} Dec: {dec_sex:>15s}")
```

Expected output:
```
(246.5973127, -24.3500447) → RA: 16h 26m 23.36s Dec: -24°21'00.16"
(215.0150833, -49.5950000) → RA: 14h 20m 03.62s Dec: -49°35'42.00"
(  0.0000000,   0.0000000) → RA: 00h 00m 00.00s Dec: +00°00'00.00"
(180.0000000, -90.0000000) → RA: 12h 00m 00.00s Dec: -90°00'00.00"
```

## Verification

To verify coordinates are being used:

```bash
# Run with 1 source
cd scripts/bulk_eval/
python3 bulk_metadata_analysis.py

# Check output
cat output_results_0_1.json | jq '.[0].question' | grep "RA:"
# Should show: "RA: 16h 26m 23.36s Dec: -24°21'00.16""
```

## Astronomy Note

### Right Ascension (RA)
- Measured in hours, minutes, seconds
- 24h = 360° (full circle)
- 1h = 15°
- Ranges from 00h to 24h
- Equivalent to longitude on Earth's celestial sphere

### Declination (Dec)
- Measured in degrees, arcminutes, arcseconds
- Ranges from -90° (south) to +90° (north)
- 1° = 60 arcminutes (')
- 1' = 60 arcseconds (")
- Equivalent to latitude on Earth's celestial sphere

### Precision
- RA seconds: 0.01s precision ≈ 0.15 arcseconds on sky
- Dec arcseconds: 0.01" precision ≈ 0.3 meters at 1 parsec
- Adequate for Chandra X-ray source positions (~0.5-1" uncertainty)

