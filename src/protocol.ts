// Inlined from opreturn.social/packages/protocol - kept standalone, no external dep.

export const ORS_MAGIC = Buffer.from([0x4f, 0x52, 0x53]); // "ORS"
export const ORS_VERSION = 0x00;
export const ORS_VERSION_V1 = 0x01;

export const KIND_TEXT_NOTE = 0x01;
export const KIND_PROFILE_UPDATE = 0x02;
export const KIND_TEXT_REPLY = 0x03;
export const KIND_REPOST = 0x04;
export const KIND_QUOTE_REPOST = 0x05;
export const KIND_FOLLOW = 0x06;

// Header layout: magic(3) + version(1) + pubkey(32) + sig(64) + kind(1) = 101 bytes
export const PUBKEY_OFFSET = 4;
export const SIG_OFFSET = 36;
export const KIND_OFFSET = 100;
export const DATA_OFFSET = 101;
export const PROPERTY_KIND_OFFSET = 101;
export const PROFILE_VALUE_OFFSET = 102;
export const PUBKEY_BYTES = 32;
export const SIG_BYTES = 64;
export const PARENT_TXID_OFFSET = 101;
export const REPLY_CONTENT_OFFSET = 133;

export const PROPERTY_NAME = 0x00;
export const PROPERTY_AVATAR_URL = 0x01;
export const PROPERTY_BIO = 0x02;
export const PROPERTY_BANNER_URL = 0x03;
export const PROPERTY_BOT = 0x04;
export const PROPERTY_WEBSITE_URL = 0x05;

export interface OrsPost {
  kind: number;
  content: string;
  pubkey: string;
  sig: string;
}

export interface OrsProfileUpdate {
  kind: 0x02;
  propertyKind: number;
  content: string;
  pubkey: string;
  sig: string;
}

export interface OrsTextReply {
  kind: 0x03;
  parentTxid: string;
  content: string;
  pubkey: string;
  sig: string;
}

export interface OrsRepost {
  kind: 0x04;
  referencedTxid: string;
  pubkey: string;
  sig: string;
}

export interface OrsQuoteRepost {
  kind: 0x05;
  referencedTxid: string;
  content: string;
  pubkey: string;
  sig: string;
}

export interface OrsFollow {
  kind: 0x06;
  targetPubkey: string;
  isFollow: boolean;
  pubkey: string;
  sig: string;
}

export type ParsedOrsResult =
  | { supported: true; post: OrsPost | OrsProfileUpdate | OrsTextReply | OrsRepost | OrsQuoteRepost | OrsFollow }
  | { supported: false; reason: string };

