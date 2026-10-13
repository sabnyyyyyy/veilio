export interface StoredSecret {
  auctionId: string;
  bidder: string;
  maxBid: string;
  secret: `0x${string}`;
  commitment: `0x${string}`;
  timestamp: number;
  revealed?: boolean;
  won?: boolean;
  settled?: boolean;
  refundClaimed?: boolean;
  networkId?: 'bnb:97' | 'base:84532' | 'solana:devnet';
  chainId?: number;
  /**
   * 'pending': saved before the commit transaction was sent (outcome unknown).
   * 'confirmed': the commit transaction was confirmed on-chain.
   * Missing on secrets stored by older app versions (those were saved after confirmation).
   */
  status?: 'pending' | 'confirmed';
  txHash?: string;
}

export interface UserActivity {
  id: string;
  type: 'bid_committed' | 'bid_revealed' | 'auction_created' | 'refund_withdrawn' | 'auction_settled';
  auctionId: string;
  itemName: string;
  amount?: string;
  timestamp: number;
  userAddress: string;
  txHash?: string;
  networkId?: 'bnb:97' | 'base:84532' | 'solana:devnet';
  chainId?: number;
}

export interface StoredAuction {
  id: string;
  itemName: string;
  description: string;
  imageURI: string;
  startingPrice: string;
  commitEndTime: number;
  revealEndTime: number;
  seller: string;
  createdAt: number;
  networkId?: 'bnb:97' | 'base:84532' | 'solana:devnet';
  chainId?: number;
}

const STORAGE_KEY_PREFIX = 'veilio_secret_';
const LEGACY_STORAGE_KEY_PREFIX = 'blindbid_secret_';
const AUCTIONS_KEY_PREFIX = 'veilio_user_auction_';
const LEGACY_AUCTIONS_KEY_PREFIX = 'blindbid_user_auction_';
const ACTIVITIES_KEY_PREFIX = 'veilio_activity_';
const LEGACY_ACTIVITIES_KEY_PREFIX = 'blindbid_activity_';

// Every secret is mirrored to a backup key that this module never deletes, and
// a secret that would be replaced is moved to an archive key first. Losing a
// bid secret means the bid can never be revealed, so nothing here deletes a
// secret unless the commit transaction definitely was not sent.
const BACKUP_KEY_PREFIX = 'veilio_secret_backup_';
const ARCHIVE_KEY_PREFIX = 'veilio_bidsecret_archive_';

function secretKeySuffix(auctionId: string | number, bidder: string) {
  return `${auctionId}_${bidder.toLowerCase()}`;
}

function readSecret(key: string): StoredSecret | null {
  const raw = localStorage.getItem(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as StoredSecret;
  } catch {
    return null;
  }
}

function writeSecretOrThrow(key: string, data: StoredSecret) {
  const serialized = JSON.stringify(data);
  localStorage.setItem(key, serialized);
  if (localStorage.getItem(key) !== serialized) {
    throw new Error('Browser storage did not persist the bid secret.');
  }
}

export function saveBidSecret(data: StoredSecret) {
  if (typeof window === 'undefined') return;
  const suffix = secretKeySuffix(data.auctionId, data.bidder);
  const key = `${STORAGE_KEY_PREFIX}${suffix}`;
  const existed = !!localStorage.getItem(key);
  writeSecretOrThrow(key, data);
  try {
    localStorage.setItem(`${BACKUP_KEY_PREFIX}${suffix}`, JSON.stringify(data));
  } catch {
    // The primary copy is stored; the backup is best effort.
  }

  // Record activity once, when a confirmed (or legacy) commitment is first stored.
  if (!existed && data.status !== 'pending') recordCommitActivity(data);
}

function recordCommitActivity(data: StoredSecret) {
  saveUserActivity({
    id: `act_${Date.now()}`,
    type: 'bid_committed',
    auctionId: data.auctionId,
    itemName: `Auction #${data.auctionId}`,
    amount: data.maxBid,
    timestamp: Date.now(),
    userAddress: data.bidder,
    txHash: data.txHash || data.commitment,
    networkId: data.networkId,
    chainId: data.chainId,
  });
}

function archiveSecret(data: StoredSecret) {
  const key = `${ARCHIVE_KEY_PREFIX}${secretKeySuffix(data.auctionId, data.bidder)}_${data.commitment}`;
  localStorage.setItem(key, JSON.stringify(data));
}

/**
 * Persists a new bid secret BEFORE the commit transaction is sent. Throws when
 * the browser cannot store it, so the caller must not send the transaction.
 * An existing secret for the same auction/bidder is archived, never dropped.
 */
export function savePendingBidSecret(data: StoredSecret) {
  if (typeof window === 'undefined') throw new Error('Bid secrets can only be stored in the browser.');
  const existing = getBidSecret(data.auctionId, data.bidder);
  if (existing && existing.commitment !== data.commitment) archiveSecret(existing);
  saveBidSecret({ ...data, status: 'pending' });
}

