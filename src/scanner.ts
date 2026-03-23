import crypto from "node:crypto";
import * as tinysecp from "tiny-secp256k1";
import {
  parseORSPayload,
  parseV1Chunk,
  assembleV1Body,
  buildV1SigningBody,
  getUnsignedBytes,
  KIND_TEXT_NOTE,
  KIND_PROFILE_UPDATE,
  KIND_TEXT_REPLY,
  KIND_REPOST,
  KIND_QUOTE_REPOST,
  KIND_FOLLOW,
  PROPERTY_NAME,
  PROPERTY_AVATAR_URL,
  PROPERTY_BIO,
  PROPERTY_BANNER_URL,
  PROPERTY_BOT,
  PROPERTY_WEBSITE_URL,
  type OrsProfileUpdate,
  type OrsTextReply,
  type OrsRepost,
  type OrsQuoteRepost,
  type OrsFollow,
} from "./protocol.js";
import { prisma } from "./db.js";
import { rpc } from "./rpc.js";

const V1_CHUNK_WINDOW = 6;
const POLL_INTERVAL_MS = 5000;

function extractPayloadFromScript(hex: string): Buffer | null {
  const buf = Buffer.from(hex, "hex");
  if (buf.length < 2) return null;
  if (buf[0] !== 0x6a) return null;
  const pushOpcode = buf[1];
  if (pushOpcode >= 0x01 && pushOpcode <= 0x4b) return buf.subarray(2);
  if (pushOpcode === 0x4c) return buf.length < 3 ? null : buf.subarray(3);
  if (pushOpcode === 0x4d) return buf.length < 4 ? null : buf.subarray(4);
  return null;
}

async function getOrCreateScannerState(): Promise<number> {
  const startBlock = parseInt(process.env.START_BLOCK ?? "0", 10) || 0;
  const state = await prisma.scannerState.upsert({
    where: { id: 1 },
    create: { id: 1, lastBlock: Math.max(0, startBlock - 1) },
    update: {},
  });
  return state.lastBlock;
}

function verifyV0Sig(payload: Buffer, pubkey: string, sig: string): boolean {
  const unsignedBytes = getUnsignedBytes(payload);
  const msgHash = crypto.createHash("sha256").update(unsignedBytes).digest();
  return tinysecp.verifySchnorr(msgHash, Buffer.from(pubkey, "hex"), Buffer.from(sig, "hex"));
}

async function applyProfileUpdate(pubkey: string, propertyKind: number, content: string): Promise<void> {
  const data: Record<string, string | boolean> = {};
  if (propertyKind === PROPERTY_NAME) data.name = content;
  else if (propertyKind === PROPERTY_AVATAR_URL) data.avatarUrl = content;
  else if (propertyKind === PROPERTY_BIO) data.bio = content;
  else if (propertyKind === PROPERTY_BANNER_URL) data.bannerUrl = content;
  else if (propertyKind === PROPERTY_BOT) data.bot = content === "true";
  else if (propertyKind === PROPERTY_WEBSITE_URL) data.website = content;
  if (Object.keys(data).length === 0) return;
  await prisma.profile.upsert({
    where: { pubkey },
    create: { pubkey, ...data },
    update: data,
  });
}

async function applyFollow(followerPubkey: string, followeePubkey: string, txid: string, blockHeight: number, isFollow: boolean): Promise<void> {
  await prisma.follow.upsert({
    where: { followerPubkey_followeePubkey: { followerPubkey, followeePubkey } },
    create: { followerPubkey, followeePubkey, txid, blockHeight, isFollow },
    update: { isFollow, txid, blockHeight },
  });
}

async function storeOrsRecord(
  txid: string,
  kind: number,
  pubkey: string,
  sig: string,
  blockHeight: number,
  timestamp: number,
  data: string,
  opts: {
    content?: string;
    parentTxid?: string;
    targetPubkey?: string;
    isFollow?: boolean;
    propertyKind?: number;
  } = {},
): Promise<void> {
  await prisma.orsRecord.upsert({
    where: { txid },
    create: { txid, kind, pubkey, sig, data, blockHeight, timestamp, ...opts },
    update: { blockHeight, timestamp },
  });

  if (kind === KIND_PROFILE_UPDATE && opts.propertyKind !== undefined && opts.content !== undefined) {
    await applyProfileUpdate(pubkey, opts.propertyKind, opts.content);
  } else if (kind === KIND_FOLLOW && opts.targetPubkey !== undefined && opts.isFollow !== undefined) {
    await applyFollow(pubkey, opts.targetPubkey, txid, blockHeight, opts.isFollow);
  }
}

