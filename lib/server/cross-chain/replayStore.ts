/**
 * VEILIO Cross-Chain Replay & Idempotency Storage
 * 
 * Enforces atomic, durable replay protection for verified cross-chain messages.
 * Uses OS-level exclusive file creation (O_CREAT | O_EXCL) and distributed Redis SET NX
 * to prevent race conditions under concurrent submissions.
 */

import fs from 'fs';
import path from 'path';
import { getDataDir } from '../dataDir';
import { isAssetRedisConfigured, assetRedisCommand } from '../redisRest';

export interface ReplayRecord {
  canonicalMessageId: string;
  sourceNetwork: string;
  sourceEmitter: string;
  sequence: string;
  payloadHash: string;
  status: 'verified';
  recordedAt: number;
}

const DATA_DIR = getDataDir();
const DB_DIR = path.join(DATA_DIR, 'db');
const REPLAY_DIR = path.join(DB_DIR, 'replays');
const REPLAY_DB_FILE = path.join(DB_DIR, 'replays.json');

function ensureDirectories(): void {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });
  if (!fs.existsSync(REPLAY_DIR)) fs.mkdirSync(REPLAY_DIR, { recursive: true });
  if (!fs.existsSync(REPLAY_DB_FILE)) {
    fs.writeFileSync(REPLAY_DB_FILE, JSON.stringify({}, null, 2), 'utf8');
  }
}

function sanitizeKeyForFs(key: string): string {
  // Replace colons, slashes, and spaces with safe underscores
  return key.replace(/[^a-zA-Z0-9_-]/g, '_');
}

function readIndex(): Record<string, ReplayRecord> {
  try {
    ensureDirectories();
    const raw = fs.readFileSync(REPLAY_DB_FILE, 'utf8');
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function writeIndex(data: Record<string, ReplayRecord>): void {
  ensureDirectories();
  const tmpFile = `${REPLAY_DB_FILE}.tmp.${Date.now()}.${Math.random().toString(36).slice(2)}`;
  fs.writeFileSync(tmpFile, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmpFile, REPLAY_DB_FILE);
}

export class ReplayStore {
  /**
   * Atomically attempts to reserve a canonical message ID.
   * Returns:
   *  - { reserved: true, alreadyVerified: false }: Successfully acquired reservation.
   *  - { reserved: false, alreadyVerified: true }: Message was already verified in the past (idempotent duplicate).
   *  - { reserved: false, alreadyVerified: false }: Another concurrent process is currently verifying this message.
   */
  public static async reserveMessage(
    canonicalMessageId: string
  ): Promise<{ reserved: boolean; alreadyVerified: boolean }> {
    ensureDirectories();

    // 1. Check if already committed in index
    const index = readIndex();
    if (index[canonicalMessageId]) {
      return { reserved: false, alreadyVerified: true };
    }

    // 2. Distributed Redis atomic check (if configured)
    if (isAssetRedisConfigured()) {
      try {
        const redisKey = `replay:${canonicalMessageId}`;
        const res = await assetRedisCommand<string | null>([
          'SET',
          redisKey,
          'LOCKED',
          'NX',
          'EX',
          '86400', // 24 hours lock TTL
        ]);
        if (!res) {
          // Key already existed in Redis
          return { reserved: false, alreadyVerified: Boolean(index[canonicalMessageId]) };
        }
      } catch (err) {
        // If Redis is configured but fails, fail-closed to preserve safety
        throw new Error(`Replay store Redis failure: ${(err as Error).message}`);
      }
    }

    // 3. Filesystem-level atomic exclusive creation (O_CREAT | O_EXCL)
    const lockFile = path.join(REPLAY_DIR, `${sanitizeKeyForFs(canonicalMessageId)}.lock`);
    try {
      // 'wx' flag opens for writing and fails if path exists atomically
      const fd = fs.openSync(lockFile, 'wx');
      fs.writeSync(fd, JSON.stringify({ reservedAt: Date.now() }));
      fs.closeSync(fd);
      return { reserved: true, alreadyVerified: false };
    } catch (err: any) {
      if (err.code === 'EEXIST') {
        // Lock file already exists: check if committed or in-flight
        const updatedIndex = readIndex();
        return {
          reserved: false,
          alreadyVerified: Boolean(updatedIndex[canonicalMessageId]),
        };
      }
      throw err;
    }
  }

  /**
   * Commits the verified record to persistent storage and finalizes reservation.
   */
  public static async commitMessage(record: ReplayRecord): Promise<void> {
    ensureDirectories();
    const index = readIndex();
    index[record.canonicalMessageId] = record;
    writeIndex(index);

    // Keep the lock file as marker of persistence
    const lockFile = path.join(REPLAY_DIR, `${sanitizeKeyForFs(record.canonicalMessageId)}.lock`);
    try {
      fs.writeFileSync(lockFile, JSON.stringify(record, null, 2), 'utf8');
    } catch {
      // Non-fatal if index is committed
    }
  }

  /**
   * Releases an uncommitted reservation (e.g., if downstream verification checks failed).
   */
  public static async releaseReservation(canonicalMessageId: string): Promise<void> {
    const lockFile = path.join(REPLAY_DIR, `${sanitizeKeyForFs(canonicalMessageId)}.lock`);
    try {
      if (fs.existsSync(lockFile)) {
        fs.unlinkSync(lockFile);
      }
    } catch {
      // Ignore cleanup error
    }

    if (isAssetRedisConfigured()) {
      try {
        await assetRedisCommand(['DEL', `replay:${canonicalMessageId}`]);
      } catch {
        // Ignore redis cleanup error
      }
    }
  }

  /**
   * Retrieves committed replay record if available.
   */
  public static async getRecord(canonicalMessageId: string): Promise<ReplayRecord | null> {
    const index = readIndex();
    return index[canonicalMessageId] ?? null;
  }

  /**
   * Testing utility to reset local replay storage between test runs.
   */
  public static async clearAllReplaysForTesting(): Promise<void> {
    ensureDirectories();
    try {
      const files = fs.readdirSync(REPLAY_DIR);
      for (const file of files) {
        fs.unlinkSync(path.join(REPLAY_DIR, file));
      }
      fs.writeFileSync(REPLAY_DB_FILE, JSON.stringify({}, null, 2), 'utf8');
    } catch {
      // Ignore
    }
  }
}
