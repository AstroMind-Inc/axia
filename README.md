# Axia

A multi-agent AI system for decoding X-ray sources in the Chandra Source
Catalog (CSC). Axia combines a fine-tuned multi-modal transformer (Qwen-7B +
XrayProcessor) that ingests raw photon event lists with a panel of GPT-5
reasoning agents (metadata, neighbor, tool, critic, moderator) to classify
sources and explain its conclusions to the user through a chat interface.

This is the reference implementation accompanying the paper. It bundles the
orchestrator service, the Next.js playground, the data ingestion pipeline,
and the training/inference code for the fine-tuned model.

## Quickstart

```bash
# 1. Configure the stack (interactive)
make setup

# 2. Bring everything up (mongo + service + webapp, seeds sample data)
make up

# 3. Open the playground
open http://localhost:3000
```

Without a GPU you can still run everything except the Event Analyst agent.
The other four agents (Metadata, Neighbor, Critic, Tool, Moderator) run on
OpenAI's GPT-5 family and work on the sample dataset out of the box.

To enable the Event Analyst agent, deploy `model/server/` on a GPU box (see
`model/server/README.md`) and set `MODEL_SERVER_URL` in `.env`.

## Repository layout

```
data/             Sample dataset shipped with the repo + scripts to (re)build
                  the full 51k-source corpus from the Chandra Source Catalog.
model/            Fine-tuned model server (FastAPI) + training + eval code.
service/          FastAPI orchestrator running the multi-agent workflow.
webapp/           Next.js 15 playground (UMAP, light curves, chat).
side_studies/     Auxiliary analyses that produced figures/tables in the paper.
docs/             Architecture and methodology documentation.
docker-compose.yml  Local stack (mongo + service + webapp).
Makefile          Entry points: setup, up, down, load-sample, load-from-hf, rebuild-from-csc.
```

## Make targets

| Target | What it does |
|---|---|
| `make setup` | Interactive: writes `.env`, picks local vs external Mongo. |
| `make up` | Starts mongo (if local) + service + webapp; seeds the sample on first boot. |
| `make down` | Stops the stack. |
| `make logs` | Tails logs from all services. |
| `make load-sample` | Reloads the bundled 22-source sample into Mongo. |
| `make load-from-hf` | Downloads the full 51,450-source corpus from [`astromindinc/axia-csc-corpus`](https://huggingface.co/datasets/astromindinc/axia-csc-corpus) on Hugging Face and loads it into Mongo. Cached after first run. **Recommended.** |
| `make rebuild-from-csc` | Rebuild the corpus from raw CSC data + the fine-tuned model server (~6 hours, needs a GPU). For reproducibility audits and re-training; most users want `load-from-hf`. |
| `make service-dev` | Runs the service on the host with hot-reload. |
| `make webapp-dev` | Runs the webapp on the host with hot-reload. |
| `make model-server` | Prints instructions for deploying `model/server/`. |
| `make clean` | Removes containers and volumes (DESTRUCTIVE). |

## License

MIT. See `LICENSE`.
