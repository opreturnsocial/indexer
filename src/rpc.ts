export interface BlockTx {
  txid: string;
  vout: Array<{
    scriptPubKey: {
      asm: string;
      hex: string;
    };
  }>;
}

export interface Block {
  hash: string;
  height: number;
  time: number;
  tx: BlockTx[];
}

function makeRpcClient(config: { host: string; port: string; user: string; pass: string }) {
  const { host, port, user, pass } = config;
  const url = `http://${host}:${port}/`;
  let reqId = 0;

  async function rpcCall<T>(method: string, params: unknown[] = []): Promise<T> {
    const id = ++reqId;
    const body = JSON.stringify({ jsonrpc: "1.0", id, method, params });
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Basic " + Buffer.from(`${user}:${pass}`).toString("base64"),
      },
      body,
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`RPC HTTP error ${res.status}: ${text}`);
    }
    const json = (await res.json()) as { result: T; error: { message: string } | null };
    if (json.error) throw new Error(`RPC error: ${json.error.message}`);
    return json.result;
  }

  return {
    getBlockCount: () => rpcCall<number>("getblockcount"),
    getBlockHash: (height: number) => rpcCall<string>("getblockhash", [height]),
    getBlock: (hash: string) => rpcCall<Block>("getblock", [hash, 2]),
  };
}

export type RpcClient = ReturnType<typeof makeRpcClient>;

export const rpc = makeRpcClient({
  host: process.env.BITCOIN_RPC_HOST ?? "127.0.0.1",
  port: process.env.BITCOIN_RPC_PORT ?? "8332",
  user: process.env.BITCOIN_RPC_USER ?? "bitcoinrpc",
  pass: process.env.BITCOIN_RPC_PASS ?? "",
});
