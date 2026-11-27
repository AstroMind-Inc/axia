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
5. Generate a shared secret (`openssl rand -hex 32`) and start the server
   with it: `docker run --gpus all -p 8000:8000 -e MODEL_SERVER_TOKEN=<secret> -v $CKPT:/workspace/qwen-7b/... axia-model-server`
6. Expose port 8000 via the instance's public URL, over HTTPS if the
   provider offers it.
7. Set `MODEL_SERVER_URL=<that URL>` and `MODEL_SERVER_TOKEN=<secret>` in
   your `.env` and `make restart`.

Without `MODEL_SERVER_TOKEN` the server answers anyone who finds the URL,
which lets strangers run generations on your GPU.

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
| `MODEL_SERVER_TOKEN` | empty | Shared secret sent as `Authorization: Bearer` to the model server. Set the same value on the model server. |
| `ALLOW_CUSTOM_MODEL_URL` | `false` | When `true`, signed-in users can point the backend at their own model server URL from the playground settings. Keep `false` on shared deployments (see Production notes). |
| `OPENAI_API_KEY` | empty | Required for the GPT-5 agents. |
| `OPENAI_DEFAULT_MODEL` | `gpt-5.6-sol` | Model id used when the request does not specify one. One of `gpt-5.6-sol`, `gpt-5.6-terra`, `gpt-5.6-luna`. |
| `SERVICE_HOST` / `SERVICE_PORT` | `0.0.0.0 / 8000` | Service bind address. |
| `SERVICE_DEBUG` | `false` | Enables hot reload + debug logs. |
| `NEXT_PUBLIC_API_URL` | `http://localhost:8000` | Where the webapp finds the service. |
| `MAX_CONCURRENT_WORKFLOWS` | `8` | Multi-agent runs the service allows at once across all users. Further requests get a "busy" message. |
| `MAX_EVENTS_PER_LIST` / `MAX_EVENT_TIME_SPAN_S` | `50000` / `2000000` | Largest event list (events, seconds) the service and projector accept. |
| `HF_REVISION`, `PROJECTOR_WEIGHTS_SHA256`, `PROJECTOR_BUNDLE_SHA256` | pinned | Hugging Face commit and digests of the projector artifacts. Change all three together when shipping retrained weights. |
| `AUTH_SECRET` | generated by `make setup` | NextAuth session secret. Required. |
| `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET` | empty | Google OAuth client credentials. Required: every page and API needs sign-in. |
| `AUTH_URL` | `http://localhost:3000` | Public origin of the webapp. Google redirect URI is `{AUTH_URL}/api/auth/callback/google`. |
| `AUTH_TRUST_HOST` | `true` | Lets NextAuth trust `X-Forwarded-Host` behind Caddy. |

## Production notes

This is a research reference implementation, not production-grade software.
A few things to be aware of:

- The service has **no CORS** by default and **no authentication**. It is
  reachable only by the webapp over the docker network; never publish it.
- The service holds chat workflows **in memory**; restarting it loses
  in-flight requests. Per-design.
- Database settings are server-only. Never put them in `NEXT_PUBLIC_*`
  variables: Next.js inlines those into the build.
- `OPENAI_API_KEY` is server-side only and never sent to the browser.
- Every page and API route requires Google sign-in; only `/login` and the
  Auth.js callbacks are public. Any Google account can sign in. Chats,
  uploads (both `user_uploaded_sources` and uploaded JSON collections),
  settings, and feedback are scoped to the signed-in Google account
  (`user_id`); another user's items return 404.
- In the Google Cloud console, set the OAuth consent screen's publishing
  status to **In production**. In **Testing** only listed test users can
  sign in. The app asks only for the basic `openid email profile` scopes, so
  no Google verification review is needed.
- Chats and uploads saved before sign-in existed belong to `default_user`.
  They stay in Mongo but are not shown to anyone.
- `sudo make prod-update` refuses to deploy if `AUTH_SECRET`,
  `AUTH_GOOGLE_ID` or `AUTH_GOOGLE_SECRET` is missing from `.env`, so the
  running site is not replaced by one nobody can sign in to.
- Custom model server URLs from the browser are ignored unless
  `ALLOW_CUSTOM_MODEL_URL=true`. Otherwise any signed-in user could make the
  service send requests (with other users' prompts and event lists, via the
  shared `model_config` document) to a host of their choosing, or probe the
  internal network.
- For HTTPS behind Caddy, set `AUTH_URL=https://$DOMAIN` (same host users
  type in the browser) and register that callback in the Google Cloud
  OAuth client. Do not leave `AUTH_URL` as `http://localhost:3000`.
- The FastAPI service is not exposed on the public Caddy routes. Keep it
  on `127.0.0.1` or an internal network.