export function parseORSPayload(data: Buffer): ParsedOrsResult {
  if (data.length < DATA_OFFSET + 1) return { supported: false, reason: "Too short" };
  if (!data.subarray(0, 3).equals(ORS_MAGIC)) return { supported: false, reason: "Wrong magic" };
  const version = data[3];
  if (version !== ORS_VERSION) return { supported: false, reason: `Unsupported version: ${version}` };

  const pubkey = data.subarray(PUBKEY_OFFSET, SIG_OFFSET).toString("hex");
  const sig = data.subarray(SIG_OFFSET, KIND_OFFSET).toString("hex");
  const kind = data[KIND_OFFSET];

  if (kind === KIND_PROFILE_UPDATE) {
    if (data.length < PROFILE_VALUE_OFFSET) return { supported: false, reason: "Too short for PROFILE_UPDATE" };
    const propertyKind = data[PROPERTY_KIND_OFFSET];
    const valueBytes = data.subarray(PROFILE_VALUE_OFFSET);
    const content = propertyKind === PROPERTY_BOT
      ? (valueBytes[0] === 0x01 ? "true" : "false")
      : valueBytes.toString("utf8");
    return { supported: true, post: { kind: 0x02, propertyKind, content, pubkey, sig } };
  }

  if (kind === KIND_TEXT_REPLY) {
    if (data.length < REPLY_CONTENT_OFFSET + 1) return { supported: false, reason: "Too short for TEXT_REPLY" };
    const parentTxid = data.subarray(PARENT_TXID_OFFSET, REPLY_CONTENT_OFFSET).toString("hex");
    const content = data.subarray(REPLY_CONTENT_OFFSET).toString("utf8");
    return { supported: true, post: { kind: 0x03, parentTxid, content, pubkey, sig } };
  }

  if (kind === KIND_REPOST) {
    if (data.length < REPLY_CONTENT_OFFSET) return { supported: false, reason: "Too short for REPOST" };
    const referencedTxid = data.subarray(PARENT_TXID_OFFSET, REPLY_CONTENT_OFFSET).toString("hex");
    return { supported: true, post: { kind: 0x04, referencedTxid, pubkey, sig } };
  }

  if (kind === KIND_QUOTE_REPOST) {
    if (data.length < REPLY_CONTENT_OFFSET + 1) return { supported: false, reason: "Too short for QUOTE_REPOST" };
    const referencedTxid = data.subarray(PARENT_TXID_OFFSET, REPLY_CONTENT_OFFSET).toString("hex");
    const content = data.subarray(REPLY_CONTENT_OFFSET).toString("utf8");
    return { supported: true, post: { kind: 0x05, referencedTxid, content, pubkey, sig } };
  }

  if (kind === KIND_FOLLOW) {
    if (data.length < DATA_OFFSET + PUBKEY_BYTES + 1) return { supported: false, reason: "Too short for FOLLOW" };
    const targetPubkey = data.subarray(DATA_OFFSET, DATA_OFFSET + PUBKEY_BYTES).toString("hex");
    const isFollow = data[DATA_OFFSET + PUBKEY_BYTES] === 0x01;
    return { supported: true, post: { kind: 0x06, targetPubkey, isFollow, pubkey, sig } };
  }

  const content = data.subarray(DATA_OFFSET).toString("utf8");
  return { supported: true, post: { kind, content, pubkey, sig } };
}

export interface V1ChunkInfo {
  chunkNum: number;
  totalChunks?: number;
  bodySlice: Buffer;
}

export function parseV1Chunk(data: Buffer): V1ChunkInfo | null {
  if (data.length < 5) return null;
  if (!data.subarray(0, 3).equals(ORS_MAGIC)) return null;
  if (data[3] !== ORS_VERSION_V1) return null;
  const chunkNum = data[4];
  if (chunkNum === 0) {
    if (data.length < 7) return null;
    const totalChunks = data[5];
    if (totalChunks < 2) return null;
    return { chunkNum: 0, totalChunks, bodySlice: Buffer.from(data.subarray(6)) };
  }
  if (data.length < 6) return null;
  return { chunkNum, bodySlice: Buffer.from(data.subarray(5)) };
}

export function assembleV1Body(slices: Buffer[]): { pubkey: Buffer; sig: Buffer; kind: number; kindData: Buffer } | null {
  const body = Buffer.concat(slices);
  if (body.length < PUBKEY_BYTES + SIG_BYTES + 1) return null;
  return {
    pubkey: Buffer.from(body.subarray(0, PUBKEY_BYTES)),
    sig: Buffer.from(body.subarray(PUBKEY_BYTES, PUBKEY_BYTES + SIG_BYTES)),
    kind: body[PUBKEY_BYTES + SIG_BYTES],
    kindData: Buffer.from(body.subarray(PUBKEY_BYTES + SIG_BYTES + 1)),
  };
}

// For v1: pubkey(32) + kind(1) + kindData - this is what gets sha256-hashed and signed.
export function buildV1SigningBody(pubkey: Buffer, kind: number, kindData: Buffer): Buffer {
  const buf = Buffer.alloc(PUBKEY_BYTES + 1 + kindData.length);
  pubkey.copy(buf, 0);
  buf[PUBKEY_BYTES] = kind;
  kindData.copy(buf, PUBKEY_BYTES + 1);
  return buf;
}

// For v0: magic(3) + version(1) + pubkey(32) + kind(1) + data - skipping the sig bytes.
export function getUnsignedBytes(fullPayload: Buffer): Buffer {
  return Buffer.concat([
    fullPayload.subarray(0, SIG_OFFSET),
    fullPayload.subarray(KIND_OFFSET),
  ]);
}
