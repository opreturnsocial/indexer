# ORS Indexer VPS Deployment Plan

## Context

Deploy the ORS indexer service to a VPS that already runs bitcoin Core (IBD complete) and Caddy. The indexer runs as a systemd unit from `/opt/ors-indexer`. It scans the bitcoin blockchain for OP_RETURN data and exposes an HTTP API.

**Assumed subdomain** (replace `example.com` throughout):

- `indexer.ors.example.com` -> indexer :3010

---

## Phase 1 - VPS Prerequisites

### 1.1 Node.js 20 + Yarn

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
sudo npm install -g yarn
```

---

## Phase 2 - Clone and Build

```bash
sudo mkdir -p /opt/ors-indexer
sudo chown $USER:$USER /opt/ors-indexer
cd /opt/ors-indexer
git clone <your-github-repo-url> .
```

### 2.1 Configure environment file

```bash
cp .env.example .env
```

Edit values:

```ini
DATABASE_URL=file:/opt/ors-indexer/data/prod.db

# bitcoin Core RPC (mainnet)
BITCOIN_RPC_HOST=127.0.0.1
BITCOIN_RPC_PORT=8332
BITCOIN_RPC_USER=<your-rpc-user>
BITCOIN_RPC_PASS=<your-rpc-pass>

# Start scanning from first known ORS transaction on mainnet
START_BLOCK=940000

PORT=3010

# Set a strong random value
INTERNAL_TOKEN=<strong-random-secret>
```

### 2.2 Create data directory for SQLite

```bash
mkdir -p /opt/ors-indexer/data
```

### 2.3 Install

```bash
yarn install
```

### 2.4 Database setup

```bash
yarn db:generate
yarn db:migrate:prod
```

### 2.5 Build

```bash
yarn build
```

---

## Phase 3 - Systemd Service

### 3.1 Create service unit

```bash
sudo tee /etc/systemd/system/ors-indexer.service <<EOF
[Unit]
Description=ORS Indexer
After=network.target

[Service]
Type=simple
User=$USER
WorkingDirectory=/opt/ors-indexer
ExecStart=/usr/bin/node /opt/ors-indexer/dist/index.js
Restart=on-failure
RestartSec=5
EnvironmentFile=/opt/ors-indexer/.env

[Install]
WantedBy=multi-user.target
EOF
```

### 3.2 Enable and start

```bash
sudo systemctl daemon-reload
sudo systemctl enable ors-indexer
sudo systemctl start ors-indexer
sudo systemctl status ors-indexer
```

Check logs:

```bash
journalctl -u ors-indexer -f
```

---

## Phase 4 - Caddy Configuration

Add to your Caddyfile. Caddy will auto-provision TLS.

```caddy
# Indexer API
indexer.ors.example.com {
    reverse_proxy localhost:3010
}
```

Reload Caddy:

```bash
sudo caddy reload --config /etc/caddy/Caddyfile
# or
sudo systemctl reload caddy
```

---

## Phase 5 - DNS

Add a DNS A record for:

- `indexer.ors.example.com` -> VPS IP

---

## Verification

1. `curl https://indexer.ors.example.com/` - should return a response
2. Check systemd logs for scanner startup and block processing

---

## Updates / Redeployment

```bash
cd /opt/ors-indexer
git pull
yarn install
# If schema changed:
yarn db:migrate:prod
yarn db:generate
yarn build
sudo systemctl restart ors-indexer
```

---

## Critical File Paths

| File                                    | Purpose                              |
| --------------------------------------- | ------------------------------------ |
| `.env`                                  | RPC creds, DB path, port, token      |
| `prisma/schema.prisma`                  | DB schema                            |
| `data/prod.db`                          | SQLite database                      |
| `dist/index.js`                         | Compiled entry point                 |
| `/etc/systemd/system/ors-indexer.service` | Systemd unit                       |
