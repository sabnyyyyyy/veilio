export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CACHE_HEADERS = { 'Cache-Control': 'no-store, max-age=0' };

export function getSolanaDevnetEndpoints(): string[] {
  const endpoints: string[] = [];
  const add = (url?: string) => {
    if (url && typeof url === 'string') {
      const trimmed = url.trim();
      if (trimmed && !endpoints.includes(trimmed)) endpoints.push(trimmed);
    }
  };
  add(process.env.SOLANA_DEVNET_RPC);
  add(process.env.NEXT_PUBLIC_SOLANA_RPC);
  add(process.env.NEXT_PUBLIC_SOLANA_DEVNET_RPC);
  add('https://api.devnet.solana.com');
  return endpoints;
}

export async function GET() {
  const endpoints = getSolanaDevnetEndpoints();
  let lastError = 'No Solana endpoints configured';

  for (const endpoint of endpoints) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6_000);

    try {
      const t0 = Date.now();
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'getSlot',
          params: [{ commitment: 'finalized' }],
        }),
        cache: 'no-store',
        signal: controller.signal,
      });

      if (!response.ok) {
        lastError = `HTTP ${response.status} from ${endpoint}`;
        continue;
      }

      const payload = (await response.json()) as {
        result?: unknown;
        error?: { message?: string };
      };

      if (payload.error) {
        lastError = payload.error.message || `RPC error from ${endpoint}`;
        // Fallback: test getHealth on this endpoint
        const healthRes = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'getHealth' }),
          cache: 'no-store',
          signal: controller.signal,
        });
        if (healthRes.ok) {
          const healthPayload = (await healthRes.json()) as { result?: string };
          if (healthPayload.result === 'ok') {
            return Response.json(
              {
                ok: true,
                slot: 'synced',
                endpoint,
                cluster: 'devnet',
                latencyMs: Date.now() - t0,
              },
              { headers: CACHE_HEADERS }
            );
          }
        }
        continue;
      }

      if (typeof payload.result !== 'number' || !Number.isSafeInteger(payload.result)) {
        lastError = `Invalid slot format from ${endpoint}`;
        continue;
      }

      return Response.json(
        {
          ok: true,
          slot: String(payload.result),
          endpoint,
          cluster: 'devnet',
          latencyMs: Date.now() - t0,
        },
        { headers: CACHE_HEADERS }
      );
    } catch (err: any) {
      lastError = err?.name === 'AbortError' ? `Timeout contacting ${endpoint}` : err?.message || `Error contacting ${endpoint}`;
    } finally {
      clearTimeout(timeout);
    }
  }

  return Response.json(
    {
      ok: false,
      error: 'Solana Devnet RPC unavailable',
      details: lastError,
      endpointsTried: endpoints,
    },
    { status: 503, headers: CACHE_HEADERS }
  );
}
