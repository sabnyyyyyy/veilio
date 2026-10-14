/**
 * VEILIO IDENTITY PERSISTENCE LAYER
 *
 * Provides a clean persistence abstraction supporting:
 * 1. Production (Vercel Serverless): HTTPS Upstash Redis REST with atomic Lua scripts and commands.
 * 2. Development/Test: Local JSON file persistence with atomic renameSync and in-memory TTL maps.
 *
 * Fail-Closed Rule:
 * In production (NODE_ENV === 'production'), shared persistent Redis storage is mandatory.
 * The system will fail closed rather than silently falling back to local files or process memory.
 */

import fs from 'fs';
import path from 'path';
import { getDataDir } from './dataDir';
import crypto from 'crypto';
import { isIdentityRedisConfigured, identityRedisCommand } from './redisRest';
import type {
  VeilioIdentityProfile,
  LinkedWalletRecord,
  WalletLinkChallenge,
  UnifiedActivityItem,
} from './identityDb';

export interface IdentityPersistenceStore {
  getConfigurationError(): string | null;
  isSharedPersistent(): boolean;

  saveChallenge(challenge: WalletLinkChallenge): Promise<void>;
  consumeChallenge(challengeId: string): Promise<WalletLinkChallenge | null>;

  consumeNonce(
    purpose: 'challenge' | 'unlink' | 'init',
    signer: string,
    nonce: string,
    ttlSeconds?: number
  ): Promise<boolean>;

  getProfile(identityId: string): Promise<VeilioIdentityProfile | null>;
  getProfileByWallet(
    walletAddress: string,
    chainFamily: 'evm' | 'solana'
  ): Promise<VeilioIdentityProfile | null>;
  createProfileForWallet(params: {
    walletAddress: string;
    chainFamily: 'evm' | 'solana';
    networkId?: string;
  }): Promise<VeilioIdentityProfile>;
  linkWallet(params: {
    identityId: string;
    walletRecord: LinkedWalletRecord;
  }): Promise<VeilioIdentityProfile>;
  unlinkWallet(params: {
    identityId: string;
    walletAddress: string;
    chainFamily: 'evm' | 'solana';
  }): Promise<VeilioIdentityProfile>;

  saveActivity(item: UnifiedActivityItem): Promise<{ inserted: boolean; item: UnifiedActivityItem }>;
  getActivityHistory(
    identityId: string,
    options?: {
      chainFamily?: 'evm' | 'solana';
      networkId?: string;
      limit?: number;
      offset?: number;
    }
  ): Promise<{ items: UnifiedActivityItem[]; total: number }>;

  resetForTesting(): Promise<void>;
}

export function identityStorageConfigurationError(): string | null {
  if (process.env.NODE_ENV !== 'production') return null;
  if (!isIdentityRedisConfigured()) {
    return 'Persistent multi-instance identity storage is not configured for production. Connect an HTTPS Redis REST database (IDENTITY_REDIS_REST_URL or ASSET_REDIS_REST_URL).';
  }
  return null;
}

// ============================================================================
// Production Redis Persistence Store
// ============================================================================

const LUA_CONSUME_CHALLENGE = [
  "local key = KEYS[1]",
  "local val = redis.call('GET', key)",
  "if not val then return nil end",
  "redis.call('DEL', key)",
  "return val",
].join('\n');

const LUA_LINK_WALLET = [
  "local walletKey = KEYS[1]",
  "local profileKey = KEYS[2]",
  "local targetId = ARGV[1]",
  "local recordJson = ARGV[2]",
  "local now = ARGV[3]",
  "local currentOwner = redis.call('GET', walletKey)",
  "if currentOwner and currentOwner ~= targetId then",
  "  return -1",
  "end",
  "local profileRaw = redis.call('GET', profileKey)",
  "if not profileRaw then",
  "  return -2",
  "end",
  "local profile = cjson.decode(profileRaw)",
  "local record = cjson.decode(recordJson)",
  "local found = false",
  "for i, w in ipairs(profile.linkedWallets) do",
  "  if w.address == record.address and w.chainFamily == record.chainFamily and w.networkId == record.networkId then",
  "    w.status = 'active'",
  "    w.verifiedAt = tonumber(now)",
  "    w.proofType = record.proofType",
  "    found = true",
  "    break",
  "  end",
  "end",
  "if not found then",
  "  table.insert(profile.linkedWallets, record)",
  "end",
  "profile.updatedAt = tonumber(now)",
  "redis.call('SET', walletKey, targetId)",
  "local updatedJson = cjson.encode(profile)",
  "redis.call('SET', profileKey, updatedJson)",
  "return updatedJson",
].join('\n');

