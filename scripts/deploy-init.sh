#!/usr/bin/env bash
# =============================================================================
# Axia — one-time EC2 bootstrap script
#
# Run as root (or with sudo) on a fresh Ubuntu 22.04+ EC2 instance:
#   curl -sSL https://raw.githubusercontent.com/AstroMind-Inc/axia/main/scripts/deploy-init.sh | sudo bash
#   (or: sudo bash scripts/deploy-init.sh   if you already cloned)
#
# What it does:
#   1. Installs Docker + Docker Compose plugin
#   2. Clones the axia repo to /opt/axia
#   3. Installs the systemd unit for auto-start
#   4. Opens firewall ports 80, 443, 22
#   5. Prints next steps
# =============================================================================
set -euo pipefail

REPO_URL="https://github.com/AstroMind-Inc/axia.git"
INSTALL_DIR="/opt/axia"
BRANCH="main"

echo "============================================================"
echo " Axia EC2 bootstrap"
echo "============================================================"
echo ""

# ── 1. Docker ───────────────────────────────────────────────────
if ! command -v docker &>/dev/null; then
    echo "[1/5] Installing Docker ..."
    apt-get update -qq
    apt-get install -y -qq ca-certificates curl gnupg
    install -m 0755 -d /etc/apt/keyrings
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
    chmod a+r /etc/apt/keyrings/docker.gpg
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
      https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
      > /etc/apt/sources.list.d/docker.list
    apt-get update -qq
    apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-compose-plugin
    systemctl enable docker
    systemctl start docker
    echo "  Docker installed: $(docker --version)"
else
    echo "[1/5] Docker already installed: $(docker --version)"
fi

# ── 2. Clone repo ──────────────────────────────────────────────
if [ -d "$INSTALL_DIR/.git" ]; then
    echo "[2/5] Repo already at $INSTALL_DIR — pulling latest ..."
    cd "$INSTALL_DIR"
    git fetch origin
    git checkout "$BRANCH"
    git pull origin "$BRANCH"
else
    echo "[2/5] Cloning $REPO_URL → $INSTALL_DIR ..."
    git clone --branch "$BRANCH" "$REPO_URL" "$INSTALL_DIR"
    cd "$INSTALL_DIR"
fi

# ── 3. Systemd unit ────────────────────────────────────────────
echo "[3/5] Installing systemd unit ..."
cat > /etc/systemd/system/axia.service <<'UNIT'
[Unit]
Description=Axia Docker Compose stack
After=docker.service
Requires=docker.service

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=/opt/axia
ExecStart=/usr/bin/docker compose -f docker-compose.yml -f docker-compose.prod.yml --profile local up -d --build
ExecStop=/usr/bin/docker compose -f docker-compose.yml -f docker-compose.prod.yml --profile local down
ExecReload=/usr/bin/docker compose -f docker-compose.yml -f docker-compose.prod.yml --profile local up -d --build
TimeoutStartSec=300
Restart=on-failure
RestartSec=30

[Install]
WantedBy=multi-user.target
UNIT

systemctl daemon-reload
systemctl enable axia.service
echo "  axia.service installed and enabled"

# ── 4. Firewall ────────────────────────────────────────────────
echo "[4/5] Configuring firewall (ufw) ..."
if command -v ufw &>/dev/null; then
    ufw allow 22/tcp   # SSH
    ufw allow 80/tcp   # HTTP (Caddy redirect)
    ufw allow 443/tcp  # HTTPS
    ufw --force enable
    echo "  Firewall enabled: 22, 80, 443 open"
else
    echo "  ufw not installed — make sure your EC2 security group allows 22, 80, 443"
fi

# ── 5. Next steps ──────────────────────────────────────────────
echo "[5/5] Done!"
echo ""
echo "============================================================"
echo " Next steps:"
echo "============================================================"
echo ""
echo " 1. Configure the environment:"
echo "      cd $INSTALL_DIR"
echo "      cp .env.example .env"
echo "      nano .env"
echo ""
echo "    Required settings:"
echo "      DOMAIN=<your-domain>         (e.g. app.example.com)"
echo "      OPENAI_API_KEY=<your-key>    (for the GPT agents)"
echo ""
echo " 2. Start the stack:"
echo "      make prod-up"
echo "    (or: systemctl start axia)"
echo ""
echo " 3. Load the full dataset:"
echo "      make load-from-hf"
echo ""
echo " 4. Point your DNS:"
PUBLIC_IP=$(curl -s http://169.254.169.254/latest/meta-data/public-ipv4 2>/dev/null || echo '<this-instance-public-ip>')
echo "      A record: <your-domain> → $PUBLIC_IP"
echo "    Caddy will auto-provision a Let's Encrypt certificate."
echo ""
echo " 5. Verify:"
echo "      make verify"
echo "      curl https://<your-domain>/   (after DNS propagates)"
echo ""
echo "============================================================"
echo " Management commands:"
echo "   systemctl start axia     — start the stack"
echo "   systemctl stop axia      — stop the stack"
echo "   systemctl restart axia   — restart (rebuild + up)"
echo "   journalctl -u axia -f    — system-level logs"
echo "   make logs                — container logs"
echo "   make verify              — health check"
echo "============================================================"
