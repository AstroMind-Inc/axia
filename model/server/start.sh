#!/usr/bin/env bash
# Convenience launcher for the fine-tuned model server.
# Reads model/server/env.example as a template; copy to .env and edit before use.
set -euo pipefail

cd "$(dirname "$0")"

# Load .env if present
if [[ -f .env ]]; then
    set -a; source .env; set +a
fi

: "${BASE_MODEL_NAME:=deepseek-ai/DeepSeek-R1-Distill-Qwen-7B}"
: "${ADAPTER_DIR:?Set ADAPTER_DIR to the LoRA checkpoint directory}"
: "${UMAP_PCA_BUNDLE:?Set UMAP_PCA_BUNDLE to the path of xray_umap_pca_bundle.joblib}"
: "${MODEL_CACHE_DIR:=/workspace/cache}"
: "${PORT:=8000}"
: "${HOST:=0.0.0.0}"
: "${WORKERS:=1}"

export BASE_MODEL_NAME ADAPTER_DIR UMAP_PCA_BUNDLE MODEL_CACHE_DIR

# Pick a sensible launcher
if command -v gunicorn >/dev/null 2>&1; then
    exec gunicorn main:app \
        --workers "$WORKERS" \
        --worker-class uvicorn.workers.UvicornWorker \
        --bind "$HOST:$PORT" \
        --timeout 300
else
    exec uvicorn main:app --host "$HOST" --port "$PORT"
fi
