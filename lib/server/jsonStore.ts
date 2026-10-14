import { AsyncLocalStorage } from 'node:async_hooks';
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';
import { NextRequest } from 'next/server';
import { assetRedisCommand, isAssetRedisConfigured } from './redisRest';

/**
 * Durable storage for the whole-document JSON stores (services/chat/orders, auction
 * transactions, refunds).
 *
 * The stores keep their synchronous API: an API route wrapped in `withJsonStores` loads a
 * snapshot of every store from Redis at the start of the request (kept per request in
 * AsyncLocalStorage), the store code reads and writes that snapshot, and the dirty
 * snapshots are saved together at the end with a compare-and-set on version counters. If
 * another request saved first, the handler is re-run on fresh data, so concurrent writes
 * are never lost or applied twice.
 *
 * Documents are gzipped and encrypted (AES-256-GCM, key derived from
 * ASSET_KEY_ENCRYPTION_KEY) before they reach Redis. Without Redis (local dev, tests) the
 * stores keep using their files under data/.
 */

export const JSON_STORE_NAMES = ['services', 'transactions', 'refunds'] as const;
export type JsonStoreName = (typeof JSON_STORE_NAMES)[number];

export interface JsonStoreBackend {
  load(names: readonly JsonStoreName[]): Promise<Record<string, { raw: string | null; version: number }>>;
  /**
   * Saves every entry only if each stored version still equals its `expectedVersion`
   * (all or nothing); returns whether it saved.
   */
  saveAll(entries: Array<{ name: JsonStoreName; raw: string; expectedVersion: number }>): Promise<boolean>;
}

interface Snapshot {
  data: unknown | null;
  version: number;
  dirty: boolean;
}

const context = new AsyncLocalStorage<Map<JsonStoreName, Snapshot>>();
const MAX_ATTEMPTS = 4;

const dataKey = (name: JsonStoreName) => `veilio:store:${name}:data`;
const versionKey = (name: JsonStoreName) => `veilio:store:${name}:version`;

// KEYS = [data1, version1, data2, version2, ...], ARGV = [raw1, expected1, raw2, expected2, ...]
const COMPARE_AND_SET_ALL = `
for i = 1, #KEYS, 2 do
  if tonumber(redis.call('GET', KEYS[i + 1]) or '0') ~= tonumber(ARGV[i + 1]) then return 0 end
end
for i = 1, #KEYS, 2 do
  redis.call('SET', KEYS[i], ARGV[i])
  redis.call('INCR', KEYS[i + 1])
end
return 1`;

export const redisJsonStoreBackend: JsonStoreBackend = {
  async load(names) {
    const keys = names.flatMap((name) => [dataKey(name), versionKey(name)]);
    const values = await assetRedisCommand<Array<string | null>>(['MGET', ...keys]);
    return Object.fromEntries(
      names.map((name, i) => [name, { raw: values[i * 2] ?? null, version: Number(values[i * 2 + 1] ?? 0) }])
    );
  },
  async saveAll(entries) {
    const keys = entries.flatMap((e) => [dataKey(e.name), versionKey(e.name)]);
    const argv = entries.flatMap((e) => [e.raw, String(e.expectedVersion)]);
    const result = await assetRedisCommand<number>(['EVAL', COMPARE_AND_SET_ALL, String(keys.length), ...keys, ...argv]);
    return Number(result) === 1;
  },
};

let backendOverride: JsonStoreBackend | null = null;

/** Test hook: route stores through a custom backend (null restores the default). */
export function setJsonStoreBackendForTests(backend: JsonStoreBackend | null): void {
  backendOverride = backend;
}

function activeBackend(): JsonStoreBackend | null {
  if (backendOverride) return backendOverride;
  return isAssetRedisConfigured() ? redisJsonStoreBackend : null;
}

/** True when stores must go through request snapshots (Redis or a test backend). */
export function isDurableJsonStoreEnabled(): boolean {
  return activeBackend() !== null;
}

// ---------------------------------------------------------------------------
// Encryption at rest
// ---------------------------------------------------------------------------

function storeKey(name: JsonStoreName): Buffer {
  const secret = process.env.ASSET_KEY_ENCRYPTION_KEY;
  if (!secret) throw new Error('ASSET_KEY_ENCRYPTION_KEY is required to encrypt stored data.');
  const material = Buffer.from(secret, 'base64');
  if (material.length < 32) throw new Error('ASSET_KEY_ENCRYPTION_KEY must decode to at least 32 bytes.');
  return Buffer.from(hkdfSync('sha256', material, Buffer.alloc(0), `veilio-json-store:v1:${name}`, 32));
}

