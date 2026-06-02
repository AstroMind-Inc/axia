# Correct Payload Structure for MetadataAnalyst

## Complete Request Payload

```json
{
  "message": "Your analysis prompt...",
  "history": [],
  "model": "astromind-multi-agent",
  "response_format": "Normal",
  "model_api_url": "https://placeholder-not-used.com/",
  "openai_model": "gpt-5-mini",
  "thread_id": "metadata_only_{source_id}_{timestamp}",
  
  "data_obj": {
    "_id": "sss_1",
    "obsid": 9769,
    "source_name": "2CXO J064059.9+092850",
    "source_type": "X",
    "source_type_category": "Other",
    
    "flux_significance_b": 6.5,
    
    "powlaw_stat": null,
    "powlaw_gamma": null,
    "powlaw_nh": null,
    "powlaw_ampl": null,
    
    "bb_stat": null,
    "bb_kt": null,
    "bb_nh": null,
    "bb_ampl": null,
    
    "brems_stat": null,
    "brems_kt": null,
    
    "apec_stat": null,
    "apec_kt": null,
    "apec_nh": null,
    "apec_norm": null,
    "apec_abund": null,
    "apec_z": null,
    
    "hard_hs": -0.75,
    "hard_hm": -0.32,
    "hard_ms": -0.51,
    
    "var_index_b": 0,
    
    "event_list": [[time, energy], ...],
    "original_event_list": [[time, energy], ...],
    "pca_64d": [64 floats],
    "umap_2d": [x, y],
    "name": "9769 - 2CXO J064059.9+092850"
  },
  
  "event_list": [[time, energy], ...],
  
  "neighbors": [],
  
  "agent_config": {
    "eventAnalyst": false,
    "metadataAnalyst": true,
    "neighborAnalyst": false,
    "critic": true,
    "toolAgent": false
  },
  
  "context_settings": {
    "enabled": false,
    "selectedFields": [],
    "dataset": "51k_v2_shuffled_without_test_data"
  }
}
```

## Key Fields Explanation

### Top-Level Fields

- **`data_obj`**: Complete source object with ALL metadata and event data
  - Includes: metadata fields, event_list, original_event_list, embeddings
  
- **`event_list`**: Top-level pruned event list (8h window, time-normalized)
  - Used by EventAnalyst (when enabled)
  - Format: `[[time, energy], ...]`
  
- **`neighbors`**: Array of similar sources (empty for metadata-only analysis)
  - Used by NeighborAnalyst (when enabled)
  - Format: `[]` or `[{source_obj1}, {source_obj2}, ...]`

### Metadata Fields (in data_obj)

#### Source Identification
- `_id`, `obsid`, `source_name`, `name`
- `source_type`, `source_type_category`

#### Flux & Significance
- `flux_significance_b`: Statistical significance of flux detection

#### Spectral Fitting Statistics
- `powlaw_stat`: Power law fit statistic (chi-square/dof)
- `bb_stat`: Blackbody fit statistic
- `brems_stat`: Bremsstrahlung fit statistic
- `apec_stat`: APEC plasma model fit statistic

#### Power Law Parameters
- `powlaw_gamma`: Photon index
- `powlaw_nh`: Hydrogen column density (10²² cm⁻²)
- `powlaw_ampl`: Normalization amplitude

#### Blackbody Parameters
- `bb_kt`: Temperature (keV)
- `bb_nh`: Hydrogen column density
- `bb_ampl`: Normalization amplitude

#### Bremsstrahlung Parameters
- `brems_kt`: Plasma temperature (keV)

#### APEC Plasma Parameters
- `apec_kt`: Plasma temperature (keV)
- `apec_nh`: Hydrogen column density
- `apec_norm`: Normalization
- `apec_abund`: Abundance (solar units)
- `apec_z`: Redshift

#### Hardness Ratios
- `hard_hs`: Hard-soft ratio
- `hard_hm`: Hard-medium ratio
- `hard_ms`: Medium-soft ratio
- Values range from -1 (soft) to +1 (hard)

#### Variability
- `var_index_b`: Variability index (0 = constant, higher = more variable)

#### Event Data
- `event_list`: Pruned event list (8h window, 0.5-8 keV)
- `original_event_list`: Full unpruned event list

#### Embeddings
- `pca_64d`: 64-dimensional PCA embedding
- `umap_2d`: 2D UMAP projection for visualization

## What Each Agent Uses

### MetadataAnalyst

The MetadataAnalyst primarily uses:
1. **Spectral fit statistics** to recommend spectral models
2. **Hardness ratios** to infer spectral shape and temperature
3. **Variability index** to assess flux variations
4. **Source type** for classification context
5. **Original event list** to generate light curves and spectral snapshots

### Critic

The Critic agent reviews the MetadataAnalyst's output and:
1. **Validates** the spectral model recommendations against the metadata
2. **Checks consistency** between hardness ratios and suggested models
3. **Assesses confidence** in the conclusions
4. **Identifies contradictions** or weak reasoning
5. **Provides astrophysical critique** using domain knowledge

## Workflow

Current configuration runs:
1. **MetadataAnalyst** → Analyzes metadata and generates initial assessment
2. **Critic** → Reviews the MetadataAnalyst's output and provides critique
3. **ConversationModerator** → Synthesizes the final answer (always runs)

## Differences from EventAnalyst

- **EventAnalyst** uses the top-level `event_list` (pruned, 8h window)
- **MetadataAnalyst** uses `data_obj.original_event_list` (full data) for spectra
- MetadataAnalyst focuses on metadata (hardness, fit stats, variability)
- EventAnalyst focuses on raw photon arrival patterns
- **Critic** reviews any/all analyst outputs for consistency and quality

