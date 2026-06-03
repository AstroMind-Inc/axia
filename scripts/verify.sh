#!/usr/bin/env bash
# Smoke test the running stack.
set -euo pipefail

cd "$(dirname "$0")/.."
[[ -f .env ]] && set -a && source .env && set +a

fail=0
ok()   { printf "  \033[32m✓\033[0m %s\n" "$1"; }
bad()  { printf "  \033[31m✗\033[0m %s\n" "$1"; fail=1; }

echo "Axia stack verification"
echo "----------------------------------------------------------------------"

# 1. projector /health
echo "projector:"
if curl -fsS "http://localhost:${PROJECTOR_PORT:-8001}/health" >/dev/null 2>&1; then
    ok "GET /health on port ${PROJECTOR_PORT:-8001}"
else
    bad "projector not reachable on port ${PROJECTOR_PORT:-8001}"
fi

# 2. service /health
echo "service:"
if curl -fsS "http://localhost:${SERVICE_PORT:-8000}/health" >/dev/null 2>&1; then
    ok "GET /health"
else
    # /health may not exist yet on a brand-new service; try /docs instead
    if curl -fsS "http://localhost:${SERVICE_PORT:-8000}/docs" >/dev/null 2>&1; then
        ok "GET /docs (service is up; /health not implemented)"
    else
        bad "service is not reachable on port ${SERVICE_PORT:-8000}"
    fi
fi

# 3. webapp
echo "webapp:"
WEBAPP_PORT="${WEBAPP_PORT:-3000}"
if curl -fsS "http://localhost:${WEBAPP_PORT}" >/dev/null 2>&1; then
    ok "GET / on port ${WEBAPP_PORT}"
else
    bad "webapp not reachable on port ${WEBAPP_PORT}"
fi

# 4. Mongo: count documents in sources collection
echo "mongo:"
if [[ "${MONGODB_MODE:-local}" == "local" ]]; then
    COLL="${MONGODB_CORPUS_COLLECTION:-${MONGODB_SOURCES_COLLECTION:-sources}}"
    count=$(docker exec axia-mongo mongosh --quiet "${MONGODB_DB:-axia}" \
        --eval "db.getCollection('${COLL}').countDocuments({})" 2>/dev/null || echo "?")
    if [[ "$count" =~ ^[0-9]+$ ]] && (( count > 0 )); then
        ok "${MONGODB_DB:-axia}.${COLL} has $count docs"
    else
        bad "${MONGODB_DB:-axia}.${COLL} is empty or unreachable"
    fi
else
    echo "  (external Mongo — skipping local check)"
fi

echo "----------------------------------------------------------------------"
if (( fail == 0 )); then
    printf "\033[32mAll checks passed.\033[0m\n"
    exit 0
else
    printf "\033[31mSome checks failed.\033[0m  See 'make logs'.\n"
    exit 1
fi
