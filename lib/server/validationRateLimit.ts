import { createHash } from 'node:crypto';
import { assetRedisCommand, isAssetRedisConfigured } from './redisRest';

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
  limit: number;
}

export const DEFAULT_VALIDATION_WINDOW_MS = 60 * 1000; // 60 seconds
export const DEFAULT_MAX_VALIDATIONS_PER_WINDOW = 5; // 5 requests per 60s window

// In-memory sliding window for development, testing, and multi-tier fallback
const inMemoryAttempts = new Map<string, number[]>();

const SLIDING_WINDOW_SCRIPT = [
  "local now = tonumber(ARGV[1])",
  "local window = tonumber(ARGV[2])",
  "local limit = tonumber(ARGV[3])",
  "redis.call('ZREMRANGEBYSCORE', KEYS[1], 0, now - window)",
  "local count = redis.call('ZCARD', KEYS[1])",
  "if count >= limit then",
  "  local oldest = redis.call('ZRANGE', KEYS[1], 0, 0, 'WITHSCORES')",
  "  local oldestTime = tonumber(oldest[2]) or (now - window)",
  "  local retryAfterMs = (oldestTime + window) - now",
  "  return { 0, 0, math.max(1, math.ceil(retryAfterMs / 1000)) }",
  "end",
  "redis.call('ZADD', KEYS[1], now, ARGV[4])",
  "redis.call('PEXPIRE', KEYS[1], window)",
  "return { 1, limit - count - 1, 0 }",
].join('\n');

/**
 * Checks whether an incoming validation request is within rate limits.
 * Uses shared Redis sliding window when configured; falls back to in-memory sliding window.
 */
export async function allowValidationRequest(
  identifier: string,
  customWindowMs?: number,
  customMaxLimit?: number,
  now = Date.now(),
  nonce = `${now}:${Math.random().toString(36).substring(2, 7)}`
): Promise<RateLimitResult> {
  const windowMs = customWindowMs ?? (Number(process.env.VALIDATION_RATE_LIMIT_WINDOW_MS) || DEFAULT_VALIDATION_WINDOW_MS);
  const maxLimit = customMaxLimit ?? (Number(process.env.VALIDATION_RATE_LIMIT_MAX) || DEFAULT_MAX_VALIDATIONS_PER_WINDOW);

  const normalized = identifier.trim().toLowerCase();
  const keyHash = createHash('sha256').update(normalized).digest('hex');

  if (isAssetRedisConfigured()) {
    try {
      const redisKey = `veilio:rate-limit:validate:${keyHash}`;
      const result = await assetRedisCommand<[number, number, number]>([
        'EVAL',
        SLIDING_WINDOW_SCRIPT,
        '1',
        redisKey,
        String(now),
        String(windowMs),
        String(maxLimit),
        `${now}:${nonce}`,
      ]);

      const allowed = Number(result[0]) === 1;
      const remaining = Math.max(0, Number(result[1]));
      const retryAfterSeconds = Math.max(0, Number(result[2]));

      return { allowed, remaining, retryAfterSeconds, limit: maxLimit };
    } catch (err) {
      console.warn('[Validation Rate Limiter] Redis evaluation failed, falling back to local memory:', err);
      // Fall through to in-memory limiter
    }
  }

  // In-memory sliding window fallback
  const recent = (inMemoryAttempts.get(keyHash) || []).filter((timestamp) => timestamp > now - windowMs);

  if (recent.length >= maxLimit) {
    const oldest = recent[0] || (now - windowMs);
    const retryAfterSeconds = Math.max(1, Math.ceil((oldest + windowMs - now) / 1000));
    inMemoryAttempts.set(keyHash, recent);
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds,
      limit: maxLimit,
    };
  }

  recent.push(now);
  inMemoryAttempts.set(keyHash, recent);
  return {
    allowed: true,
    remaining: maxLimit - recent.length,
    retryAfterSeconds: 0,
    limit: maxLimit,
  };
}

/**
 * Resets the in-memory rate limiter state. For test suites only.
 */
export function _resetValidationRateLimitsForTesting(): void {
  inMemoryAttempts.clear();
}