async function scanBlock(height: number): Promise<void> {
  const hash = await rpc.getBlockHash(height);
  const block = await rpc.getBlock(hash);

  await prisma.scannedBlock.upsert({
    where: { height },
    create: { height, hash },
    update: { hash },
  });

  for (let txIdx = 0; txIdx < block.tx.length; txIdx++) {
    const tx = block.tx[txIdx];
    for (let outIdx = 0; outIdx < tx.vout.length; outIdx++) {
      const vout = tx.vout[outIdx];
      if (!vout.scriptPubKey.asm.startsWith("OP_RETURN")) continue;

      const payload = extractPayloadFromScript(vout.scriptPubKey.hex);
      if (!payload) continue;

      // Store raw OP_RETURN output
      await prisma.indexedTransaction.upsert({
        where: { txid: tx.txid },
        create: {
          txid: tx.txid,
          blockHeight: height,
          blockHash: hash,
          txIndex: txIdx,
          outputIndex: outIdx,
          data: payload.toString("hex"),
          timestamp: block.time,
        },
        update: { blockHeight: height, blockHash: hash },
      });

      // v1 chunk
      if (payload.length >= 4 && payload[3] === 0x01) {
        const chunk = parseV1Chunk(payload);
        if (!chunk) continue;
        await prisma.pendingChunk.upsert({
          where: { txid: tx.txid },
          create: {
            txid: tx.txid,
            chunkNum: chunk.chunkNum,
            totalChunks: chunk.totalChunks ?? null,
            bodySlice: chunk.bodySlice.toString("hex"),
            blockHeight: height,
            timestamp: block.time,
          },
          update: { blockHeight: height, timestamp: block.time },
        });
        console.log(`[scanner] v1 chunk ${chunk.chunkNum} in block ${height}: ${tx.txid}`);
        continue;
      }

      // v0 parse
      const result = parseORSPayload(payload);
      if (!result.supported) continue;

      const { post } = result;
      if (!verifyV0Sig(payload, post.pubkey, post.sig)) {
        console.warn(`[scanner] Invalid sig in ${tx.txid}, skipping`);
        continue;
      }

      const rawData = payload.toString("hex");
      if (post.kind === KIND_TEXT_NOTE) {
        await storeOrsRecord(tx.txid, post.kind, post.pubkey, post.sig, height, block.time, rawData, { content: post.content });
        console.log(`[scanner] note in block ${height}: ${tx.txid}`);
      } else if (post.kind === KIND_TEXT_REPLY) {
        const r = post as OrsTextReply;
        await storeOrsRecord(tx.txid, r.kind, r.pubkey, r.sig, height, block.time, rawData, { content: r.content, parentTxid: r.parentTxid });
        console.log(`[scanner] reply in block ${height}: ${tx.txid}`);
      } else if (post.kind === KIND_REPOST) {
        const r = post as OrsRepost;
        await storeOrsRecord(tx.txid, r.kind, r.pubkey, r.sig, height, block.time, rawData, { parentTxid: r.referencedTxid });
        console.log(`[scanner] repost in block ${height}: ${tx.txid}`);
      } else if (post.kind === KIND_QUOTE_REPOST) {
        const r = post as OrsQuoteRepost;
        await storeOrsRecord(tx.txid, r.kind, r.pubkey, r.sig, height, block.time, rawData, { content: r.content, parentTxid: r.referencedTxid });
        console.log(`[scanner] quote-repost in block ${height}: ${tx.txid}`);
      } else if (post.kind === KIND_PROFILE_UPDATE) {
        const r = post as OrsProfileUpdate;
        await storeOrsRecord(tx.txid, r.kind, r.pubkey, r.sig, height, block.time, rawData, { content: r.content, propertyKind: r.propertyKind });
        console.log(`[scanner] profile update in block ${height}: ${post.pubkey.slice(0, 8)}… property=${r.propertyKind}`);
      } else if (post.kind === KIND_FOLLOW) {
        const r = post as OrsFollow;
        await storeOrsRecord(tx.txid, r.kind, r.pubkey, r.sig, height, block.time, rawData, { targetPubkey: r.targetPubkey, isFollow: r.isFollow });
        console.log(`[scanner] follow in block ${height}: ${r.pubkey.slice(0, 8)}… -> ${r.targetPubkey.slice(0, 8)}… isFollow=${r.isFollow}`);
      }
    }
  }

  await prisma.scannerState.upsert({
    where: { id: 1 },
    create: { id: 1, lastBlock: height },
    update: { lastBlock: height },
  });
}

