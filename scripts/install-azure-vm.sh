#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVICE_NAME="sharkinpark-bot"
SERVICE_FILE="/etc/systemd/system/${SERVICE_NAME}.service"

if command -v sudo >/dev/null 2>&1; then
  SUDO="sudo"
else
  SUDO=""
fi

run_as_root() {
  if [[ "$(id -u)" -eq 0 ]]; then
    "$@"
  else
    ${SUDO} "$@"
  fi
}

if ! command -v apt-get >/dev/null 2>&1; then
  echo "This installer currently supports Ubuntu/Debian Azure VMs only."
  exit 1
fi

echo "[1/5] Installing OS packages..."
run_as_root apt-get update
run_as_root apt-get install -y ca-certificates curl gnupg build-essential

if ! command -v node >/dev/null 2>&1 || [[ "$(node -p 'process.versions.node.split(`.`)[0]')" -lt 20 ]]; then
  echo "[2/5] Installing Node.js 20..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | run_as_root bash -
  run_as_root apt-get install -y nodejs
else
  echo "[2/5] Node.js $(node -v) already installed."
fi

echo "[3/5] Installing project dependencies..."
cd "${REPO_DIR}"
npm ci --omit=dev

if [[ ! -f "${REPO_DIR}/.env" ]]; then
  if [[ -f "${REPO_DIR}/.env.example" ]]; then
    cp "${REPO_DIR}/.env.example" "${REPO_DIR}/.env"
  else
    cat > "${REPO_DIR}/.env" <<'EOF'
TOKEN=replace-with-discord-bot-token
CHANNEL_ID=replace-with-channel-id
PORT=10000
EOF
  fi
  echo "Created ${REPO_DIR}/.env. Update TOKEN and CHANNEL_ID before starting."
fi

echo "[4/5] Configuring systemd service..."
SERVICE_CONTENT="[Unit]
Description=Sharkinpark Discord Welcome Bot
After=network.target

[Service]
Type=simple
WorkingDirectory=${REPO_DIR}
EnvironmentFile=${REPO_DIR}/.env
ExecStart=/usr/bin/env node index.js
Restart=always
RestartSec=5
User=$(id -un)
Group=$(id -gn)

[Install]
WantedBy=multi-user.target
"
printf "%s" "${SERVICE_CONTENT}" | run_as_root tee "${SERVICE_FILE}" >/dev/null

run_as_root systemctl daemon-reload
run_as_root systemctl enable "${SERVICE_NAME}"
run_as_root systemctl restart "${SERVICE_NAME}"

echo "[5/5] Done."
echo "Service status:"
run_as_root systemctl --no-pager --full status "${SERVICE_NAME}" | cat