const LUA_UNLINK_WALLET = [
  "local walletKey = KEYS[1]",
  "local profileKey = KEYS[2]",
  "local targetAddress = ARGV[1]",
  "local chainFamily = ARGV[2]",
  "local now = ARGV[3]",
  "local profileRaw = redis.call('GET', profileKey)",
  "if not profileRaw then return -2 end",
  "local profile = cjson.decode(profileRaw)",
  "local activeCount = 0",
  "local targetIndex = nil",
  "for i, w in ipairs(profile.linkedWallets) do",
  "  if w.status == 'active' then activeCount = activeCount + 1 end",
  "  if w.address == targetAddress and w.chainFamily == chainFamily and w.status == 'active' then",
  "    targetIndex = i",
  "  end",
  "end",
  "if activeCount <= 1 then return -3 end",
  "if not targetIndex then return -4 end",
  "local target = profile.linkedWallets[targetIndex]",
  "if target.isPrimary then",
  "  for i, w in ipairs(profile.linkedWallets) do",
  "    if (w.address ~= targetAddress or w.chainFamily ~= chainFamily) and w.status == 'active' then",
  "      w.isPrimary = true",
  "      profile.primaryWallet = w.address",
  "      break",
  "    end",
  "  end",
  "end",
  "target.status = 'unlinked'",
  "target.isPrimary = false",
  "profile.updatedAt = tonumber(now)",
  "local hasRemainingActive = false",
  "for i, w in ipairs(profile.linkedWallets) do",
  "  if w.address == targetAddress and w.chainFamily == chainFamily and w.status == 'active' then",
  "    hasRemainingActive = true",
  "    break",
  "  end",
  "end",
  "if not hasRemainingActive then",
  "  redis.call('DEL', walletKey)",
  "end",
  "local updatedJson = cjson.encode(profile)",
  "redis.call('SET', profileKey, updatedJson)",
  "return updatedJson",
].join('\n');

const LUA_CREATE_OR_GET_PROFILE = [
  "local walletKey = KEYS[1]",
  "local targetAddress = ARGV[1]",
  "local chainFamily = ARGV[2]",
  "local networkId = ARGV[3]",
  "local newId = ARGV[4]",
  "local now = ARGV[5]",
  "local currentOwner = redis.call('GET', walletKey)",
  "if currentOwner then",
  "  local existing = redis.call('GET', 'veilio:id:profile:' .. currentOwner)",
  "  if existing then return existing end",
  "end",
  "local proofType = (chainFamily == 'evm') and 'eip191' or 'ed25519'",
  "local profile = {",
  "  id = newId,",
  "  primaryWallet = targetAddress,",
  "  createdAt = tonumber(now),",
  "  updatedAt = tonumber(now),",
  "  linkedWallets = {",
  "    {",
  "      address = targetAddress,",
  "      chainFamily = chainFamily,",
  "      networkId = networkId,",
  "      linkedAt = tonumber(now),",
  "      verifiedAt = tonumber(now),",
  "      isPrimary = true,",
  "      status = 'active',",
  "      proofType = proofType",
  "    }",
  "  }",
  "}",
  "local jsonStr = cjson.encode(profile)",
  "redis.call('SET', walletKey, newId)",
  "redis.call('SET', 'veilio:id:profile:' .. newId, jsonStr)",
  "return jsonStr",
].join('\n');

export class RedisIdentityStore implements IdentityPersistenceStore {
  getConfigurationError(): string | null {
    return identityStorageConfigurationError();
  }

  isSharedPersistent(): boolean {
    return true;
  }

  private checkConfig() {
    const err = this.getConfigurationError();
    if (err) throw new Error(err);
  }

  async saveChallenge(challenge: WalletLinkChallenge): Promise<void> {
    this.checkConfig();
    const key = `veilio:id:chal:${challenge.challengeId}`;
    await identityRedisCommand<string>([
      'SET',
      key,
      JSON.stringify(challenge),
      'EX',
      '300',
      'NX',
    ]);
  }

