#!/usr/bin/env bash
# =============================================================================
# Axia — restart unhealthy containers (one pass)
#
# Run every 30 s by the axia-autoheal.timer systemd unit that
# scripts/prod-update.sh installs on the production host.
#
# This replaces the willfarrell/autoheal container. That container needed the
# Docker socket, and the Docker API has no read-only mode: whoever controls a
# process holding the socket can start a privileged container and own the
# host. A socket-filtering proxy does not fix that here, because the
# "restart" permission cannot be granted without also allowing container
# create and start. Running this check on the host, from this repository,
# removes the socket from every container.
#
# Only containers labelled axia.autoheal=true are touched, so nothing else on
# the host is ever restarted by this.
# =============================================================================
set -euo pipefail

for id in $(docker ps -q --filter label=axia.autoheal=true --filter health=unhealthy); do
    name="$(docker inspect -f '{{.Name}}' "$id" | sed 's#^/##')"
    echo "restarting unhealthy container ${name} (${id})"
    docker restart -t 10 "$id" >/dev/null || echo "restart of ${name} failed" >&2
done
