# Fine-tuned model — training

This directory contains the training pipeline for the Event Analyst model:
**DeepSeek-R1-Distill-Qwen-7B** + a learned **XrayProcessor** module fused
into the language model via a special `<xray>` token, fine-tuned with LoRA
adapters (r=8) for X-ray-specific reasoning.

## Files

```
train.py                Distributed training driver (run with `accelerate launch`)
base_functions.py       XrayProcessor module, custom Qwen2_5_XrayForConditionalGeneration,
                        XRayQnADataset, collate_fn, source_to_xray_tensors
ds_config.json          DeepSpeed config (Zero-2)
accelerate_config.txt   Hugging Face Accelerate config (multi-GPU)
pip_freeze.txt          Exact training environment that produced the paper checkpoint
README.md               this file
```

## Data format expected

`train.py` reads a single JSON file whose path is set by the `DATA_FILE`
constant near the top. The file should be a list of source objects, each:

```jsonc
{
  "obsid": 12345,
  "source_name": "2CXO J123456.7-001122",
  "source_type": "AGN",
  "source_type_category": "Large accretors",
  "event_list": [[t1, e1], [t2, e2], ...],   // raw (time, energy_eV)
  "pca_64d": [...],                          // optional, only if pre-computed
  "umap_2d": [...],                          // optional
  "qna": [
    {"question": "What spectral models fit this source?",
     "answer":   "The spectrum is best fit by an absorbed power-law..."},
    ...
  ]
}
```

To regenerate this from the catalog metadata, use
`../../data/ingest/build_qna_dataset.py`.

## Hardware

Paper checkpoint trained on 4× NVIDIA A100 (40 GB) with BFloat16. The
configuration is:

| Setting | Value |
|---|---|
| Base model | `deepseek-ai/DeepSeek-R1-Distill-Qwen-7B` |
| Trainable | XrayProcessor (~2.5 M params, randomly initialized) + LoRA adapters (r=8) |
| LoRA targets | `W_pack`, `o_proj`, MLP layers |
| Optimizer | AdamW, lr 1e-4, weight decay 0.01 |
| Precision | bf16 (training), fp16 (inference) |
| Batch size | 4 / GPU, 16 effective |
| Epochs | 25 |
| Max events / source | 512 (truncated/padded) |
| Sequence length | 1024 tokens |
| Training corpus | ~50 000 Chandra sources, ~2–4 Q&A chains per source |

## Run

```bash
# From the repository root
cd model/training

# 1) Inspect / edit train.py — the DATA_FILE, OUT_DIR, BASE_MODEL constants
#    near the top are intended to be set per run.

# 2) Configure accelerate (one-off)
accelerate config --config_file accelerate_config.txt

# 3) Launch
export PYTHONPATH="$(pwd)/../..:$PYTHONPATH"   # so model/eval/ is importable
accelerate launch --config_file accelerate_config.txt train.py
```

DeepSpeed Zero-2 sharding is enabled via `ds_config.json`.

Checkpoints are written to `OUT_DIR` (set at the top of `train.py`).
The final checkpoint contains:

```
OUT_DIR/final_model_7B-{N}-epochs/
├── adapter_config.json
├── adapter_model.safetensors
├── tokenizer files
└── (you separately fit + save the PCA/UMAP bundle, see "Fitting PCA/UMAP" below)
```

## Fitting the PCA/UMAP bundle

After training, embeddings for every source need to be computed via the
trained XrayProcessor, then a `Normalizer -> PCA(64)` pipeline and a
UMAP(n_components=2) are fitted on top:

```python
import joblib
import numpy as np
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import Normalizer
from sklearn.decomposition import PCA
import umap

# X = [N x hidden_size] embeddings from XrayProcessor for the full corpus
preproc = Pipeline([("norm", Normalizer(norm="l2")), ("pca", PCA(n_components=64))])
preproc.fit(X)
X_64 = preproc.transform(X)

reducer = umap.UMAP(n_components=2, n_neighbors=30, min_dist=0.1, metric="cosine")
reducer.fit(X_64)

joblib.dump({"preproc": preproc, "umap": reducer},
            "xray_umap_pca_bundle.joblib")
```

Place this file next to the adapter checkpoint at the path
`UMAP_PCA_BUNDLE` referenced by the model server.

## Evaluation

See `../eval/xray_testsuite.py`. After training, run:

```bash
python -m model.eval.xray_testsuite \
    --checkpoint /workspace/qwen-7b/final_model_7B-9-epochs \
    --test-set ./testsuite/gt_suite_test.json
```

(`gt_suite_test.json` is built separately from CSC catalog truth labels;
see `side_studies/bulk_eval/` for the construction recipe used in the paper.)
