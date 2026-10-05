export function isAssetRedisConfigured() {
  return Boolean(process.env.ASSET_REDIS_REST_URL && process.env.ASSET_REDIS_REST_TOKEN);
}

export async function assetRedisCommand<T>(command: unknown[]): Promise<T> {
  const redisUrl = process.env.ASSET_REDIS_REST_URL;
  const redisToken = process.env.ASSET_REDIS_REST_TOKEN;
  if (!redisUrl || !redisToken) throw new Error('Asset Redis REST URL and token are required.');
  const endpoint = new URL(redisUrl);
  if (endpoint.protocol !== 'https:') throw new Error('Asset Redis REST endpoint must use HTTPS.');
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { Authorization: `Bearer ${redisToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(command),
    signal: AbortSignal.timeout(5000),
    cache: 'no-store',
  });
  if (!response.ok) throw new Error(`Asset Redis command failed with HTTP ${response.status}.`);
  const payload = await response.json() as { result?: T; error?: string };
  if (payload.error) throw new Error('Asset Redis command was rejected.');
  return payload.result as T;
}
