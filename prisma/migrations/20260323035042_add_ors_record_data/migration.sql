/*
  Warnings:

  - Added the required column `data` to the `OrsRecord` table without a default value. This is not possible if the table is not empty.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_OrsRecord" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "txid" TEXT NOT NULL,
    "kind" INTEGER NOT NULL,
    "pubkey" TEXT NOT NULL,
    "sig" TEXT NOT NULL,
    "data" TEXT NOT NULL,
    "content" TEXT,
    "parentTxid" TEXT,
    "targetPubkey" TEXT,
    "isFollow" BOOLEAN,
    "propertyKind" INTEGER,
    "blockHeight" INTEGER NOT NULL,
    "timestamp" INTEGER NOT NULL
);
INSERT INTO "new_OrsRecord" ("blockHeight", "content", "id", "isFollow", "kind", "parentTxid", "propertyKind", "pubkey", "sig", "targetPubkey", "timestamp", "txid") SELECT "blockHeight", "content", "id", "isFollow", "kind", "parentTxid", "propertyKind", "pubkey", "sig", "targetPubkey", "timestamp", "txid" FROM "OrsRecord";
DROP TABLE "OrsRecord";
ALTER TABLE "new_OrsRecord" RENAME TO "OrsRecord";
CREATE UNIQUE INDEX "OrsRecord_txid_key" ON "OrsRecord"("txid");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