export function encryptStoreDocument(name: JsonStoreName, data: unknown): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', storeKey(name), iv);
  cipher.setAAD(Buffer.from(name));
  const body = Buffer.concat([cipher.update(gzipSync(Buffer.from(JSON.stringify(data)))), cipher.final()]);
  return `v1:${Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64')}`;
}

export function decryptStoreDocument(name: JsonStoreName, raw: string): unknown {
  if (!raw.startsWith('v1:')) throw new Error(`Unknown ${name} store format.`);
  const blob = Buffer.from(raw.slice(3), 'base64');
  const decipher = createDecipheriv('aes-256-gcm', storeKey(name), blob.subarray(0, 12));
  decipher.setAAD(Buffer.from(name));
  decipher.setAuthTag(blob.subarray(12, 28));
  return JSON.parse(gunzipSync(Buffer.concat([decipher.update(blob.subarray(28)), decipher.final()])).toString('utf8'));
}

// ---------------------------------------------------------------------------
// Snapshot access used by the stores
// ---------------------------------------------------------------------------

function requestSnapshot(name: JsonStoreName): Snapshot {
  const snapshot = context.getStore()?.get(name);
  if (!snapshot) {
    throw new Error(`The ${name} store was used outside withJsonStores(); wrap the API route handler.`);
  }
  return snapshot;
}

/**
 * Returns a private copy of the request's snapshot of `name` (null if the store is empty),
 * or `undefined` when no durable backend is active so the caller should use its file.
 */
export function readJsonStore<T>(name: JsonStoreName): T | null | undefined {
  if (!isDurableJsonStoreEnabled()) return undefined;
  const snapshot = requestSnapshot(name);
  return snapshot.data === null ? null : structuredClone(snapshot.data as T);
}

/** Replaces the request's snapshot; returns false when the caller should write its file instead. */
export function writeJsonStore(name: JsonStoreName, data: unknown): boolean {
  if (!isDurableJsonStoreEnabled()) return false;
  const snapshot = requestSnapshot(name);
  snapshot.data = structuredClone(data);
  snapshot.dirty = true;
  return true;
}

// ---------------------------------------------------------------------------
// Request wrapper
// ---------------------------------------------------------------------------

function freshRequestCopy<A extends unknown[]>(args: A): A {
  const [first, ...rest] = args;
  if (first instanceof Request) {
    const copy = first instanceof NextRequest ? new NextRequest(first.clone()) : first.clone();
    return [copy, ...rest] as unknown as A;
  }
  return args;
}

/**
 * Wraps a route handler so it runs against request-scoped store snapshots that are saved
 * atomically afterwards. A no-op when no durable backend is configured.
 */
export function withJsonStores<A extends unknown[], R extends Response>(
  handler: (...args: A) => Promise<R>
): (...args: A) => Promise<R | Response> {
  return async (...args: A) => {
    const backend = activeBackend();
    // No durable backend, or already inside a wrapped handler (one route delegating to another).
    if (!backend || context.getStore()) return handler(...args);

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const loaded = await backend.load(JSON_STORE_NAMES);
      const snapshots = new Map<JsonStoreName, Snapshot>(
        JSON_STORE_NAMES.map((name) => {
          const { raw, version } = loaded[name] ?? { raw: null, version: 0 };
          return [name, { data: raw ? decryptStoreDocument(name, raw) : null, version, dirty: false }];
        })
      );

      // Each attempt gets its own copy of the request so the body can be read again on retry.
      const response = await context.run(snapshots, () => handler(...freshRequestCopy(args)));

      const dirty = [...snapshots].filter(([, snapshot]) => snapshot.dirty);
      if (dirty.length === 0) return response;
      const committed = await backend.saveAll(
        dirty.map(([name, snapshot]) => ({
          name,
          raw: encryptStoreDocument(name, snapshot.data),
          expectedVersion: snapshot.version,
        }))
      );
      if (committed) return response;
    }

    return Response.json({ error: 'The service is busy. Please retry.' }, { status: 503, headers: { 'Retry-After': '1' } });
  };
}
