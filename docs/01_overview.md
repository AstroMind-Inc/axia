# 01 — Overview

Axia is a chat-based system for **decoding X-ray sources in the Chandra Source
Catalog (CSC)**. Given the raw photon event list of a source, Axia produces
classifications, spectral interpretations, and multi-wavelength reasoning
through the cooperation of six specialised AI agents.

## What it does

Given any CSC source, ask any astrophysics question about it (source type,
spectral model, variability, environment, ...). Axia answers by combining:

- A **fine-tuned multi-modal transformer** that reads the raw event list
  directly and contributes a pattern-based interpretation.
- Five **GPT-5 reasoning agents** that analyse spectral metadata, compare
  against the nearest neighbours in a learned embedding space, fetch
  multi-wavelength images of the source, critique each other's reasoning, and
  synthesise a final answer.

## Stack

```
+-------+      HTTP     +---------+      HTTP     +--------+
| webapp| <----------> | service | <----------> | model  |
| Next  |              | FastAPI |              | server |
+---|---+              +----|----+              +--------+
    | mongo driver         | mongo driver
    v                      v
       +-------------------+
       |     MongoDB       |
       |  (sources, raw_   |
       |   events,         |
       |   metadata_       |
       |   records)        |
       +-------------------+
```

- `model/server/` — GPU service. Loads a LoRA-fine-tuned
  `DeepSeek-R1-Distill-Qwen-7B + XrayProcessor`. Exposes `/inference` (text
  generation conditioned on an event list) and `/project` (event list → 64-d
  embedding via PCA + 2-d via UMAP). **Optional**: the rest of the stack runs
  without it, just with the Event Analyst agent disabled.
- `service/` — Python/FastAPI orchestrator. Runs the streaming multi-agent
  workflow over Server-Sent Events. Reads source data from MongoDB; speaks to
  the model server and to OpenAI on behalf of the GPT-5 agents.
- `webapp/` — Next.js 15 playground. Browses the corpus on a UMAP scatter,
  shows light curves and energy-time density maps, and hosts the streaming
  chat UI with per-agent progress indicators.
- `MongoDB` — single configured database (`axia` by default) with three
  collections (`sources`, `raw_events`, `metadata_records`). Either a local
  Mongo 7 container (default) or any external Mongo / Atlas URI.

## The six agents

| # | Agent | Backed by | What it contributes |
|---|---|---|---|
| 1 | **Event Analyst** | Fine-tuned Qwen-7B + XrayProcessor (LoRA r=8). Runs on the model server. | Pattern-based answer derived directly from photon arrival times and energies. |
| 2 | **Metadata Analyst** | GPT-5 + a 40+-metric "spectrum snapshot" computed in `service/src/spectrum/`. Always runs. | Physics-grounded interpretation of hardness ratios, line detections, variability indices, periodicity, and spectral evolution. |
| 3 | **Neighbour Analyst** | GPT-5 + MongoDB Atlas Vector Search (or brute-force cosine in local mode). | Empirical comparison with the 10 most similar sources in the learned embedding space. |
| 4 | **Tool Agent** | GPT-5 + HiPS2FITS multi-wavelength image service. | Iteratively fetches optical / IR / UV / radio cutouts to cross-validate the X-ray classification. |
| 5 | **Critic** | GPT-5. | Reviews the four prior analyses, flags inconsistencies, calls out gaps. |
| 6 | **Conversation Moderator** | GPT-5. Always runs. | Synthesises the final user-facing answer. |

Agents 1, 3, 4 are *optional* — they are skipped gracefully when their inputs
are unavailable (no event list, no embedding, no coordinates, no model
server). Agents 2 and 6 always run.

The full workflow is documented in [`02_multi_agent_workflow.md`](./02_multi_agent_workflow.md).
The fine-tuned model is documented in [`03_event_analyst_model.md`](./03_event_analyst_model.md).
The 40+ spectral metrics are documented in [`04_spectral_metrics.md`](./04_spectral_metrics.md).
Vector-search-based neighbour analysis is documented in [`05_neighbor_analysis.md`](./05_neighbor_analysis.md).
The webapp is documented in [`06_frontend.md`](./06_frontend.md).
Dataset schema + ingestion is documented in [`07_dataset.md`](./07_dataset.md).
Deployment is documented in [`08_deployment.md`](./08_deployment.md).

## Quickstart

```bash
make setup        # interactive — picks Mongo (local container vs external URI), OpenAI key, optional model URL
make up           # docker compose up; seeds 22 sample sources on first boot
open http://localhost:3000
```

Without OpenAI credit you can still browse the data (UMAP, light curves,
dE-dt maps). With OpenAI you get the full multi-agent chat. Add a model
server URL on top of that to enable the Event Analyst.

## Repository map

| Path | Purpose |
|---|---|
| `data/` | Sample dataset + ingestion scripts (extract, download from CSC, embed, load) |
| `model/server/` | Fine-tuned model FastAPI service (deployed externally on a GPU box) |
| `model/training/` | Training code for the LoRA fine-tune + XrayProcessor module |
| `model/eval/` | Evaluation harness (XrayQATestSuite) |
| `service/` | Multi-agent orchestrator (FastAPI) |
| `webapp/` | Next.js 15 playground |
| `side_studies/` | Bulk evaluation, flaring-source side study, anomaly scoring |
| `docs/` | This documentation |
| `scripts/` | Setup, mongo init, verify helpers |
