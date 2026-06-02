# Fine-tuned model server

FastAPI service that wraps the fine-tuned **DeepSeek-R1-Distill-Qwen-7B +
XrayProcessor (LoRA r=8)** model and the saved PCA(64)+UMAP(2) bundle.

Two endpoints power the rest of the stack:

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/inference` | Answer a user question conditioned on an X-ray event list. Used by the Event Analyst agent. |
| `POST` | `/project` | Run the event list through the XrayProcessor + PCA + UMAP to produce `pca_64d` and `umap_2d`. Used by the `/v1/embeddings` endpoint in the orchestrator and by `data/ingest/compute_embeddings.py`. |
| `GET`  | `/health` | Liveness probe. |

This server is **not** brought up by `docker-compose up` from the repo root.
It needs a GPU and a large model checkpoint, so we expect you to deploy it
separately (RunPod / vast.ai / a local GPU host).

## Files

```
main.py            FastAPI app, endpoints, model loading
base_functions.py  XrayProcessor, custom Qwen2_5_XrayForConditionalGeneration,
                   source_to_xray_tensors, generate_answer, get_embedding, prune
utils.py           helpers (event-list preprocessing utilities)
test_api.py        minimal local smoke test
requirements.txt   pip dependencies pinned to a known-good set
Dockerfile         CUDA 12.6 + Python 3.11 + the requirements above
start.sh           launcher (gunicorn if present, else uvicorn)
env.example        template for .env
```

## Checkpoint layout

```
/workspace/qwen-7b/final_model_7B-9-epochs/
├── adapter_config.json               # PEFT LoRA config
├── adapter_model.safetensors         # LoRA weights
├── tokenizer.json + tokenizer files  # tokenizer with the <xray> token added
├── special_tokens_map.json
└── pca_umap/
    └── xray_umap_pca_bundle.joblib   # sklearn Pipeline (Normalizer->PCA64) + fitted UMAP
```

The checkpoint is NOT in this repository. Once published it will be hosted on
the Hugging Face Hub; until then, see the training notes in
`../training/README.md`.

## Running

### Option A — Docker (recommended on a GPU host)

```bash
cd model/server
docker build -t axia-model-server .

# Mount your checkpoint + cache, expose port 8000
docker run --rm -p 8000:8000 --gpus all \
    -v /path/to/checkpoints:/workspace/qwen-7b/final_model_7B-9-epochs:ro \
    -v /path/to/hf-cache:/workspace/cache \
    -e BASE_MODEL_NAME=deepseek-ai/DeepSeek-R1-Distill-Qwen-7B \
    -e ADAPTER_DIR=/workspace/qwen-7b/final_model_7B-9-epochs \
    -e UMAP_PCA_BUNDLE=/workspace/qwen-7b/final_model_7B-9-epochs/pca_umap/xray_umap_pca_bundle.joblib \
    -e MODEL_CACHE_DIR=/workspace/cache \
    axia-model-server
```

### Option B — Bare metal

```bash
cd model/server
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp env.example .env && $EDITOR .env
./start.sh
```

### Option C — RunPod / vast.ai

Use a `pytorch/pytorch:2.5.x-cuda12.x-cudnn9-runtime` template (or build the
Dockerfile here). Map a persistent volume to `/workspace`, push your
checkpoint into it, then `./start.sh`. Expose port 8000.

## Wiring it back to the rest of the stack

Once the server is reachable on, say, `https://abc-8000.proxy.runpod.net`,
set:

```bash
# in your axia/.env
MODEL_SERVER_URL=https://abc-8000.proxy.runpod.net
```

then `make restart`. The orchestrator will enable the Event Analyst agent and
the `/v1/embeddings` endpoint automatically.

When `MODEL_SERVER_URL` is empty, the rest of the stack continues to work —
only the Event Analyst agent is greyed out in the playground.

## Quick smoke test

```bash
# Health
curl http://localhost:8000/health

# Inference (toy event list)
python test_api.py
```

## Publishing the checkpoint to Hugging Face Hub

The training script writes the LoRA adapter + tokenizer into `ADAPTER_DIR`.
To push it:

```bash
huggingface-cli login

python - <<'PY'
from transformers import AutoTokenizer
from peft import PeftModel
import torch

# 1) Load
tok = AutoTokenizer.from_pretrained("/workspace/qwen-7b/final_model_7B-9-epochs")
# adapter only; the base model is referenced by name in adapter_config.json
# so we don't push the merged model. Users will fetch base + adapter at runtime.

# 2) Push tokenizer + adapter
from huggingface_hub import HfApi
api = HfApi()
api.upload_folder(
    repo_id="<your-namespace>/axia-qwen-xray-7b",
    folder_path="/workspace/qwen-7b/final_model_7B-9-epochs",
    repo_type="model",
)
PY
```

Then point the server at the hub instead of a local path:

```bash
ADAPTER_DIR=<your-namespace>/axia-qwen-xray-7b
```

(`PeftModel.from_pretrained` accepts a Hub repo id transparently.)
