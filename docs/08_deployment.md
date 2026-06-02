# 08 — Deployment

Axia targets two deployment shapes:

1. **Local docker-compose** (default) — everything you need to run the
   webapp + service + Mongo on a laptop or VM. The model server is
   optional and runs separately.
2. **External services** — pointing at Atlas for the database and at a
   remote model server for the GPU. Same docker-compose, different `.env`.

## 1. Local docker-compose

```bash
make setup   # interactive .env writer
make up      # mongo + service + webapp; seeds sample data on first boot
make logs    # tail logs
make verify  # smoke test
```

Endpoints:

| URL | What |
|---|---|
| http://localhost:3000 | Webapp (playground) |
| http://localhost:8000/docs | Service OpenAPI |
| http://localhost:8000/health | Service health (includes config summary) |
| mongodb://localhost:27017 | Local Mongo (db `axia`) |

The first `make up` will:

1. Build the `service` and `webapp` images (~1–2 min each).
2. Bring up the `mongo` container.
3. Run `mongo-init` once, which `mongoimport`s
   `data/samples/sample_sources.json`,
   `data/samples/sample_raw_events.json`,
   `data/samples/sample_metadata_records.json` and creates the
   sources/raw-events indexes.
4. Start `service` (waits for the seed to complete).
5. Start `webapp` (waits for `service` to be healthy).

Subsequent `make up`s skip step 3 unless you run `RELOAD=1 make load-sample`.

`make clean-data` removes the Mongo volume (everything).

### Stack diagram (local mode)

```
                              .env
                                |
                                v
  +-------+   3000   +-------+   8000   +---------+
  | host  |--------> |webapp |--------> | service |
  +-------+          +-------+          +----|----+
                                              | 27017
                                              v
                                         +---------+
                                         |  mongo  |
                                         +---------+
                                              ^
                                              | (seed once)
                                         +-----------+
                                         | mongo-init|
                                         +-----------+

  optional: GPU box running model/server, reached via MODEL_SERVER_URL
```

The webapp is served by `next start` on port 3000. The service is `uvicorn`
on port 8000. Mongo is community-edition Mongo 7.

## 2. External Mongo (e.g. Atlas)

During `make setup`, pick `(2) External` and provide your Atlas URI:

```
MONGODB_URI=mongodb+srv://user:pass@host/?retryWrites=true&w=majority
MONGODB_DB=axia
```

`docker-compose` then **does not** start the `mongo` or `mongo-init`
containers (they're behind a profile flag that only activates when
`MONGODB_MODE=local`). `service` and `webapp` connect directly to Atlas.

You will need to:

1. Load the sample (or full corpus) into Atlas yourself. The same
   `data/ingest/load_into_mongo.py` script works:
   ```bash
   MONGODB_URI=mongodb+srv://... MONGODB_DB=axia \
       python data/ingest/load_into_mongo.py \
           --sources data/samples/sample_sources.json \
           --raw-events data/samples/sample_raw_events.json \
           --metadata data/samples/sample_metadata_records.json \
           --drop \
           --atlas        # also creates the vector-search index
   ```
2. Optionally wait a few minutes for the Atlas Vector Search index to
   become `READY` before using the chat (the webapp will gracefully fall
   back to brute-force similarity in the meantime).

## 3. Adding the fine-tuned model server

The Event Analyst agent runs on a GPU. It's deployed separately because:

- It needs a GPU (typically A100 40 GB).
- It needs the LoRA checkpoint (~14 GB total with base model cache) which
  is much bigger than the rest of the repo.
- People reproducing the paper without a GPU should still be able to run
  everything else.

Three ways to run it:

### A. RunPod / vast.ai / Lambda

1. Provision a single-GPU instance with a Docker-capable image
   (e.g. `nvidia/cuda:12.6.2-cudnn-runtime-ubuntu22.04`).