  async consumeChallenge(challengeId: string): Promise<WalletLinkChallenge | null> {
    this.checkConfig();
    const key = `veilio:id:chal:${challengeId}`;
    const result = await identityRedisCommand<string | null>([
      'EVAL',
      LUA_CONSUME_CHALLENGE,
      '1',
      key,
    ]);
    if (!result) return null;
    try {
      return JSON.parse(result) as WalletLinkChallenge;
    } catch {
      return null;
    }
  }

  async consumeNonce(
    purpose: 'challenge' | 'unlink' | 'init',
    signer: string,
    nonce: string,
    ttlSeconds = 600
  ): Promise<boolean> {
    this.checkConfig();
    const key = `veilio:id:nonce:${purpose}:${signer.toLowerCase()}:${nonce.trim()}`;
    const res = await identityRedisCommand<string | null>([
      'SET',
      key,
      '1',
      'EX',
      String(ttlSeconds),
      'NX',
    ]);
    return res === 'OK';
  }

  async getProfile(identityId: string): Promise<VeilioIdentityProfile | null> {
    this.checkConfig();
    const key = `veilio:id:profile:${identityId}`;
    const res = await identityRedisCommand<string | null>(['GET', key]);
    if (!res) return null;
    try {
      return JSON.parse(res) as VeilioIdentityProfile;
    } catch {
      return null;
    }
  }

  async getProfileByWallet(
    walletAddress: string,
    chainFamily: 'evm' | 'solana'
  ): Promise<VeilioIdentityProfile | null> {
    this.checkConfig();
    const normalized = chainFamily === 'evm' ? walletAddress.toLowerCase().trim() : walletAddress.trim();
    const walletKey = `veilio:id:wallet:${chainFamily}:${normalized}`;
    const identityId = await identityRedisCommand<string | null>(['GET', walletKey]);
    if (!identityId) return null;
    return this.getProfile(identityId);
  }

  async createProfileForWallet(params: {
    walletAddress: string;
    chainFamily: 'evm' | 'solana';
    networkId?: string;
  }): Promise<VeilioIdentityProfile> {
    this.checkConfig();
    const normalized =
      params.chainFamily === 'evm'
        ? params.walletAddress.toLowerCase().trim()
        : params.walletAddress.trim();
    const walletKey = `veilio:id:wallet:${params.chainFamily}:${normalized}`;
    const newId = `usr_${crypto.randomBytes(8).toString('hex')}`;
    const now = Date.now();
    const networkId = params.networkId || (params.chainFamily === 'evm' ? 'bnb:97' : 'solana:devnet');

    const result = await identityRedisCommand<string>([
      'EVAL',
      LUA_CREATE_OR_GET_PROFILE,
      '1',
      walletKey,
      normalized,
      params.chainFamily,
      networkId,
      newId,
      String(now),
    ]);

    return JSON.parse(result) as VeilioIdentityProfile;
  }

  async linkWallet(params: {
    identityId: string;
    walletRecord: LinkedWalletRecord;
  }): Promise<VeilioIdentityProfile> {
    this.checkConfig();
    const normalized =
      params.walletRecord.chainFamily === 'evm'
        ? params.walletRecord.address.toLowerCase().trim()
        : params.walletRecord.address.trim();
    const walletKey = `veilio:id:wallet:${params.walletRecord.chainFamily}:${normalized}`;
    const profileKey = `veilio:id:profile:${params.identityId}`;
    const now = Date.now();

    const record: LinkedWalletRecord = {
      ...params.walletRecord,
      address: normalized,
      linkedAt: now,
      verifiedAt: now,
      status: 'active',
      isPrimary: false,
    };

    const res = await identityRedisCommand<string | number>([
      'EVAL',
      LUA_LINK_WALLET,
      '2',
      walletKey,
      profileKey,
      params.identityId,
      JSON.stringify(record),
      String(now),
    ]);

    if (res === -1) {
      throw new Error(`Wallet ${normalized} is already linked to another Veilio identity`);
    }
    if (res === -2) {
      throw new Error(`Veilio identity ${params.identityId} not found`);
    }

    return JSON.parse(String(res)) as VeilioIdentityProfile;
  }

