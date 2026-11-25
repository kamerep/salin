# Setup and operations

Salin runs as one process on one port inside a dedicated LXD container: a FastAPI backend that also serves the built React frontend, with SQLite for storage.

## Requirements

On the host:

- LXD with a bridge network (default `lxdbr0`)
- Node.js 20+ and npm (to build the frontend)
- [uv](https://docs.astral.sh/uv/) or Python 3.12+ with venv (to run the tests)
- An Anthropic API key from the Claude Console. A claude.ai subscription cannot be used: the API is billed separately, per use.
- Optional: [Ollama](https://ollama.com) with `llama3.1:8b` for the offline fallback

## First deployment

```bash
git clone https://github.com/kamerep/salin.git
cd salin
uv venv --python 3.12 .venv
uv pip install --python .venv/bin/python -e "backend[dev]"
deploy/deploy.sh
```

`deploy/deploy.sh` is idempotent. On the first run it:

1. Creates the `salin` container (Ubuntu 24.04) with a fixed bridge address (default `10.246.248.60`, override with `SALIN_IP`).
2. Runs the backend tests and builds the frontend.
3. Creates the `salin` system user, `/var/lib/salin` (database, backups) and `/etc/salin/salin.env` (mode 600).
4. Adds an LXD proxy device so `127.0.0.1:11434` inside the container reaches Ollama on the host. Nothing is exposed to the LAN.
5. Installs the code into `/opt/salin`, a virtualenv with pinned dependencies, and the `salin` systemd unit.
6. Checks `/api/health`.

Then open `http://10.246.248.60:8795`, go to **Settings** and add the API key.

Variables: `SALIN_CONTAINER` (default `salin`), `SALIN_IP`, `SALIN_PORT` (default `8795`). Pick a port that is free on your machine.

## Updating

```bash
git pull
deploy/deploy.sh            # or --skip-tests
```

Every deploy first copies the database to `/var/lib/salin/backups/` (last 10 kept) and takes an LXD snapshot `deploy-<timestamp>` (last 3 kept).

## Using salin.lxd

The service accepts `salin.lxd` as a host name. To resolve `.lxd` names on the host (systemd-resolved), run once per boot or put it in a unit:

```bash
sudo resolvectl dns lxdbr0 "$(lxc network get lxdbr0 ipv4.address | cut -d/ -f1)"
sudo resolvectl domain lxdbr0 '~lxd'
```

Then use `http://salin.lxd:8795`. If you browse by another name, add it to `SALIN_ALLOWED_HOSTS` in `/etc/salin/salin.env`.

## Desktop launcher and clipboard hotkey

```bash
deploy/host/install-desktop.sh            # launcher, icon, salin-open, salin-clip
deploy/host/install-desktop.sh --hotkey   # also binds Super+Alt+T (GNOME)
sudo apt install wl-clipboard             # needed by salin-clip on Wayland
```

## Configuration

`/etc/salin/salin.env` (owned by `salin`, mode 600):

| Variable | Meaning |
|---|---|
| `SALIN_BIND`, `SALIN_PORT` | Address and port uvicorn listens on (the bridge address only) |
| `SALIN_DATA_DIR` | Database directory |
| `SALIN_STATIC_DIR` | Built frontend |
| `SALIN_ALLOWED_HOSTS` | Host names the server answers to |
| `SALIN_OLLAMA_URL`, `SALIN_OLLAMA_MODEL` | Offline fallback |
| `ANTHROPIC_API_KEY` | Written by Settings; can also be set by hand |

After a manual edit: `lxc exec salin -- systemctl restart salin`.

## Operations

```bash
lxc exec salin -- systemctl status salin
lxc exec salin -- journalctl -u salin -f          # logs: no message text is logged
lxc exec salin -- ls /var/lib/salin/backups       # database backups
lxc restore salin deploy-<timestamp>              # roll back a deploy
```

Restore one database backup:

```bash
lxc exec salin -- systemctl stop salin
lxc exec salin -- cp /var/lib/salin/backups/salin-<timestamp>.db /var/lib/salin/salin.db
lxc exec salin -- systemctl start salin
```

## Development

```bash
# backend on 127.0.0.1:8796 with a local data folder
cd backend && SALIN_DATA_DIR=../var SALIN_ENV_FILE=../var/salin.env \
  ../.venv/bin/uvicorn --factory salin.main:create_app --port 8796 --reload
# frontend with hot reload on 5179, proxying /api to 8796
cd frontend && npm run dev
# tests
cd backend && ../.venv/bin/python -m pytest -q
```

Rebuild these documents with `.venv/bin/python docs/build.py`.
