#!/usr/bin/env bash
# =============================================================================
# Axia — update a running production deployment
#
#   sudo make prod-update
#
# Fetches the latest $BRANCH, rebuilds the images, and restarts the stack via
# the axia systemd unit installed by the EC2 bootstrap.
#
# The images are built BEFORE anything is stopped. The build is the slow and
# failure-prone step (a dependency bump can break it), so doing it first means
# the site keeps serving throughout, and a failure costs no downtime at all —
# the restart simply never happens.
#
# Environment overrides:
#   INSTALL_DIR   deployment directory      (default: the repo this lives in)
#   BRANCH        branch to deploy          (default: main)
#   UNIT          systemd unit              (default: axia.service)
#   ALLOW_DIRTY=1 deploy despite local edits
#   RESTART_ONLY=1 skip the pull; rebuild and restart what is already checked out
# =============================================================================
set -euo pipefail

INSTALL_DIR="${INSTALL_DIR:-$(cd "$(dirname "$0")/.." && pwd)}"
BRANCH="${BRANCH:-main}"
UNIT="${UNIT:-axia.service}"

bold() { printf "\033[1m%s\033[0m\n" "$1"; }
ok()   { printf "  \033[32m✓\033[0m %s\n" "$1"; }
warn() { printf "  \033[33m!\033[0m %s\n" "$1"; }
die()  { printf "\033[31mERROR:\033[0m %s\n" "$1" >&2; exit 1; }

# ── Pre-flight ───────────────────────────────────────────────────────────────
bold "Axia production update"
echo "----------------------------------------------------------------------"

[[ $EUID -eq 0 ]] || die "must run as root (the repo and the docker socket are root-owned). Use: sudo make prod-update"
git -C "$INSTALL_DIR" rev-parse --git-dir >/dev/null 2>&1 || die "$INSTALL_DIR is not a git checkout. Set INSTALL_DIR to the deployment directory."
cd "$INSTALL_DIR"
[[ -f .env ]] || die "$INSTALL_DIR/.env is missing. Production config lives there and is never in git."

# .env holds every production secret (Google client secret, AUTH_SECRET,
# OpenAI key). Created with `cp`/`nano` it is world-readable, so any local
# account or compromised process on the host could read it.
if [[ "$(stat -c '%a' .env 2>/dev/null || stat -f '%Lp' .env)" != "600" ]]; then
    chmod 600 .env
    chown root:root .env 2>/dev/null || true
    ok "tightened .env permissions to 600 (owner only)"
fi

# Every page and API route requires Google sign-in. Without these the new
# containers would come up unable to sign anyone in (or fail every request
# for want of a session secret), after the old ones were already stopped.
# Check before building so a missing value costs no downtime.
missing_auth=()
for var in AUTH_SECRET AUTH_GOOGLE_ID AUTH_GOOGLE_SECRET; do
    value="$(grep -E "^${var}=" .env | tail -n1 | cut -d= -f2- | tr -d "\"'" || true)"
    [[ -n "$value" ]] || missing_auth+=("$var")
