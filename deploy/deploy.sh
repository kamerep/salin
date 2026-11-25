#!/usr/bin/env bash
# Build Salin on the host and deploy it into its LXD container.
# Idempotent: first run sets the container up, later runs update it.
# Usage: deploy/deploy.sh [--skip-tests]
set -euo pipefail

CT="${SALIN_CONTAINER:-salin}"
IP="${SALIN_IP:-10.246.248.60}"
PORT="${SALIN_PORT:-8795}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"

say() { printf '\n==> %s\n' "$*"; }
in_ct() { lxc exec "$CT" -- "$@"; }

lxc info "$CT" >/dev/null 2>&1 || {
  say "Creating container $CT ($IP)"
  lxc init ubuntu:24.04 "$CT"
  lxc config device override "$CT" eth0 ipv4.address="$IP"
  lxc start "$CT"
  sleep 5
}

if [[ "${1:-}" != "--skip-tests" ]]; then
  say "Backend tests"
  (cd "$ROOT/backend" && "$ROOT/.venv/bin/python" -m pytest -q)
fi

say "Building frontend"
(cd "$ROOT/frontend" && npm ci --silent && npm run build)

say "Container packages and user"
in_ct bash -c '
  set -e
  command -v python3 >/dev/null && dpkg -s python3-venv >/dev/null 2>&1 || {
    export DEBIAN_FRONTEND=noninteractive; apt-get update -qq; apt-get install -y -qq python3-venv sqlite3 >/dev/null; }
  id salin >/dev/null 2>&1 || useradd --system --home /var/lib/salin --shell /usr/sbin/nologin salin
  install -d -o salin -g salin -m 700 /var/lib/salin /var/lib/salin/backups /etc/salin
  install -d -o root -g root -m 755 /opt/salin
'

say "Backup: database copy and container snapshot"
in_ct bash -c "if [ -f /var/lib/salin/salin.db ]; then
  sqlite3 /var/lib/salin/salin.db \".backup /var/lib/salin/backups/salin-$STAMP.db\"
  chown salin:salin /var/lib/salin/backups/salin-$STAMP.db; chmod 600 /var/lib/salin/backups/salin-$STAMP.db
  ls -1t /var/lib/salin/backups/salin-*.db | tail -n +11 | xargs -r rm --; fi"
if ! timeout 180 lxc snapshot "$CT" "deploy-$STAMP"; then
  echo "Warning: container snapshot failed or timed out; the database backup above still exists." >&2
fi
lxc query "/1.0/instances/$CT/snapshots" | python3 -c '
import json,sys; s=sorted(x.rsplit("/",1)[1] for x in json.load(sys.stdin) if "/deploy-" in x); print("\n".join(s[:-3]))' |
  while read -r old; do if [ -n "$old" ]; then lxc delete "$CT/$old"; fi; done

say "Env file"
in_ct bash -c "[ -f /etc/salin/salin.env ] || {
  umask 077; cat > /etc/salin/salin.env <<CONF
SALIN_BIND=$IP
SALIN_PORT=$PORT
SALIN_DATA_DIR=/var/lib/salin
SALIN_ENV_FILE=/etc/salin/salin.env
SALIN_STATIC_DIR=/opt/salin/app/frontend/dist
SALIN_ALLOWED_HOSTS=salin.lxd,$IP
SALIN_OLLAMA_URL=http://127.0.0.1:11434
SALIN_OLLAMA_MODEL=llama3.1:8b
CONF
  chown salin:salin /etc/salin/salin.env; chmod 600 /etc/salin/salin.env; }"

say "Offline fallback: container localhost:11434 -> host Ollama (not exposed to the LAN)"
lxc config device show "$CT" | grep -q '^ollama:' ||
  lxc config device add "$CT" ollama proxy bind=container \
    listen=tcp:127.0.0.1:11434 connect=tcp:127.0.0.1:11434 >/dev/null

say "Pushing code"
in_ct rm -rf /opt/salin/app.new
in_ct mkdir -p /opt/salin/app.new
tar -C "$ROOT" --exclude='__pycache__' --exclude='backend/tests' --exclude='*.pyc' \
  -cz backend/salin backend/pyproject.toml frontend/dist | in_ct tar -C /opt/salin/app.new -xz
in_ct bash -c 'rm -rf /opt/salin/app.old; [ -d /opt/salin/app ] && mv /opt/salin/app /opt/salin/app.old; mv /opt/salin/app.new /opt/salin/app'

say "Python environment"
in_ct bash -c '
  set -e
  [ -x /opt/salin/venv/bin/python ] || python3 -m venv /opt/salin/venv
  /opt/salin/venv/bin/pip install -q --upgrade pip
  /opt/salin/venv/bin/pip install -q /opt/salin/app/backend
'

say "Service"
lxc file push "$ROOT/deploy/salin.service" "$CT/etc/systemd/system/salin.service"
in_ct systemctl daemon-reload
in_ct systemctl enable --now salin >/dev/null 2>&1
in_ct systemctl restart salin

say "Health check"
for _ in $(seq 1 20); do
  if curl -fsS "http://$IP:$PORT/api/health" >/dev/null 2>&1; then
    curl -fsS "http://$IP:$PORT/api/health"; echo
    echo "Salin is up: http://$IP:$PORT  (http://salin.lxd:$PORT once .lxd DNS is enabled)"
    exit 0
  fi
  sleep 1
done
echo "Health check failed. Logs:" >&2
in_ct journalctl -u salin -n 40 --no-pager >&2
exit 1
