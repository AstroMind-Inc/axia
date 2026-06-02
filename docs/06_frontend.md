# 06 — Frontend (Next.js playground)

`webapp/` is a Next.js 15 App Router app. Single page, three resizable
panels:

```
+-----------------+------------------------+---------------------------+
| ChatConfig      | ChatWindow             | DataObjectInfo            |
| (left, narrow)  | (centre, resizable)    | (right, resizable)        |
|                 |                        |                           |
| dataset picker  | streaming chat with    | selected source details:  |
| model picker    | per-agent progress     | - UMAP scatter (clickable)|
| openai model    | indicators, artifacts  | - light curve(s)          |
| agent toggles   | (light-curve PNG,      | - dE-dt density map       |
| file upload     | dE-dt PNG, HiPS2FITS), | - 10 nearest neighbours   |
|                 | thread selector,       | - catalog metadata        |
|                 | feedback button        |                           |
+-----------------+------------------------+---------------------------+
```

## Pages

- `/` → redirects to `/playground`.
- `/playground` → the only real page.

## State

Three React contexts:

| Context | What it holds |
|---|---|
| `PlaygroundContext` | Selected dataset / source, chat messages, transient errors. |
| `SettingsContext` | Theme, OpenAI model choice, "custom event mode" toggle. |
| `LayoutContext` | Mobile/tablet flags, panel widths, expand/collapse state. |
| `ChatHistoryContext` | List of chat threads, current thread, messages within. Persisted to Mongo (`chat_threads`, `chat_messages`). |

## API routes (`webapp/src/app/api/`)

The webapp does two things over HTTP: talks to the orchestrator service,
and talks to Mongo directly. Routes are grouped accordingly.

### Service-bound routes (proxies)

| Route | Forwards to | Used by |
|---|---|---|
| `POST /api/chat` | `POST <service>/v1/chat` (non-streaming wrapper; legacy) | Non-streaming clients |
| `POST /api/chat/stream` | `POST <service>/v1/chat/stream` (SSE) | The main chat UI |
| `POST /api/embeddings` | `POST <service>/v1/embeddings` | File upload flow |
| `POST /api/object-details-enhanced` | `POST <service>/v1/object-details-enhanced` | Selecting a source in the right panel |
| `GET /api/model/validate/health` | `GET <service>/health` | "Service reachable?" indicator |

### Mongo-bound routes (talk to the DB directly)

| Route | Reads/writes | Notes |
|---|---|---|
| `GET /api/datasets` | `metadata_records` + `sources` | Lists available datasets. Always includes the configured `sources` collection. |
| `GET /api/datasets/[name]` | `<name>` | Paginates and searches sources by obsid/source_name/source_type. |
| `GET /api/datasets/[name]/objects` | `<name>` | Used by the dataset browser. |
| `GET /api/datasets/[name]/umap-data` | `<name>` | Returns up to 5000 points with `umap_2d` for the scatter plot. |
| `GET /api/datasets/[name]/nearest-neighbors` | `<name>` | 10 nearest neighbours of a given object id. Atlas `$vectorSearch` or brute-force cosine. |
| `POST /api/nearest-neighbors` | `sources` | Same, but the caller passes the query vector directly. Used by the chat flow. |
| `GET /api/fields` | `source_data` | Looks up legacy field metadata; returns 404 on fresh stacks (harmless). |
| `GET/POST/DELETE /api/uploaded-sources` | `user_uploaded_sources` | Custom user uploads. |
| `POST /api/upload` | `sources` + `metadata_records` | Insert a new dataset. |
| `POST /api/parse-pkl` | _stdin to python_ | Server-side pickle parser. |
| `GET/POST /api/chat-threads` | `chat_threads` | Chat history. |
| `GET/PUT/DELETE /api/chat-threads/[threadId]` | `chat_threads` | Per-thread operations. |
| `GET/POST /api/chat-threads/[threadId]/messages` | `chat_messages` | Messages in a thread. |
| `POST /api/feedback` | `chat_message_feedbacks` | Submit thumbs-up/down feedback. |

All Mongo routes go through `webapp/src/app/lib/mongodb.ts`, which exposes
a single `connectToMongoDB()` returning `{ db, sources, metadata, dataDb,
metaDb, appDb }`. `dataDb`/`metaDb`/`appDb` are legacy aliases — all three
point at the same configured database — so older routes still compile
unchanged.

Collection and database names come from the env:

```
MONGODB_URI                       (default mongodb://mongo:27017)
MONGODB_DB                        (default axia)
MONGODB_CORPUS_COLLECTION         (default sources) — the merged per-source corpus
MONGODB_METADATA_COLLECTION       (default metadata_records)
```

## Components worth knowing

- `ChatWindow.tsx` — the streaming chat itself, with per-agent indicators.
- `DataObjectInfo.tsx` — right panel; renders the UMAP scatter + light
  curves + dE-dt + nearest neighbours.
- `UmapVisualization.tsx` — interactive scatter plot (5000 points). Click
  to select a source; the right panel and chat update accordingly.
- `LightCurveChart.tsx`, `GLLightCurveChart.tsx`, `TimeLightCurveChart.tsx`
  — three views of the light curve at different cadences.
- `NearestNeighbors.tsx` — table of 10 nearest neighbours with similarity
  scores and quick-select.
- `AgentProgressIndicator.tsx` — per-agent stepper that updates as the SSE
  stream sends `progress` / `result` / `artifact` events.
- `ToolOutputRenderer.tsx` — renders HiPS2FITS image cutouts and other
  tool-agent artifacts inline in the chat.
- `JsonUploadModal.tsx`, `FileUploadModal.tsx` — custom source upload
  flow. Calls `/api/embeddings` per source if the model server is
  configured; otherwise saves without `pca_64d` / `umap_2d`.

## Running

```bash
# Dev (host machine, hot reload)
make webapp-dev

# Production (inside docker compose)
make up
```

In compose, the webapp is served by `next start` from the `webapp/Dockerfile`
multi-stage build.

## Building behaviour

`npm run build` runs `next build`. The build is fully type-checked. The
Mongo URI and DB name are read from env at runtime, so the same image
works against both local Mongo and Atlas.

When `MODEL_SERVER_URL` is empty:

- The Event Analyst agent toggle in `AgentSettings.tsx` is disabled.
- The "Generate embeddings on upload" flag in `JsonUploadModal.tsx` falls
  back to "save without embeddings".
- Everything else continues to work.
