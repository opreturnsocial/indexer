-- CreateTable
CREATE TABLE "IndexedTransaction" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "txid" TEXT NOT NULL,
    "blockHeight" INTEGER NOT NULL,
    "blockHash" TEXT NOT NULL,
    "txIndex" INTEGER NOT NULL,
    "outputIndex" INTEGER NOT NULL,
    "data" TEXT NOT NULL,
    "timestamp" INTEGER NOT NULL
);

-- CreateTable
CREATE TABLE "OrsRecord" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "txid" TEXT NOT NULL,
    "kind" INTEGER NOT NULL,
    "pubkey" TEXT NOT NULL,
    "sig" TEXT NOT NULL,
    "content" TEXT,
    "parentTxid" TEXT,
    "targetPubkey" TEXT,
    "isFollow" BOOLEAN,
    "propertyKind" INTEGER,
    "blockHeight" INTEGER NOT NULL,
    "timestamp" INTEGER NOT NULL
);

-- CreateTable
CREATE TABLE "Profile" (
    "pubkey" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT,
    "bio" TEXT,
    "avatarUrl" TEXT,
    "bannerUrl" TEXT,
    "website" TEXT,
    "bot" BOOLEAN
);

-- CreateTable
CREATE TABLE "Follow" (
    "followerPubkey" TEXT NOT NULL,
    "followeePubkey" TEXT NOT NULL,
    "txid" TEXT NOT NULL,
    "blockHeight" INTEGER NOT NULL,
    "isFollow" BOOLEAN NOT NULL,

    PRIMARY KEY ("followerPubkey", "followeePubkey")
);

-- CreateTable
CREATE TABLE "ScannedBlock" (
    "height" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "hash" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "PendingChunk" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "txid" TEXT NOT NULL,
    "chunkNum" INTEGER NOT NULL,
    "totalChunks" INTEGER,
    "bodySlice" TEXT NOT NULL,
    "blockHeight" INTEGER NOT NULL,
    "timestamp" INTEGER NOT NULL
);

-- CreateTable
CREATE TABLE "ScannerState" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT DEFAULT 1,
    "lastBlock" INTEGER NOT NULL DEFAULT 0
);

-- CreateIndex
CREATE UNIQUE INDEX "IndexedTransaction_txid_key" ON "IndexedTransaction"("txid");

-- CreateIndex
CREATE UNIQUE INDEX "OrsRecord_txid_key" ON "OrsRecord"("txid");

-- CreateIndex
CREATE UNIQUE INDEX "PendingChunk_txid_key" ON "PendingChunk"("txid");