2. `git clone` this repo on the instance.
3. `cd model/server && docker build -t axia-model-server .`
4. Mount a volume containing the LoRA + PCA/UMAP bundle into
   `/workspace/qwen-7b/final_model_7B-9-epochs/`.
5. `docker run --gpus all -p 8000:8000 -v $CKPT:/workspace/qwen-7b/... axia-model-server`
6. Expose port 8000 via the instance's public URL.
7. Set `MODEL_SERVER_URL=<that URL>` in your `.env` and `make restart`.

See `model/server/README.md` for the exact Docker run command and the
checkpoint layout.

### B. Local GPU host

Same as above, but with the URL set to `http://<host>:8000`.

### C. From the Hugging Face Hub

(Once we push the checkpoint:)

```
ADAPTER_DIR=axia/qwen-xray-7b
```

Set this in the model server's `.env`; the server passes it through to
`PeftModel.from_pretrained`, which accepts Hub repo ids transparently.

### Behaviour when the model server is offline

- `service /health` reports `model_server_configured: false`.
- The Event Analyst agent is force-disabled in every chat request.
- The custom-source-upload flow saves without `pca_64d` / `umap_2d` (the
  source still lands in Mongo, just without an embedding).
- All other functionality (Metadata Analyst, Critic, Moderator, Tool Agent
  with HiPS2FITS) continues to work.

## Environment variables (reference)

Everything lives in the top-level `.env`. The same file is read by
`docker compose`, `make service-dev`, and `make webapp-dev`.

| Variable | Default | Purpose |
|---|---|---|
| `MONGODB_MODE` | `local` | `local` or `external`. Controls whether the `mongo` container is started. |
| `MONGODB_URI` | `mongodb://mongo:27017` | Mongo connection string. |
| `MONGODB_DB` | `axia` | Database name. |
| `MONGODB_CORPUS_COLLECTION` | `sources` | The merged per-source corpus (one doc per source, both event_lists, ra/dec, pca_64d, all catalog fields). |
| `MONGODB_METADATA_COLLECTION` | `metadata_records` | |
| `MODEL_SERVER_URL` | empty | URL of the fine-tuned model server. Empty = Event Analyst disabled. |
| `OPENAI_API_KEY` | empty | Required for the GPT-5 agents. |
| `OPENAI_DEFAULT_MODEL` | `gpt-5-mini` | Model id used when the request doesn't specify one. |
| `SERVICE_HOST` / `SERVICE_PORT` | `0.0.0.0 / 8000` | Service bind address. |
| `SERVICE_DEBUG` | `false` | Enables hot reload + debug logs. |
| `NEXT_PUBLIC_API_URL` | `http://localhost:8000` | Where the webapp finds the service. |
| `NEXT_PUBLIC_MONGODB_URI` | `mongodb://localhost:27017` | The webapp also talks Mongo directly (vector search, dataset list). |
| `NEXT_PUBLIC_MONGODB_DB` | `axia` | |
| `NEXT_PUBLIC_MONGODB_MODE` | `local` | Webapp's mirror of the server-side flag. Selects vector-search vs brute-force path. |

## Production notes

This is a research reference implementation, not production-grade software.
A few things to be aware of:

- **CORS** is wide open (`allow_origins=["*"]`). Lock it down before
  exposing the service publicly.
- The service holds chat workflows **in memory**; restarting it loses
  in-flight requests. Per-design.
- The webapp uses MongoDB cleartext URIs in the browser env
  (`NEXT_PUBLIC_*`). Only use this with a Mongo instance behind a private
  network or with read-only credentials.
- `OPENAI_API_KEY` is server-side only and never sent to the browser.

## Verifying the stack

`make verify` runs a smoke test:

```
service:
  ✓ GET /health
webapp:
  ✓ GET / on port 3000
mongo:
  ✓ axia.sources has 22 docs
All checks passed.
```

If any of these fail, `make logs` shows what went wrong.