- Abuse limits: every signed-in user is rate limited per account (multi-agent
  chat and validation: 30 per 10 minutes and 200 per day; analysis and
  neighbour searches: 120 per minute; uploads: 20 per hour), keeps at most
  50 uploaded datasets, and the service rejects oversized inputs. These
  bound the damage one account can do, but they are per process and reset
  on restart, so also set a monthly budget on the OpenAI project (below).

## Host and account hardening (do once, outside the repo)

The repo cannot enforce these; they are settings on the EC2 instance, in
AWS, and in the provider consoles. The first three decide whether a
compromise of Axia can reach anything else AstroMind runs.

1. **Instance metadata (IMDSv2, hop limit 1).** Containers can otherwise
   read the instance's IAM credentials from `169.254.169.254`:
   ```
   aws ec2 modify-instance-metadata-options --instance-id <id> \
       --http-tokens required --http-put-response-hop-limit 1
   ```
   And block it from containers outright:
   ```
   sudo iptables -I DOCKER-USER -d 169.254.169.254 -j DROP
   sudo apt-get install -y iptables-persistent && sudo netfilter-persistent save
   ```
2. **IAM.** The instance needs no AWS permissions. Detach the instance
   profile, or attach a role with no policies. Never put AWS keys in `.env`.
3. **Network isolation.** Run Axia in its own VPC (or at least a security
   group that no other AstroMind security group trusts), with no peering or
   transit-gateway route to other environments. Inbound: 80 and 443 from
   anywhere, 22 only from your IP (or none, using SSM Session Manager).
4. **OpenAI.** Use a key from a dedicated OpenAI *project* for Axia, with a
   monthly budget, not an org-wide or personal key shared with other apps.
5. **Google OAuth.** Use a dedicated Google Cloud project and OAuth client
   for Axia whose only redirect URI is
   `https://$DOMAIN/api/auth/callback/google`.
6. **`.env`.** `sudo make prod-update` sets it to mode 600, owned by root.
   Do not add `HF_TOKEN` there unless you are publishing to Hugging Face from
   this host; the stack does not need it.
7. **GitHub.** Turn on Dependabot security updates for the repository, and
   keep `main` behind required review: the host deploys `main` as root.

## How a production host runs the stack

The EC2 bootstrap installs a systemd unit, `axia.service`, with the
deployment checked out at `/opt/axia`:

```
WorkingDirectory=/opt/axia
ExecStart=docker compose -f docker-compose.yml -f docker-compose.prod.yml --profile local up -d --build
```

The unit is `systemctl enable`d, so the stack comes back on boot without
anyone logging in. Underneath it the containers carry
`restart: unless-stopped`, and the `axia-autoheal.timer` systemd timer
(installed by `make prod-update`) runs `scripts/autoheal.sh` every 30 s to
restart any container labelled `axia.autoheal=true` that fails its
healthcheck. The containers can legitimately be running while
`systemctl status axia` reports `inactive (dead)` — the unit is
`Type=oneshot`, and Docker keeps the stack alive independently of it.

Autoheal runs on the host rather than in a container on purpose: a container
that can restart others needs the Docker socket, which amounts to root on
the host. No container in this stack mounts the socket.

The repo and the docker socket are root-owned, so every management command
needs `sudo`:

| Command | Purpose |
|---|---|
| `sudo systemctl start axia` | Start the stack |
| `sudo systemctl stop axia` | Stop the stack |
| `sudo systemctl restart axia` | Rebuild and restart |
| `sudo journalctl -u axia -f` | Unit-level logs |
| `sudo journalctl -u axia-autoheal -n 50` | Containers autoheal restarted |
| `sudo docker ps` | Container status |

## Updating a running deployment

```bash
cd /opt/axia
sudo make prod-update
```

That fetches the latest `main`, rebuilds the images, restarts via the
systemd unit and runs the smoke test. It refuses to run on a dirty working
tree, and it **builds before it stops anything** — the build is the slow,
failure-prone step, so the site keeps serving throughout and a failed build
costs no downtime. On failure it prints the exact commands to roll back to
the previous commit.

Useful overrides:

| Variable | Effect |
|---|---|
| `RESTART_ONLY=1` | Skip the pull; rebuild and restart what is checked out |
| `ALLOW_DIRTY=1` | Deploy despite local modifications |
| `BRANCH=...` | Deploy a branch other than `main` |
| `INSTALL_DIR=...` | Point at a deployment other than `/opt/axia` |

> `.env` is gitignored and is never touched by an update. Settings that
> live only there — `OPENAI_API_KEY`, `OPENAI_DEFAULT_MODEL`, `DOMAIN` —
> must be changed by hand on the host. `prod-update` prints the configured
> `OPENAI_DEFAULT_MODEL` during pre-flight so a stale value is visible
> before it takes effect.

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
