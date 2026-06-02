# Fine-tuned model server image.
#
# This image is NOT part of `docker-compose up`. It is intended to be run on a
# GPU machine (RunPod, vast.ai, a local workstation, etc). The orchestrator
# service in this repo reaches it over HTTP via $MODEL_SERVER_URL.
#
# Build:
#   docker build -t axia-model-server .
#
# Run (assumes checkpoints mounted at /workspace/qwen-7b/final_model_7B-9-epochs):
#   docker run --gpus all -p 8000:8000 \
#       -v /path/to/checkpoints:/workspace/qwen-7b/final_model_7B-9-epochs \
#       -e ADAPTER_DIR=/workspace/qwen-7b/final_model_7B-9-epochs \
#       -e UMAP_PCA_BUNDLE=/workspace/qwen-7b/final_model_7B-9-epochs/pca_umap/xray_umap_pca_bundle.joblib \
#       axia-model-server

FROM nvidia/cuda:12.6.2-cudnn-runtime-ubuntu22.04

ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

RUN apt-get update && apt-get install -y --no-install-recommends \
        python3.11 python3.11-venv python3-pip git curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*
RUN ln -sf /usr/bin/python3.11 /usr/local/bin/python && \
    ln -sf /usr/bin/python3.11 /usr/local/bin/python3

WORKDIR /app
COPY requirements.txt /app/requirements.txt
RUN pip install --upgrade pip && pip install -r requirements.txt

COPY . /app/

EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=10s --retries=5 \
    CMD curl -fsS http://localhost:8000/health || exit 1

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