/** Marks a pending secret as confirmed after the commit transaction succeeded. */
export function confirmBidSecret(auctionId: string, bidder: string, txHash?: string) {
  if (typeof window === 'undefined') return;
  const existing = getBidSecret(auctionId, bidder);
  if (!existing) return;
  const wasPending = existing.status === 'pending';
  const confirmed: StoredSecret = { ...existing, status: 'confirmed', txHash: txHash || existing.txHash };
  saveBidSecret(confirmed);
  // saveBidSecret skips activity for updates; record the newly confirmed commit here.
  if (wasPending) recordCommitActivity(confirmed);
}

/**
 * Removes a pending secret ONLY when the commit definitely never reached the
 * chain (e.g. the user rejected the wallet prompt). Restores an archived
 * secret for the same auction if one exists. Ambiguous failures (RPC timeout,
 * closed tab, unknown receipt) must keep the secret.
 */
export function discardPendingBidSecret(auctionId: string, bidder: string, commitment: string) {
  if (typeof window === 'undefined') return;
  const suffix = secretKeySuffix(auctionId, bidder);
  const existing = readSecret(`${STORAGE_KEY_PREFIX}${suffix}`);
  if (!existing || existing.status !== 'pending' || existing.commitment !== commitment) return;
  const archived = getArchivedSecrets(auctionId, bidder).sort((a, b) => b.timestamp - a.timestamp)[0];
  if (archived) {
    localStorage.setItem(`${STORAGE_KEY_PREFIX}${suffix}`, JSON.stringify(archived));
    localStorage.setItem(`${BACKUP_KEY_PREFIX}${suffix}`, JSON.stringify(archived));
    localStorage.removeItem(`${ARCHIVE_KEY_PREFIX}${suffix}_${archived.commitment}`);
  } else {
    localStorage.removeItem(`${STORAGE_KEY_PREFIX}${suffix}`);
    localStorage.removeItem(`${BACKUP_KEY_PREFIX}${suffix}`);
  }
}

function getArchivedSecrets(auctionId: string | number, bidder: string): StoredSecret[] {
  const prefix = `${ARCHIVE_KEY_PREFIX}${secretKeySuffix(auctionId, bidder)}_`;
  const results: StoredSecret[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && key.startsWith(prefix)) {
      const item = readSecret(key);
      if (item) results.push(item);
    }
  }
  return results;
}

export function getBidSecret(auctionId: string | number, bidder: string): StoredSecret | null {
  if (typeof window === 'undefined') return null;
  const suffix = secretKeySuffix(auctionId, bidder);
  return readSecret(`${STORAGE_KEY_PREFIX}${suffix}`)
    || readSecret(`${LEGACY_STORAGE_KEY_PREFIX}${suffix}`)
    || readSecret(`${BACKUP_KEY_PREFIX}${suffix}`);
}

/**
 * All locally known secrets for an auction/bidder (current, backup, archived),
 * de-duplicated by commitment. Use with the on-chain commitment to pick the
 * secret that actually matches the bid.
 */
