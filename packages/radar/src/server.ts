import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { isAddress } from 'viem';
import { getCached, setCached, getRecent, cacheSize } from './cache.js';
import { publicClient } from './client.js';
import { CHAIN_ID, LAUNCHER_ADDRESS, PORT, RPC_URL } from './config.js';
import { scoreToken } from './scorer.js';

function json(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  const path = url.pathname;

  try {
    // POST /score { "tokenAddress": "0x…" }
    if (req.method === 'POST' && path === '/score') {
      const raw = await readBody(req);
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        json(res, 400, { error: 'invalid JSON body' });
        return;
      }
      const tokenAddress =
        typeof parsed === 'object' && parsed !== null
          ? (parsed as { tokenAddress?: unknown }).tokenAddress
          : undefined;
      if (typeof tokenAddress !== 'string' || !isAddress(tokenAddress)) {
        json(res, 400, { error: 'body must be { "tokenAddress": "0x…" }' });
        return;
      }

      const hit = getCached(tokenAddress);
      if (hit) {
        json(res, 200, hit);
        return;
      }
      const result = await scoreToken(tokenAddress);
      setCached(result);
      json(res, 200, result);
      return;
    }

    // GET /score/0x… — cached read only
    if (req.method === 'GET' && path.startsWith('/score/')) {
      const address = path.slice('/score/'.length);
      if (!isAddress(address)) {
        json(res, 400, { error: 'invalid address' });
        return;
      }
      const hit = getCached(address);
      if (!hit) {
        json(res, 404, { error: 'not cached — POST /score first' });
        return;
      }
      json(res, 200, hit);
      return;
    }

    // GET /recent — last 50 scored tokens, newest first
    if (req.method === 'GET' && path === '/recent') {
      json(res, 200, { recent: getRecent() });
      return;
    }

    // GET /health — RPC latency + chain sanity
    if (req.method === 'GET' && path === '/health') {
      const t0 = Date.now();
      let chainId: number | null = null;
      let rpcOk = false;
      try {
        chainId = await publicClient.getChainId();
        rpcOk = chainId === CHAIN_ID;
      } catch {
        rpcOk = false;
      }
      json(res, 200, {
        ok: rpcOk,
        chainId,
        expectedChainId: CHAIN_ID,
        rpcUrl: RPC_URL,
        rpcLatencyMs: Date.now() - t0,
        launcher: LAUNCHER_ADDRESS,
        cacheEntries: cacheSize(),
      });
      return;
    }

    json(res, 404, { error: 'not found' });
  } catch (err) {
    json(res, 500, {
      error: err instanceof Error ? err.message : String(err),
    });
  }
});

server.listen(PORT, () => {
  console.log(`rug-radar listening on :${PORT} (chain ${CHAIN_ID})`);
});