  async unlinkWallet(params: {
    identityId: string;
    walletAddress: string;
    chainFamily: 'evm' | 'solana';
  }): Promise<VeilioIdentityProfile> {
    this.checkConfig();
    const normalized =
      params.chainFamily === 'evm'
        ? params.walletAddress.toLowerCase().trim()
        : params.walletAddress.trim();
    const walletKey = `veilio:id:wallet:${params.chainFamily}:${normalized}`;
    const profileKey = `veilio:id:profile:${params.identityId}`;
    const now = Date.now();

    const res = await identityRedisCommand<string | number>([
      'EVAL',
      LUA_UNLINK_WALLET,
      '2',
      walletKey,
      profileKey,
      normalized,
      params.chainFamily,
      String(now),
    ]);

    if (res === -2) throw new Error(`Veilio identity ${params.identityId} not found`);
    if (res === -3) throw new Error('Cannot unlink the only active wallet for this identity');
    if (res === -4) throw new Error(`Wallet ${normalized} is not an active linked wallet for this identity`);

    return JSON.parse(String(res)) as VeilioIdentityProfile;
  }

  async saveActivity(item: UnifiedActivityItem): Promise<{ inserted: boolean; item: UnifiedActivityItem }> {
    this.checkConfig();
    const actKey = `veilio:id:act:${item.id}`;
    const listKey = `veilio:id:acts:${item.identityId}`;

    const existingRaw = await identityRedisCommand<string | null>(['GET', actKey]);
    if (existingRaw) {
      const existing = JSON.parse(existingRaw) as UnifiedActivityItem;
      const updated: UnifiedActivityItem = {
        ...existing,
        status: item.status,
        blockOrSlot: item.blockOrSlot ?? existing.blockOrSlot,
        metadata: item.metadata ?? existing.metadata,
      };
      await identityRedisCommand<string>(['SET', actKey, JSON.stringify(updated)]);
      return { inserted: false, item: updated };
    }

    await identityRedisCommand<string>(['SET', actKey, JSON.stringify(item)]);
    await identityRedisCommand<number>(['RPUSH', listKey, item.id]);
    return { inserted: true, item };
  }

  async getActivityHistory(
    identityId: string,
    options?: {
      chainFamily?: 'evm' | 'solana';
      networkId?: string;
      limit?: number;
      offset?: number;
    }
  ): Promise<{ items: UnifiedActivityItem[]; total: number }> {
    this.checkConfig();
    const listKey = `veilio:id:acts:${identityId}`;
    const ids = (await identityRedisCommand<string[] | null>(['LRANGE', listKey, '0', '-1'])) || [];

    const items: UnifiedActivityItem[] = [];
    for (const id of ids) {
      const raw = await identityRedisCommand<string | null>(['GET', `veilio:id:act:${id}`]);
      if (raw) {
        try {
          items.push(JSON.parse(raw) as UnifiedActivityItem);
        } catch {
          // ignore corrupted items
        }
      }
    }

    let filtered = items;
    if (options?.chainFamily) {
      filtered = filtered.filter((i) => i.chainFamily === options.chainFamily);
    }
    if (options?.networkId) {
      filtered = filtered.filter((i) => i.networkId === options.networkId);
    }

    filtered.sort((a, b) => b.timestamp - a.timestamp);
    const total = filtered.length;
    const offset = Math.max(0, options?.offset || 0);
    const limit = Math.min(100, Math.max(1, options?.limit || 20));

    return {
      items: filtered.slice(offset, offset + limit),
      total,
    };
  }

  async resetForTesting(): Promise<void> {
    // Used in tests to flush or clear identity keys if Redis is connected
  }
}

// ============================================================================
// Development & Local Test Persistence Store
// ============================================================================

const DATA_DIR = getDataDir();

function getLocalDbFilePath(): string {
  // Isolate automated tests from user development database
  if (
    process.env.NODE_ENV === 'test' ||
    process.env.HARDHAT_RUNNING === 'true' ||
    process.env.HARDHAT_NETWORK !== undefined ||
    process.env.npm_lifecycle_event === 'test'
  ) {
    return path.join(DATA_DIR, 'identities_db_test.json');
  }
  return path.join(DATA_DIR, 'identities_db.json');
}

interface LocalDbSchema {
  identities: Record<string, VeilioIdentityProfile>;
  walletToIdentity: Record<string, string>; // "chainFamily:normalizedAddress" -> identityId
  activities: Record<string, UnifiedActivityItem>;
}