function* cartesianProduct<T>(arrays: T[][]): Generator<T[]> {
  if (arrays.length === 0) { yield []; return; }
  const [first, ...rest] = arrays;
  for (const a of first) {
    for (const combo of cartesianProduct(rest)) {
      yield [a, ...combo];
    }
  }
}

async function storeV1OrsRecord(
  txid: string,
  pubkey: Buffer,
  sig: Buffer,
  kind: number,
  kindData: Buffer,
  blockHeight: number,
  timestamp: number,
  data: string,
): Promise<void> {
  const pubkeyHex = pubkey.toString("hex");
  const sigHex = sig.toString("hex");

  if (kind === KIND_TEXT_NOTE) {
    await storeOrsRecord(txid, kind, pubkeyHex, sigHex, blockHeight, timestamp, data, { content: kindData.toString("utf8") });
    console.log(`[scanner] v1 assembled note: ${txid}`);
  } else if (kind === KIND_TEXT_REPLY) {
    if (kindData.length < 32) return;
    await storeOrsRecord(txid, kind, pubkeyHex, sigHex, blockHeight, timestamp, data, {
      content: kindData.subarray(32).toString("utf8"),
      parentTxid: kindData.subarray(0, 32).toString("hex"),
    });
    console.log(`[scanner] v1 assembled reply: ${txid}`);
  } else if (kind === KIND_REPOST) {
    if (kindData.length < 32) return;
    await storeOrsRecord(txid, kind, pubkeyHex, sigHex, blockHeight, timestamp, data, { parentTxid: kindData.subarray(0, 32).toString("hex") });
    console.log(`[scanner] v1 assembled repost: ${txid}`);
  } else if (kind === KIND_QUOTE_REPOST) {
    if (kindData.length < 32) return;
    await storeOrsRecord(txid, kind, pubkeyHex, sigHex, blockHeight, timestamp, data, {
      content: kindData.subarray(32).toString("utf8"),
      parentTxid: kindData.subarray(0, 32).toString("hex"),
    });
    console.log(`[scanner] v1 assembled quote-repost: ${txid}`);
  } else if (kind === KIND_PROFILE_UPDATE) {
    if (kindData.length < 1) return;
    const propertyKind = kindData[0];
    const content = kindData.subarray(1).toString("utf8");
    await storeOrsRecord(txid, kind, pubkeyHex, sigHex, blockHeight, timestamp, data, { content, propertyKind });
    console.log(`[scanner] v1 assembled profile update: ${pubkeyHex.slice(0, 8)}… property=${propertyKind}`);
  } else if (kind === KIND_FOLLOW) {
    if (kindData.length < 33) return;
    await storeOrsRecord(txid, kind, pubkeyHex, sigHex, blockHeight, timestamp, data, {
      targetPubkey: kindData.subarray(0, 32).toString("hex"),
      isFollow: kindData[32] === 0x01,
    });
    console.log(`[scanner] v1 assembled follow: ${pubkeyHex.slice(0, 8)}…`);
  }
}

async function assembleV1Chunks(currentHeight: number): Promise<void> {
  const minHeight = currentHeight - V1_CHUNK_WINDOW + 1;
  const windowChunks = await prisma.pendingChunk.findMany({
    where: { blockHeight: { gte: minHeight } },
  });

  const chunk0s = windowChunks.filter((c) => c.chunkNum === 0 && c.totalChunks !== null);

  for (const c0 of chunk0s) {
    const totalChunks = c0.totalChunks!;
    const candidates: Buffer[][] = [[Buffer.from(c0.bodySlice, "hex")]];
    for (let n = 1; n < totalChunks; n++) {
      const cands = windowChunks.filter((c) => c.chunkNum === n).map((c) => Buffer.from(c.bodySlice, "hex"));
      if (cands.length === 0) break;
      candidates.push(cands);
    }
    if (candidates.length !== totalChunks) continue;

    for (const combo of cartesianProduct(candidates)) {
      const assembled = assembleV1Body(combo);
      if (!assembled) continue;

      const signingBody = buildV1SigningBody(assembled.pubkey, assembled.kind, assembled.kindData);
      const msgHash = crypto.createHash("sha256").update(signingBody).digest();
      if (!tinysecp.verifySchnorr(msgHash, assembled.pubkey, assembled.sig)) continue;

      const assembledTxids = [c0.txid];
      for (let n = 1; n < totalChunks; n++) {
        const sliceHex = combo[n].toString("hex");
        const matched = windowChunks.find((c) => c.chunkNum === n && c.bodySlice === sliceHex);
        if (matched) assembledTxids.push(matched.txid);
      }

      const rawRows = await prisma.indexedTransaction.findMany({
        where: { txid: { in: assembledTxids } },
        select: { txid: true, data: true },
      });
      const rawData = assembledTxids.map((id) => rawRows.find((r) => r.txid === id)?.data ?? "").join("");

      await storeV1OrsRecord(c0.txid, assembled.pubkey, assembled.sig, assembled.kind, assembled.kindData, c0.blockHeight, c0.timestamp, rawData);

      await prisma.pendingChunk.deleteMany({ where: { txid: { in: assembledTxids } } });
      break;
    }
  }

  await prisma.pendingChunk.deleteMany({ where: { blockHeight: { lt: minHeight } } });
}

