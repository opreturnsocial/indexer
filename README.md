# ORS Indexer

A standalone indexer for the [ORS protocol](https://github.com/orsprotocol/ors). Scans bitcoin blocks, extracts and verifies OP_RETURN-based ORS records, and exposes them via a simple HTTP API.

Apps can query this indexer instead of connecting directly to a bitcoin Core node.

Each indexer instance serves a single network. Run separate instances for mainnet and testnet4.

## Setup

```bash
cp .env.example .env
# Edit .env with your bitcoin Core RPC credentials

yarn install
yarn db:migrate
yarn dev
```

## Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `DATABASE_URL` | `file:./dev.db` | SQLite database path |
| `BITCOIN_RPC_HOST` | `127.0.0.1` | bitcoin Core RPC host |
| `BITCOIN_RPC_PORT` | `8332` | bitcoin Core RPC port (8332 mainnet, 48332 testnet4) |
| `BITCOIN_RPC_USER` | `bitcoinrpc` | RPC username |
| `BITCOIN_RPC_PASS` | | RPC password |
| `START_BLOCK` | `0` | Block height to begin scanning from. Use `940000` to start from the first mainnet ORS transaction. |
| `PORT` | `3010` | HTTP server port |

## API

All paginated endpoints use **cursor-based pagination** on the `id` field. Save the smallest `id` from a page and pass it as `before` to fetch the next page. New incoming blocks never affect historical pages.

### `GET /health`

```json
{ "ok": true }
```

### `GET /status`

```json
{ "lastScannedBlock": 894210 }
```

### `GET /transactions`

Raw OP_RETURN outputs. Includes all OP_RETURN outputs, not just valid ORS records.

Query params:
- `limit` - max results (default 50, max 200)
- `before` - return records with `id < before` (pagination cursor)

```json
{
  "transactions": [
    {
      "id": 42,
      "txid": "abc123...",
      "blockHeight": 894210,
      "blockHash": "000000...",
      "txIndex": 3,
      "outputIndex": 0,
      "data": "4f525300...",
      "timestamp": 1710000000
    }
  ]
}
```

### `GET /transactions/:txid`

Single raw transaction by txid.

### `GET /records`

Decoded and signature-verified ORS records.

Query params:
- `limit` - max results (default 50, max 200)
- `before` - pagination cursor
- `kind` - filter by ORS kind (1=note, 2=profile, 3=reply, 4=repost, 5=quote-repost, 6=follow)
- `pubkey` - filter by author pubkey (64-char hex)

```json
{
  "records": [
    {
      "id": 17,
      "txid": "abc123...",
      "kind": 1,
      "pubkey": "deadbeef...",
      "sig": "cafebabe...",
      "content": "Hello from bitcoin",
      "parentTxid": null,
      "targetPubkey": null,
      "isFollow": null,
      "propertyKind": null,
      "blockHeight": 894210,
      "timestamp": 1710000000
    }
  ]
}
```

### `GET /records/:txid`

Single ORS record by txid.

### `GET /records/:txid/replies`

Replies to a given txid, sorted oldest-first. Supports `limit` and `before` pagination.

### `GET /profiles/:pubkey`

Latest known profile for a pubkey, derived from kind-2 records.

```json
{
  "pubkey": "deadbeef...",
  "name": "Alice",
  "bio": "bitcoin enthusiast",
  "avatarUrl": "https://...",
  "bannerUrl": null,
  "website": null,
  "bot": false
}
```

### `GET /follows?pubkey=<hex>`

Active follows for a pubkey (where `isFollow=true`).

```json
{
  "follows": [
    {
      "followerPubkey": "aaa...",
      "followeePubkey": "bbb...",
      "txid": "abc...",
      "blockHeight": 894100,
      "isFollow": true
    }
  ]
}
```

### `POST /rescan` (internal)

Trigger a rescan from a given block height. Deletes all indexed data at or above that height and re-scans.

Requires `X-Internal-Token: <INTERNAL_TOKEN>` header.

```json
{ "from_block": 894000 }
```

## ORS kinds

| Kind | Value | Description |
|------|-------|-------------|
| Text note | `0x01` | Plain text post |
| Profile update | `0x02` | Name, bio, avatar, banner, website, bot flag |
| Text reply | `0x03` | Reply referencing a parent txid |
| Repost | `0x04` | Pure repost of an existing record |
| Quote repost | `0x05` | Repost with added commentary |
| Follow | `0x06` | Follow or unfollow a pubkey |

## Pagination example

```js
// Fetch newest records, then page backwards
let cursor;

async function fetchPage() {
  const url = cursor
    ? `/records?limit=50&before=${cursor}`
    : `/records?limit=50`;
  const { records } = await fetch(url).then(r => r.json());
  if (records.length > 0) {
    cursor = records[records.length - 1].id; // smallest id = next cursor
  }
  return records;
}
```