export class LocalIdentityStore implements IdentityPersistenceStore {
  private activeChallenges = new Map<string, WalletLinkChallenge>();
  private consumedNonces = new Map<string, number>();

  private getDbFile(): string {
    return getLocalDbFilePath();
  }

  getConfigurationError(): string | null {
    if (process.env.NODE_ENV === 'production') {
      return 'Local JSON identity persistence is not permitted in production. Configure HTTPS Redis REST.';
    }
    return null;
  }

  isSharedPersistent(): boolean {
    return false;
  }

  private ensureDb(): LocalDbSchema {
    if (process.env.NODE_ENV === 'production') {
      throw new Error(this.getConfigurationError()!);
    }
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    const dbFile = this.getDbFile();
    if (!fs.existsSync(dbFile)) {
      const initial: LocalDbSchema = { identities: {}, walletToIdentity: {}, activities: {} };
      this.saveDb(initial);
      return initial;
    }
    try {
      const raw = fs.readFileSync(dbFile, 'utf8');
      const parsed = JSON.parse(raw);
      return {
        identities: parsed.identities || {},
        walletToIdentity: parsed.walletToIdentity || {},
        activities: parsed.activities || {},
      };
    } catch (err: any) {
      throw new Error(`Failed to parse identities database file: ${err?.message}`);
    }
  }

  private saveDb(db: LocalDbSchema) {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    const dbFile = this.getDbFile();
    const tmp = `${dbFile}.tmp.${Date.now()}.${crypto.randomBytes(4).toString('hex')}`;
    fs.writeFileSync(tmp, JSON.stringify(db, null, 2), 'utf8');
    try {
      fs.renameSync(tmp, dbFile);
    } catch {
      fs.copyFileSync(tmp, dbFile);
      fs.unlinkSync(tmp);
    }
  }

  private cleanupExpired() {
    const now = Date.now();
    for (const [id, c] of this.activeChallenges.entries()) {
      if (now > c.expiresAt) this.activeChallenges.delete(id);
    }
    for (const [key, exp] of this.consumedNonces.entries()) {
      if (now > exp) this.consumedNonces.delete(key);
    }
  }

  async saveChallenge(challenge: WalletLinkChallenge): Promise<void> {
    this.cleanupExpired();
    this.activeChallenges.set(challenge.challengeId, challenge);
  }

  async consumeChallenge(challengeId: string): Promise<WalletLinkChallenge | null> {
    this.cleanupExpired();
    const chal = this.activeChallenges.get(challengeId);
    if (!chal) return null;
    this.activeChallenges.delete(challengeId);
    return chal;
  }

  async consumeNonce(
    purpose: 'challenge' | 'unlink' | 'init',
    signer: string,
    nonce: string,
    ttlSeconds = 600
  ): Promise<boolean> {
    this.cleanupExpired();
    const key = `${purpose}:${signer.toLowerCase()}:${nonce.trim()}`;
    if (this.consumedNonces.has(key)) return false;
    this.consumedNonces.set(key, Date.now() + ttlSeconds * 1000);
    return true;
  }

  async getProfile(identityId: string): Promise<VeilioIdentityProfile | null> {
    const db = this.ensureDb();
    return db.identities[identityId] || null;
  }

  async getProfileByWallet(
    walletAddress: string,
    chainFamily: 'evm' | 'solana'
  ): Promise<VeilioIdentityProfile | null> {
    const db = this.ensureDb();
    const norm = chainFamily === 'evm' ? walletAddress.toLowerCase().trim() : walletAddress.trim();
    const key = `${chainFamily}:${norm}`;
    const id = db.walletToIdentity[key] || db.walletToIdentity[norm]; // backward compatible
    if (id && db.identities[id]) {
      return db.identities[id];
    }
    // Self-healing fallback: scan db.identities for any profile whose active linkedWallets contains this address
    for (const candidateId of Object.keys(db.identities)) {
      const candidate = db.identities[candidateId];
      const match = candidate.linkedWallets?.some(
        (w) =>
          (chainFamily === 'evm' ? w.address.toLowerCase() === norm : w.address === norm) &&
          w.chainFamily === chainFamily &&
          w.status === 'active'
      );
      if (match) {
        db.walletToIdentity[key] = candidateId;
        db.walletToIdentity[norm] = candidateId;
        this.saveDb(db);
        return candidate;
      }
    }
    return null;
  }