export function getBidSecretCandidates(auctionId: string | number, bidder: string): StoredSecret[] {
  if (typeof window === 'undefined') return [];
  const suffix = secretKeySuffix(auctionId, bidder);
  const all = [
    readSecret(`${STORAGE_KEY_PREFIX}${suffix}`),
    readSecret(`${LEGACY_STORAGE_KEY_PREFIX}${suffix}`),
    readSecret(`${BACKUP_KEY_PREFIX}${suffix}`),
    ...getArchivedSecrets(auctionId, bidder),
  ].filter((item): item is StoredSecret => !!item && !!item.secret);
  const seen = new Set<string>();
  return all.filter((item) => {
    const id = String(item.commitment).toLowerCase();
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

/** Picks the stored secret whose commitment equals the on-chain commitment. */
export function findBidSecretForCommitment(auctionId: string | number, bidder: string, onchainCommitment: string): StoredSecret | null {
  const target = onchainCommitment.toLowerCase();
  return getBidSecretCandidates(auctionId, bidder).find((item) => String(item.commitment).toLowerCase() === target) || null;
}

export interface BidSecretBackup {
  format: 'veilio-bid-secrets';
  version: 1;
  exportedAt: number;
  secrets: StoredSecret[];
}

/** JSON backup of every stored bid secret (optionally for one bidder). */
export function exportBidSecrets(bidder?: string): string {
  const secrets: StoredSecret[] = [];
  const seen = new Set<string>();
  if (typeof window !== 'undefined') {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || !(key.startsWith(STORAGE_KEY_PREFIX) || key.startsWith(LEGACY_STORAGE_KEY_PREFIX) || key.startsWith(BACKUP_KEY_PREFIX) || key.startsWith(ARCHIVE_KEY_PREFIX))) continue;
      const item = readSecret(key);
      if (!item || !item.secret || !item.commitment) continue;
      if (bidder && item.bidder?.toLowerCase() !== bidder.toLowerCase()) continue;
      const id = `${item.auctionId}:${String(item.bidder).toLowerCase()}:${String(item.commitment).toLowerCase()}`;
      if (seen.has(id)) continue;
      seen.add(id);
      secrets.push(item);
    }
  }
  const backup: BidSecretBackup = { format: 'veilio-bid-secrets', version: 1, exportedAt: Date.now(), secrets };
  return JSON.stringify(backup, null, 2);
}

/** Restores secrets from an exported backup without overwriting different local secrets. Returns the count restored. */
export function importBidSecrets(json: string): number {
  if (typeof window === 'undefined') return 0;
  const parsed = JSON.parse(json) as Partial<BidSecretBackup>;
  if (parsed.format !== 'veilio-bid-secrets' || !Array.isArray(parsed.secrets)) throw new Error('Not a VEILIO bid secret backup file.');
  let restored = 0;
  for (const item of parsed.secrets) {
    if (!item || typeof item.auctionId !== 'string' || typeof item.bidder !== 'string' || typeof item.secret !== 'string' || typeof item.commitment !== 'string') continue;
    const existing = getBidSecret(item.auctionId, item.bidder);
    if (!existing) {
      saveBidSecret(item);
      restored++;
    } else if (existing.commitment !== item.commitment) {
      archiveSecret(item);
      restored++;
    }
  }
  return restored;
}

export function getAllUserSecrets(bidder: string): StoredSecret[] {
  if (typeof window === 'undefined' || !bidder) return [];
  const results: StoredSecret[] = [];
  const seenIds = new Set<string>();
  const target = bidder.toLowerCase();
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (
      key &&
      (key.startsWith(STORAGE_KEY_PREFIX) || key.startsWith(LEGACY_STORAGE_KEY_PREFIX)) &&
      key.endsWith(`_${target}`)
    ) {
      try {
        const item = JSON.parse(localStorage.getItem(key) || '') as StoredSecret;
        if (item && item.auctionId && !seenIds.has(String(item.auctionId))) {
          seenIds.add(String(item.auctionId));
          results.push(item);
        }
      } catch (e) {
        // ignore invalid entries
      }
    }
  }
  return results.sort((a, b) => b.timestamp - a.timestamp);
}

export function saveCreatedAuction(auction: StoredAuction) {
  if (typeof window === 'undefined') return;
  const key = `${AUCTIONS_KEY_PREFIX}${auction.id}_${auction.seller.toLowerCase()}`;
  localStorage.setItem(key, JSON.stringify(auction));

  saveUserActivity({
    id: `act_${Date.now()}`,
    type: 'auction_created',
    auctionId: auction.id,
    itemName: auction.itemName,
    amount: auction.startingPrice,
    timestamp: Date.now(),
    userAddress: auction.seller,
  });
}

export function getUserCreatedAuctions(seller: string): StoredAuction[] {
  if (typeof window === 'undefined' || !seller) return [];
  const results: StoredAuction[] = [];
  const seenIds = new Set<string>();
  const target = seller.toLowerCase();
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (
      key &&
      (key.startsWith(AUCTIONS_KEY_PREFIX) || key.startsWith(LEGACY_AUCTIONS_KEY_PREFIX)) &&
      key.endsWith(`_${target}`)
    ) {
      try {
        const item = JSON.parse(localStorage.getItem(key) || '') as StoredAuction;
        if (item && item.id && !seenIds.has(String(item.id))) {
          seenIds.add(String(item.id));
          results.push(item);
        }
      } catch (e) {
        // ignore
      }
    }
  }
  return results.sort((a, b) => b.createdAt - a.createdAt);
}

export function saveUserActivity(activity: UserActivity) {
  if (typeof window === 'undefined') return;
  const rawList = localStorage.getItem(`${ACTIVITIES_KEY_PREFIX}${activity.userAddress.toLowerCase()}`);
  let list: UserActivity[] = [];
  if (rawList) {
    try {
      list = JSON.parse(rawList);
    } catch {
      list = [];
    }
  }
  list.unshift(activity);
  localStorage.setItem(`${ACTIVITIES_KEY_PREFIX}${activity.userAddress.toLowerCase()}`, JSON.stringify(list.slice(0, 20)));
}

export function getUserActivities(userAddress: string): UserActivity[] {
  if (typeof window === 'undefined' || !userAddress) return [];
  const rawList = localStorage.getItem(`${ACTIVITIES_KEY_PREFIX}${userAddress.toLowerCase()}`);
  if (!rawList) return [];
  try {
    return JSON.parse(rawList) as UserActivity[];
  } catch {
    return [];
  }
}
