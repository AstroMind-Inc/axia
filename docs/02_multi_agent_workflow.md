# 02 — Multi-agent workflow

The orchestrator (`service/src/agents/workflow.py`) runs a six-step pipeline
on every chat turn. Steps 1, 3, 4 are conditional; steps 2, 5, 6 always run.
Updates are streamed to the webapp over Server-Sent Events as soon as each
agent produces a result.

## Execution order

```
                +----------------------+
  user input ─> | (1) Event Analyst    | <- fine-tuned Qwen-7B + XrayProcessor (optional)
                +----------------------+
                          v
                +----------------------+
                | (2) Metadata Analyst | <- GPT-5 + spectrum_snapshot + light-curve PNG + dE-dt PNG (always)
                +----------------------+
                          v
                +----------------------+
                | (3) Neighbour Analyst| <- GPT-5 + nearest-neighbours from MongoDB (optional)
                +----------------------+
                          v
                +----------------------+
                | (4) Tool Agent       | <- GPT-5 + HiPS2FITS multi-wavelength imaging (optional)
                +----------------------+
                          v
                +----------------------+
                | (5) Critic           | <- GPT-5 (always)
                +----------------------+
                          v
                +----------------------+
                | (6) Conv. Moderator  | <- GPT-5 (always)
                +----------------------+
                          v
                       final answer
```

## When each step runs

| Step | Skipped when ... | Why |
|---|---|---|
| 1 Event Analyst | `event_list` is missing OR `MODEL_SERVER_URL` is empty OR the user disabled it. | The model server is the only thing that can produce this answer. Skipping is cheap. |
| 2 Metadata Analyst | The user disabled it. | The spectrum snapshot is the most robust analysis; this is the spine of the workflow. |
| 3 Neighbour Analyst | The source has no `pca_64d` embedding OR no neighbours were returned. | Needs the vector embedding for similarity search. |
| 4 Tool Agent | The source has no RA/Dec coordinates OR the user disabled it. | HiPS2FITS requires sky coordinates. |
| 5 Critic | The user disabled it. | Independent review of the four prior outputs. |
| 6 Conversation Moderator | Never. | Always produces the final user-facing answer. |

When `MODEL_SERVER_URL` is unset, the service automatically forces
`eventAnalyst=False` for every request (see `service/src/api/chat.py`).

## Agent configuration

The webapp can toggle agents 1, 3, 4, 5 on/off per chat turn via the
`agent_config` field on `POST /v1/chat/stream`. Agents 2 and 6 cannot be
disabled — the workflow synthesis depends on them.

```ts
{
  "message": "What type of source is this?",
  "model": "astromind-multi-agent",
  "data_obj": { ...source document... },
  "event_list": [[t, E], ...],
  "neighbors":  [ ...10 neighbour docs... ],
  "agent_config": {
    "eventAnalyst":    true,
    "metadataAnalyst": true,
    "neighborAnalyst": true,
    "critic":          true,
    "toolAgent":       true
  }
}
```

## Streaming protocol

`POST /v1/chat/stream` returns `text/event-stream`. Each event has a `type`:

| Type | Emitted when | Payload |
|---|---|---|
| `init` | Workflow started | `{ request_id }` |
| `start` | Initial banner | `{ total_steps }` |
| `progress` | An agent began | `{ agent, step, status: "running", message }` |
| `result` | An agent finished | `{ agent, step, content }` |
| `artifact` | An agent produced an image | `{ agent, artifact: { name, format, data, ... } }` |
| `tool_call` | The Tool Agent invoked HiPS2FITS | `{ tool_name, params, result }` |
| `final` | Moderator's final answer | `{ full_result: { response, agent_conversation, tool_executions, artifacts } }` |
| `keepalive` | Idle tick (every ~1s) | `{}` |
| `error` | Anything blew up | `{ error, message }` |
| `complete` | Stream is done | `{}` |

The workflow runs as a background asyncio task in the service. If the SSE
client disconnects, the task continues and stores the final result in an
in-memory cache for up to 5 minutes (see
`service/src/api/_task_manager.py`).

## Where each agent lives

```
service/src/agents/
├── workflow.py        # SimpleWorkflow — the orchestration above
├── infer.py           # generate_multi_agent_response (async generator)
├── state.py           # SimpleWorkflowState TypedDict
├── critic.py          # CriticAgent (step 5)
├── moderator.py       # ConversationModerator (step 6)
├── neighbor.py        # NeighborAnalysisAgent (step 3)
├── event_analysis.py  # call_event_analysis — HTTP call to model server (step 1)
└── tool_agent.py      # ToolAgent (step 4) — hardcoded HiPS2FITS imaging
                       #                       agent with the JSON tool spec
                       #                       and system prompt inlined
```

The Tool Agent (step 4) is deliberately single-purpose. There is no generic
tool registry, no YAML tool definitions, and no plug-in interface — see the
docstring at the top of `tool_agent.py`. If you want to extend the agent to
call other services (SIMBAD, NED, redshift catalogues, ...), you would add
them by editing `tool_agent.py` directly. This kept the public reference
implementation focused and removed all infrastructure that isn't needed to
reproduce the paper's results.

The Metadata Analyst is wired into the workflow directly via the OpenAI
client at `service/src/llm/openai_infer.py`; it consumes the spectrum
snapshot from `service/src/spectrum/snapshot.py`.

## Response formats

Two modes (set via `response_format` on the request):

- **Normal** (default) — conversational answer with key reasoning.
- **Advanced** — structured output with explicit sections:
  1. Answer with confidence,
  2. What each analysis proposed,
  3. Discussion & rationale,
  4. Astrophysical property discussion (alternative hypotheses),
  5. Conclusion.

The Moderator decides the formatting based on this flag.

## Typical timing

| Step | Latency |
|---|---|
| 1 Event Analyst (GPU inference) | 1–2 s |
| 2 Metadata Analyst (snapshot + GPT-5) | 8–15 s |
| 3 Neighbour Analyst (10 neighbours + GPT-5) | 8–15 s |
| 4 Tool Agent (HiPS2FITS + iterative GPT-5) | 30–90 s |
| 5 Critic (GPT-5) | 5–10 s |
| 6 Moderator (GPT-5) | 5–10 s |

End-to-end: ~25–40 s without the Tool Agent, up to a few minutes with it.