  async createProfileForWallet(params: {
    walletAddress: string;
    chainFamily: 'evm' | 'solana';
    networkId?: string;
  }): Promise<VeilioIdentityProfile> {
    const db = this.ensureDb();
    const norm =
      params.chainFamily === 'evm'
        ? params.walletAddress.toLowerCase().trim()
        : params.walletAddress.trim();
    const key = `${params.chainFamily}:${norm}`;

    const existingId = db.walletToIdentity[key] || db.walletToIdentity[norm];
    if (existingId && db.identities[existingId]) {
      return db.identities[existingId];
    }
    // Self-healing fallback before generating a duplicate identity
    for (const candidateId of Object.keys(db.identities)) {
      const candidate = db.identities[candidateId];
      const match = candidate.linkedWallets?.some(
        (w) =>
          (params.chainFamily === 'evm' ? w.address.toLowerCase() === norm : w.address === norm) &&
          w.chainFamily === params.chainFamily &&
          w.status === 'active'
      );
      if (match) {
        db.walletToIdentity[key] = candidateId;
        db.walletToIdentity[norm] = candidateId;
        this.saveDb(db);
        return candidate;
      }
    }

    const identityId = `usr_${crypto.randomBytes(8).toString('hex')}`;
    const now = Date.now();
    const profile: VeilioIdentityProfile = {
      id: identityId,
      primaryWallet: norm,
      createdAt: now,
      updatedAt: now,
      linkedWallets: [
        {
          address: norm,
          chainFamily: params.chainFamily,
          networkId: params.networkId || (params.chainFamily === 'evm' ? 'bnb:97' : 'solana:devnet'),
          linkedAt: now,
          verifiedAt: now,
          isPrimary: true,
          status: 'active',
          proofType: params.chainFamily === 'evm' ? 'eip191' : 'ed25519',
        },
      ],
    };

    db.identities[identityId] = profile;
    db.walletToIdentity[key] = identityId;
    db.walletToIdentity[norm] = identityId;
    this.saveDb(db);
    return profile;
  }

  async linkWallet(params: {
    identityId: string;
    walletRecord: LinkedWalletRecord;
  }): Promise<VeilioIdentityProfile> {
    const db = this.ensureDb();
    const profile = db.identities[params.identityId];
    if (!profile) throw new Error(`Veilio identity ${params.identityId} not found`);

    const norm =
      params.walletRecord.chainFamily === 'evm'
        ? params.walletRecord.address.toLowerCase().trim()
        : params.walletRecord.address.trim();
    const key = `${params.walletRecord.chainFamily}:${norm}`;

    const existingOwner = db.walletToIdentity[key] || db.walletToIdentity[norm];
    if (existingOwner && existingOwner !== params.identityId) {
      const ownerProfile = db.identities[existingOwner];
      const isStillActive = ownerProfile?.linkedWallets.some(
        (w) => w.address === norm && w.chainFamily === params.walletRecord.chainFamily && w.status === 'active'
      );
      if (isStillActive) {
        throw new Error(`Wallet ${norm} is already linked to another Veilio identity (${existingOwner})`);
      }
    }

    const now = Date.now();
    const idx = profile.linkedWallets.findIndex(
      (w) =>
        (params.walletRecord.chainFamily === 'evm'
          ? w.address.toLowerCase() === norm.toLowerCase()
          : w.address === norm) &&
        w.chainFamily === params.walletRecord.chainFamily &&
        w.networkId === params.walletRecord.networkId
    );

    if (idx >= 0) {
      profile.linkedWallets[idx].status = 'active';
      profile.linkedWallets[idx].verifiedAt = now;
      profile.linkedWallets[idx].proofType = params.walletRecord.proofType;
    } else {
      profile.linkedWallets.push({
        ...params.walletRecord,
        address: norm,
        linkedAt: now,
        verifiedAt: now,
        status: 'active',
        isPrimary: false,
      });
    }

    profile.updatedAt = now;
    db.walletToIdentity[key] = params.identityId;
    db.walletToIdentity[norm] = params.identityId;
    this.saveDb(db);
    return profile;
  }

