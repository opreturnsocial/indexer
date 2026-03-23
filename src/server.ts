import express, { type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import { prisma } from "./db.js";
import { rescanFrom } from "./scanner.js";

const MAX_LIMIT = 200;
const DEFAULT_LIMIT = 50;
const INTERNAL_TOKEN = process.env.INTERNAL_TOKEN ?? "";

function requireInternalToken(req: Request, res: Response, next: NextFunction) {
  if (!INTERNAL_TOKEN || req.headers["x-internal-token"] !== INTERNAL_TOKEN) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
}

function parseLimit(raw: unknown): number {
  return Math.min(Number(raw ?? DEFAULT_LIMIT), MAX_LIMIT);
}

function parseBefore(raw: unknown): number | undefined {
  const n = Number(raw);
  return isNaN(n) || raw === undefined ? undefined : n;
}

export function createServer() {
  const app = express();
  app.use(cors());
  app.use(express.json());

  app.get("/health", (_req, res) => {
    res.json({ ok: true });
  });

  app.get("/status", async (_req, res) => {
    const state = await prisma.scannerState.findUnique({ where: { id: 1 } });
    res.json({ lastScannedBlock: state?.lastBlock ?? 0 });
  });

  // Raw OP_RETURN outputs - cursor-based pagination on id DESC
  app.get("/transactions", async (req, res) => {
    const limit = parseLimit(req.query.limit);
    const before = parseBefore(req.query.before);

    const rows = await prisma.indexedTransaction.findMany({
      where: before !== undefined ? { id: { lt: before } } : undefined,
      orderBy: { id: "desc" },
      take: limit,
    });

    res.json({ transactions: rows });
  });

  app.get("/transactions/:txid", async (req, res) => {
    const row = await prisma.indexedTransaction.findUnique({ where: { txid: req.params.txid } });
    if (!row) { res.status(404).json({ error: "Not found" }); return; }
    res.json(row);
  });

  // Parsed ORS records - cursor-based pagination on id DESC
  app.get("/records", async (req, res) => {
    const limit = parseLimit(req.query.limit);
    const before = parseBefore(req.query.before);
    const kind = req.query.kind !== undefined ? Number(req.query.kind) : undefined;
    const pubkey = req.query.pubkey as string | undefined;

    const where: Record<string, unknown> = {};
    if (before !== undefined) where.id = { lt: before };
    if (kind !== undefined) where.kind = kind;
    if (pubkey) where.pubkey = pubkey;

    const rows = await prisma.orsRecord.findMany({
      where,
      orderBy: { id: "desc" },
      take: limit,
    });

    res.json({ records: rows });
  });

  app.get("/records/:txid", async (req, res) => {
    const row = await prisma.orsRecord.findUnique({ where: { txid: req.params.txid } });
    if (!row) { res.status(404).json({ error: "Not found" }); return; }
    res.json(row);
  });

  // Replies to a given txid - cursor-based pagination on id DESC
  app.get("/records/:txid/replies", async (req, res) => {
    const limit = parseLimit(req.query.limit);
    const before = parseBefore(req.query.before);

    const rows = await prisma.orsRecord.findMany({
      where: {
        parentTxid: req.params.txid,
        kind: 0x03,
        ...(before !== undefined ? { id: { lt: before } } : {}),
      },
      orderBy: { id: "asc" },
      take: limit,
    });

    res.json({ records: rows });
  });

  // Latest known profile for a pubkey
  app.get("/profiles/:pubkey", async (req, res) => {
    const profile = await prisma.profile.findUnique({ where: { pubkey: req.params.pubkey } });
    if (!profile) { res.status(404).json({ error: "Not found" }); return; }
    res.json(profile);
  });

  // Who a pubkey follows (active follows only)
  app.get("/follows", async (req, res) => {
    const pubkey = req.query.pubkey as string | undefined;
    if (!pubkey) { res.status(400).json({ error: "pubkey query param required" }); return; }

    const rows = await prisma.follow.findMany({
      where: { followerPubkey: pubkey, isFollow: true },
    });

    res.json({ follows: rows });
  });

  // Internal: trigger rescan from a given block height
  app.post("/rescan", requireInternalToken, async (req, res) => {
    const { from_block } = req.body as { from_block: number };
    if (typeof from_block !== "number") {
      res.status(400).json({ error: "from_block must be a number" });
      return;
    }
    await rescanFrom(from_block);
    res.json({ ok: true });
  });

  return app;
}