done
if (( ${#missing_auth[@]} > 0 )); then
    die "$INSTALL_DIR/.env is missing ${missing_auth[*]}. Google sign-in needs them; see docs/08_deployment.md (Google sign-in)."
fi
ok "Google sign-in configured (AUTH_SECRET, AUTH_GOOGLE_ID, AUTH_GOOGLE_SECRET)"

# .env is gitignored, so a pull can never update it. Surfacing the model here
# because a stale OPENAI_DEFAULT_MODEL silently selects a retired model.
configured_model="$(grep -E '^OPENAI_DEFAULT_MODEL=' .env | cut -d= -f2- | tr -d '"' || true)"
ok "deployment: $INSTALL_DIR (branch $BRANCH)"
ok "OPENAI_DEFAULT_MODEL=${configured_model:-<unset, using built-in default>}"

if [[ -n "$(git status --porcelain)" ]]; then
    if [[ "${ALLOW_DIRTY:-0}" == "1" ]]; then
        warn "working tree has local changes — continuing because ALLOW_DIRTY=1"
    else
        git status --short
        die "working tree has local changes. Commit, stash or revert them, or re-run with ALLOW_DIRTY=1."
    fi
fi

OLD_HEAD="$(git rev-parse HEAD)"

# ── Fetch and report what is about to land ───────────────────────────────────
if [[ "${RESTART_ONLY:-0}" == "1" ]]; then
    warn "RESTART_ONLY=1 — skipping the pull"
else
    echo ""
    bold "Fetching origin/$BRANCH ..."
    git fetch origin "$BRANCH" --quiet
    incoming="$(git log --oneline "HEAD..origin/$BRANCH")"
    if [[ -z "$incoming" ]]; then
        ok "already up to date at $(git log --oneline -1)"
        echo ""
        echo "Nothing to deploy. To rebuild and restart anyway: sudo make prod-update RESTART_ONLY=1"
        exit 0
    fi
    echo ""
    bold "Commits to be deployed:"
    echo "$incoming" | sed 's/^/  /'
    echo ""
    git merge --ff-only "origin/$BRANCH" --quiet \
        || die "cannot fast-forward — the deployment has diverged from origin/$BRANCH. Resolve by hand."
    ok "now at $(git log --oneline -1)"
fi

# ── Build first, while the old stack keeps serving ───────────────────────────
DC="docker compose"
docker compose version >/dev/null 2>&1 || DC="docker-compose"
PROFILE="$(grep -E '^MONGODB_MODE=' .env 2>/dev/null | cut -d= -f2 | tr -d '"' || true)"
COMPOSE=($DC -f docker-compose.yml -f docker-compose.prod.yml --profile "${PROFILE:-local}")

echo ""
bold "Building images (the running stack is untouched) ..."
if ! "${COMPOSE[@]}" build; then
    echo ""
    die "build failed — nothing was restarted, the site is still serving the previous version."
fi
ok "images built"

# ── Restart ──────────────────────────────────────────────────────────────────
echo ""
bold "Restarting the stack ..."
rollback_hint() {
    echo ""
    echo "To roll back:"
    echo "  sudo git -C $INSTALL_DIR reset --hard $OLD_HEAD"
    echo "  sudo systemctl restart $UNIT"
}
trap 'rollback_hint' ERR

if systemctl list-unit-files "$UNIT" >/dev/null 2>&1 && systemctl cat "$UNIT" >/dev/null 2>&1; then
    systemctl restart "$UNIT"
    ok "restarted via $UNIT"
else
    warn "$UNIT not installed — falling back to docker compose"
    "${COMPOSE[@]}" up -d
    ok "stack brought up with docker compose"
fi
trap - ERR

# ── Autoheal (host timer, replaces the autoheal container) ───────────────────
# The old autoheal container held the Docker socket, which is root on the
# host. It is no longer in the compose files, so `compose down/up` leaves it
# running as an orphan; remove it explicitly. It is stateless.
if docker inspect axia-autoheal >/dev/null 2>&1; then
    docker rm -f axia-autoheal >/dev/null
    ok "removed the retired axia-autoheal container (it held the Docker socket)"
fi
install_autoheal_timer() {
    local svc=/etc/systemd/system/axia-autoheal.service
    local tmr=/etc/systemd/system/axia-autoheal.timer
    local svc_body tmr_body
    svc_body="[Unit]
Description=Axia: restart unhealthy containers
After=docker.service

[Service]
Type=oneshot
ExecStart=/usr/bin/env bash ${INSTALL_DIR}/scripts/autoheal.sh"
    tmr_body="[Unit]
Description=Axia: check container health every 30 seconds

[Timer]
OnBootSec=3min
OnUnitActiveSec=30s
AccuracySec=5s

[Install]
WantedBy=timers.target"
    if [[ "$(cat "$svc" 2>/dev/null)" != "$svc_body" || "$(cat "$tmr" 2>/dev/null)" != "$tmr_body" ]]; then
        printf '%s\n' "$svc_body" > "$svc"
        printf '%s\n' "$tmr_body" > "$tmr"
        systemctl daemon-reload
    fi
    systemctl enable --now axia-autoheal.timer >/dev/null 2>&1
}
if command -v systemctl >/dev/null 2>&1 && install_autoheal_timer; then
    ok "autoheal timer active (axia-autoheal.timer)"
else
    warn "could not install axia-autoheal.timer; unhealthy containers will not be restarted automatically"
fi

# ── Verify ───────────────────────────────────────────────────────────────────
echo ""
bold "Waiting for containers to become healthy ..."
for _ in $(seq 1 30); do
    unhealthy="$(docker ps --filter "name=axia-" --format '{{.Names}} {{.Status}}' | grep -c "health: starting" || true)"
    [[ "$unhealthy" == "0" ]] && break
    sleep 2
done
docker ps --filter "name=axia-" --format 'table {{.Names}}\t{{.Status}}' | sed 's/^/  /'

echo ""
bash scripts/verify.sh || {
    echo ""
    warn "verification reported problems — check: journalctl -u $UNIT -n 100 --no-pager"
    rollback_hint
    exit 1
}

echo ""
bold "Deployed $(git log --oneline -1)"
echo "  Logs: journalctl -u $UNIT -f     Containers: docker compose logs -f"
