import { createHash } from 'node:crypto';
import { assetRedisCommand, isAssetRedisConfigured } from './redisRest';

const WINDOW_MS = 60 * 60 * 1000;
const MAX_UPLOADS_PER_WALLET_PER_WINDOW = 12;
const attempts = new Map<string, number[]>();

const SLIDING_WINDOW_SCRIPT = [
  "local now = tonumber(ARGV[1])",
  "local window = tonumber(ARGV[2])",
  "local limit = tonumber(ARGV[3])",
  "redis.call('ZREMRANGEBYSCORE', KEYS[1], 0, now - window)",
  "local count = redis.call('ZCARD', KEYS[1])",
  "if count >= limit then return 0 end",
  "redis.call('ZADD', KEYS[1], now, ARGV[4])",
  "redis.call('PEXPIRE', KEYS[1], window)",
  "return 1",
].join('\n');

/** Shared Redis limiter in production; process-local backstop for local development/tests. */
export async function allowAssetUpload(address: string, now = Date.now(), nonce = `${now}`) {
  const normalizedAddress = address.toLowerCase();
  if (isAssetRedisConfigured()) {
    const walletKey = createHash('sha256').update(normalizedAddress).digest('hex');
    const result = await assetRedisCommand<number>([
      'EVAL', SLIDING_WINDOW_SCRIPT, '1', `veilio:asset-upload:${walletKey}`,
      String(now), String(WINDOW_MS), String(MAX_UPLOADS_PER_WALLET_PER_WINDOW), `${now}:${nonce}`,
    ]);
    return Number(result) === 1;
  }
  if (process.env.NODE_ENV === 'production') throw new Error('Shared asset rate limiter is not configured.');

  const recent = (attempts.get(normalizedAddress) || []).filter((timestamp) => timestamp > now - WINDOW_MS);
  if (recent.length >= MAX_UPLOADS_PER_WALLET_PER_WINDOW) {
    attempts.set(normalizedAddress, recent);
    return false;
  }
  recent.push(now);
  attempts.set(normalizedAddress, recent);
  return true;
}