async function rebuildDerivedState(): Promise<void> {
  // Rebuild Profile and Follow from remaining OrsRecord data
  await prisma.profile.deleteMany();
  await prisma.follow.deleteMany();

  const records = await prisma.orsRecord.findMany({
    where: { kind: { in: [KIND_PROFILE_UPDATE, KIND_FOLLOW] } },
    orderBy: { blockHeight: "asc" },
  });

  for (const rec of records) {
    if (rec.kind === KIND_PROFILE_UPDATE && rec.propertyKind !== null && rec.content !== null) {
      await applyProfileUpdate(rec.pubkey, rec.propertyKind, rec.content);
    } else if (rec.kind === KIND_FOLLOW && rec.targetPubkey !== null && rec.isFollow !== null) {
      await applyFollow(rec.pubkey, rec.targetPubkey, rec.txid, rec.blockHeight, rec.isFollow);
    }
  }
}

async function checkReorg(): Promise<void> {
  const lastBlock = await getOrCreateScannerState();
  if (lastBlock === 0) return;

  const checkFrom = Math.max(1, lastBlock - 5);
  const stored = await prisma.scannedBlock.findMany({
    where: { height: { gte: checkFrom } },
    orderBy: { height: "asc" },
  });

  for (const record of stored) {
    const currentHash = await rpc.getBlockHash(record.height);
    if (currentHash !== record.hash) {
      console.log(`[scanner] Re-org detected at height ${record.height}`);
      await prisma.scannedBlock.deleteMany({ where: { height: { gte: record.height } } });
      await prisma.indexedTransaction.deleteMany({ where: { blockHeight: { gte: record.height } } });
      await prisma.orsRecord.deleteMany({ where: { blockHeight: { gte: record.height } } });
      await prisma.pendingChunk.deleteMany({ where: { blockHeight: { gte: record.height } } });
      await prisma.scannerState.upsert({
        where: { id: 1 },
        update: { lastBlock: record.height - 1 },
        create: { id: 1, lastBlock: record.height - 1 },
      });
      await rebuildDerivedState();
      break;
    }
  }
}

async function runScanCycle(): Promise<void> {
  try {
    await checkReorg();
    const lastBlock = await getOrCreateScannerState();
    const tip = await rpc.getBlockCount();
    for (let height = lastBlock + 1; height <= tip; height++) {
      await scanBlock(height);
      await assembleV1Chunks(height);
    }
  } catch (err) {
    console.error("[scanner] Error during scan cycle:", err);
  }
}

export async function startScanner(): Promise<void> {
  console.log("[scanner] Starting blockchain scanner (5s polling)");
  while (true) {
    await runScanCycle();
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
}

export async function rescanFrom(fromBlock: number): Promise<void> {
  await prisma.scannedBlock.deleteMany({ where: { height: { gte: fromBlock } } });
  await prisma.indexedTransaction.deleteMany({ where: { blockHeight: { gte: fromBlock } } });
  await prisma.orsRecord.deleteMany({ where: { blockHeight: { gte: fromBlock } } });
  await prisma.pendingChunk.deleteMany({ where: { blockHeight: { gte: fromBlock } } });
  await prisma.scannerState.upsert({
    where: { id: 1 },
    create: { id: 1, lastBlock: Math.max(0, fromBlock - 1) },
    update: { lastBlock: Math.max(0, fromBlock - 1) },
  });
  await rebuildDerivedState();
  console.log(`[scanner] Rescan requested from block ${fromBlock}`);
}