  async unlinkWallet(params: {
    identityId: string;
    walletAddress: string;
    chainFamily: 'evm' | 'solana';
  }): Promise<VeilioIdentityProfile> {
    const db = this.ensureDb();
    const profile = db.identities[params.identityId];
    if (!profile) throw new Error(`Veilio identity ${params.identityId} not found`);

    const norm =
      params.chainFamily === 'evm'
        ? params.walletAddress.toLowerCase().trim()
        : params.walletAddress.trim();
    const key = `${params.chainFamily}:${norm}`;

    const activeWallets = profile.linkedWallets.filter((w) => w.status === 'active');
    if (activeWallets.length <= 1) {
      throw new Error('Cannot unlink the only active wallet for this identity');
    }

    const target = profile.linkedWallets.find(
      (w) => w.address === norm && w.chainFamily === params.chainFamily
    );
    if (!target || target.status !== 'active') {
      throw new Error(`Wallet ${norm} is not an active linked wallet for this identity`);
    }

    if (target.isPrimary) {
      const other = profile.linkedWallets.find(
        (w) => (w.address !== norm || w.chainFamily !== params.chainFamily) && w.status === 'active'
      );
      if (other) {
        other.isPrimary = true;
        profile.primaryWallet = other.address;
      }
    }

    target.status = 'unlinked';
    target.isPrimary = false;
    profile.updatedAt = Date.now();

    const stillHasActiveWithAddress = profile.linkedWallets.some(
      (w) =>
        (params.chainFamily === 'evm' ? w.address.toLowerCase() === norm : w.address === norm) &&
        w.chainFamily === params.chainFamily &&
        w.status === 'active'
    );
    if (!stillHasActiveWithAddress) {
      delete db.walletToIdentity[key];
      delete db.walletToIdentity[norm];
    }
    this.saveDb(db);
    return profile;
  }

  async saveActivity(item: UnifiedActivityItem): Promise<{ inserted: boolean; item: UnifiedActivityItem }> {
    const db = this.ensureDb();
    const existing = db.activities[item.id];
    if (existing) {
      const updated: UnifiedActivityItem = {
        ...existing,
        status: item.status,
        blockOrSlot: item.blockOrSlot ?? existing.blockOrSlot,
        metadata: item.metadata ?? existing.metadata,
      };
      db.activities[item.id] = updated;
      this.saveDb(db);
      return { inserted: false, item: updated };
    }

    db.activities[item.id] = item;
    this.saveDb(db);
    return { inserted: true, item };
  }

  async getActivityHistory(
    identityId: string,
    options?: {
      chainFamily?: 'evm' | 'solana';
      networkId?: string;
      limit?: number;
      offset?: number;
    }
  ): Promise<{ items: UnifiedActivityItem[]; total: number }> {
    const db = this.ensureDb();
    const profile = db.identities[identityId];
    if (!profile) return { items: [], total: 0 };

    const activeSet = new Set(
      profile.linkedWallets.filter((w) => w.status === 'active').map((w) => w.address)
    );

    let all = Object.values(db.activities).filter(
      (act) => act.identityId === identityId || activeSet.has(act.walletAddress)
    );

    if (options?.chainFamily) all = all.filter((a) => a.chainFamily === options.chainFamily);
    if (options?.networkId) all = all.filter((a) => a.networkId === options.networkId);

    all.sort((a, b) => b.timestamp - a.timestamp);
    const total = all.length;
    const offset = Math.max(0, options?.offset || 0);
    const limit = Math.min(100, Math.max(1, options?.limit || 20));

    return {
      items: all.slice(offset, offset + limit),
      total,
    };
  }

  async resetForTesting(): Promise<void> {
    this.activeChallenges.clear();
    this.consumedNonces.clear();
    const initial: LocalDbSchema = { identities: {}, walletToIdentity: {}, activities: {} };
    this.saveDb(initial);
  }
}

// ============================================================================
// Singleton Factory & Store Selector
// ============================================================================

let testOverrideStore: IdentityPersistenceStore | null = null;
const localStoreInstance = new LocalIdentityStore();
const redisStoreInstance = new RedisIdentityStore();

export function getIdentityPersistenceStore(): IdentityPersistenceStore {
  if (testOverrideStore) return testOverrideStore;
  if (isIdentityRedisConfigured() || process.env.NODE_ENV === 'production') {
    return redisStoreInstance;
  }
  return localStoreInstance;
}

export function _setIdentityStoreForTesting(store: IdentityPersistenceStore | null) {
  testOverrideStore = store;
}
