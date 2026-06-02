# 03 — Event Analyst (fine-tuned model)

The Event Analyst is the only agent that ingests photon arrival times and
energies directly. It is a multi-modal transformer based on
**DeepSeek-R1-Distill-Qwen-7B**, with a custom **XrayProcessor** module fused
into the language model via a special `<xray>` token, fine-tuned with LoRA
adapters (r=8) on ~50 000 annotated CSC sources.

The trained weights live on a GPU (or RunPod/vast.ai instance) and are
reached over HTTP by the orchestrator. The rest of the stack runs without
this agent — it just contributes one extra perspective when present.

## Inputs and outputs

```
event_list  : List[[time_s, energy_eV]]
prompt      : "What is the source type? <xray>"
              ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
              tokeniser converts to ids; <xray> is one token whose embedding
              gets replaced at forward-time by XrayProcessor(event_list)
```

```
answer      : "Given the hard spectrum and low variability, this is likely
               an obscured AGN."
```

The HTTP API exposes:

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/inference` | Generate text conditioned on `(event_list, prompt)` |
| `POST` | `/project` | Run `event_list` through XrayProcessor + PCA(64) + UMAP(2) |
| `GET`  | `/health` | Liveness probe |

The orchestrator calls `/inference` from the Event Analyst agent step and
`/project` from the `/v1/embeddings` endpoint (used by the webapp when the
user uploads a custom source).

## XrayProcessor — the multi-modal encoder

XrayProcessor turns a variable-length event list into a single 4096-d vector
that matches Qwen-7B's hidden size, so it can drop in as a token embedding.

```
                 raw event_list (variable length)
                          v
                 source_to_xray_tensors()
                          v
            +-----------------------------+
            | per_event       (512 × 5)   |
            | spectrum_hist   (64)        |
            | psd             (50)        |
            | meta            (3)         |
            | mask            (512 bool)  |
            +-----------------------------+
                          v
            +-----------------------------+
            | Linear(5->256) + posemb     |
            | 6-layer Transformer (d=256) |
            | masked mean-pool            |    <- per-event branch
            +-----------------------------+
                          v
            concat with 3 side branches (spec, psd, meta MLPs, each 128-d)
                          v
            +-----------------------------+
            | Linear(640->4096) + LN +    |
            | dropout                     |
            +-----------------------------+
                          v
            4096-d vector  -->  injected as the <xray> token embedding
```

Per-event features (5 dims per photon):

1. `tau_rel`   — relative time, `(t-t0) / (t_max-t0)`
2. `tau_abs`   — absolute time, `(t-t0) * 1e-4`
3. `dlogtau`   — log inter-arrival time, `log(1 + dt)`
4. `eps`       — normalised log energy, `(log E - mu_logE) / sigma_logE`
5. `q_E`       — energy quantile rank, `rank(E) / N`

Global features:

- **Spectrum**: 64-bin energy histogram over 0.5–7 keV (log-binned)
- **PSD**: 50-bin Lomb-Scargle periodogram over 1e-4 – 0.25 Hz
- **Metadata**: `[log_duration, count_rate, hardness_ratio]`

XrayProcessor weights live alongside the LoRA adapter in the checkpoint
folder.

## Training

```
Base model       : deepseek-ai/DeepSeek-R1-Distill-Qwen-7B (frozen)
Trainable        : XrayProcessor (~2.5M params) + LoRA adapters (r=8)
LoRA targets     : W_pack, o_proj, MLP layers
Optimizer        : AdamW, lr 1e-4, wd 0.01
Precision        : bf16
Batch size       : 4/GPU, 4 GPUs, effective 16
Epochs           : 25
Corpus           : ~50,000 CSC sources, ~2-4 Q&A pairs per source
```

Training command:

```bash
cd model/training
export PYTHONPATH="$(pwd)/../..:$PYTHONPATH"
accelerate config --config_file accelerate_config.txt   # one-off
accelerate launch --config_file accelerate_config.txt train.py
```

Training data is generated from CSC catalog metadata by
`data/ingest/build_qna_dataset.py`. Each source produces several Q&A pairs
covering spectral models, source type, variability, and hardness, all
phrased with the `<xray>` token where the event-list embedding should go.

The XrayProcessor is randomly initialised and trained end-to-end with the
LoRA adapter so the language model learns to interpret its outputs as
domain-grounded "evidence" alongside the question text.

## Fitting the PCA(64) + UMAP(2) bundle

After training, embeddings for the full corpus are extracted via
XrayProcessor and reduced to 64 dimensions with PCA, then to 2 dimensions
with UMAP. Both transformers are pickled into a single joblib bundle
that is loaded by the model server at startup:

```python
import joblib
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import Normalizer
from sklearn.decomposition import PCA
import umap

# X : (N, hidden_size) embeddings extracted from XrayProcessor
preproc = Pipeline([("norm", Normalizer(norm="l2")), ("pca", PCA(n_components=64))])
preproc.fit(X)

reducer = umap.UMAP(n_components=2, n_neighbors=30, min_dist=0.1, metric="cosine")
reducer.fit(preproc.transform(X))

joblib.dump({"preproc": preproc, "umap": reducer},
            "xray_umap_pca_bundle.joblib")
```

The 64-d output goes into MongoDB as `pca_64d` and is the vector indexed by
MongoDB Atlas Vector Search. The 2-d output is stored as `umap_2d` for the
UMAP scatter plot in the webapp.

## Deployment

The model server is **not** part of `docker-compose up`. Build the image on
the GPU host:

```bash
cd model/server
docker build -t axia-model-server .

docker run --rm -p 8000:8000 --gpus all \
    -v /path/to/checkpoints:/workspace/qwen-7b/final_model_7B-9-epochs:ro \
    -v /path/to/hf-cache:/workspace/cache \
    -e BASE_MODEL_NAME=deepseek-ai/DeepSeek-R1-Distill-Qwen-7B \
    -e ADAPTER_DIR=/workspace/qwen-7b/final_model_7B-9-epochs \
    -e UMAP_PCA_BUNDLE=/workspace/qwen-7b/final_model_7B-9-epochs/pca_umap/xray_umap_pca_bundle.joblib \
    axia-model-server
```

Then point the orchestrator at it by setting `MODEL_SERVER_URL=https://...`
in the top-level `.env`.

See `model/server/README.md` for the full deployment recipe (incl.
RunPod / vast.ai notes and the Hugging Face Hub publishing flow).

## Inference latency

| Hardware | per `/inference` request |
|---|---|
| A100 40 GB | ~1.2 s |
| V100 32 GB | ~2.0 s |
| H100 80 GB | ~0.8 s |

Memory: ~16 GB in bf16, ~10 GB in int8.

## Files

```
model/
├── server/
│   ├── main.py                # FastAPI app + endpoints
│   ├── base_functions.py      # XrayProcessor, custom Qwen2_5_XrayForConditionalGeneration,
│   │                          # source_to_xray_tensors, generate_answer, get_embedding, prune
│   ├── utils.py
│   ├── test_api.py            # local smoke test
│   ├── requirements.txt
│   ├── Dockerfile
│   ├── start.sh               # gunicorn launcher
│   └── env.example
├── training/
│   ├── train.py               # accelerate launch entry point
│   ├── base_functions.py      # same module as the server (kept in sync)
│   ├── ds_config.json         # DeepSpeed Zero-2
│   ├── accelerate_config.txt
│   ├── pip_freeze.txt
│   └── README.md
└── eval/
    ├── xray_testsuite.py      # XrayQATestSuite
    └── README.md
```
