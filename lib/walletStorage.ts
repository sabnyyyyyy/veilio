import { getUserActivities, type UserActivity } from './secretStorage';

export const SOLANA_WALLET_STORAGE_KEY = 'veilio_solana_wallet';
export const SERVICE_ACTIVITIES_KEY_PREFIX = 'veilio_service_act_';
export const ACTIVITY_UPDATED_EVENT = 'veilio_activity_updated';

export interface ServiceActivityItem {
  id: string;
  type: 'service_order_funded' | 'service_order_completed' | 'service_order_disputed' | 'payment_request_created';
  orderId: string;
  title: string;
  amount: string;
  currency: string;
  userAddress: string;
  role: 'buyer' | 'seller';
  txHash?: string;
  networkId: 'bnb:97' | 'base:84532' | 'solana:devnet';
  timestamp: number;
  status: string;
  isOnChainConfirmed: boolean;
}

export interface MergedActivityItem {
  id: string;
  kind: 'auction' | 'service';
  type: string;
  targetId: string; // auctionId or orderId
  title: string;
  amount?: string;
  currency?: string;
  userAddress: string;
  txHash?: string;
  networkId?: 'bnb:97' | 'base:84532' | 'solana:devnet';
  timestamp: number;
  status?: string;
  isOnChainConfirmed: boolean;
  href: string;
}

/**
 * Validates a Solana public key address (base58, 32-44 chars).
 */
export function isSolanaAddress(address?: string | null): boolean {
  if (!address || typeof address !== 'string') return false;
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address.trim());
}

/**
 * Reads currently connected or cached Solana wallet address.
 */
export function getConnectedSolanaAddress(): string | null {
  if (typeof window === 'undefined') return null;

  try {
    const injected = (window as any).solana;
    if (injected?.publicKey) {
      const pubkey = injected.publicKey.toString();
      if (isSolanaAddress(pubkey)) {
        localStorage.setItem(SOLANA_WALLET_STORAGE_KEY, pubkey);
        return pubkey;
      }
    }

    const cached = localStorage.getItem(SOLANA_WALLET_STORAGE_KEY);
    if (cached && isSolanaAddress(cached)) {
      return cached;
    }
  } catch {
    // ignore
  }

  return null;
}

/**
 * Updates stored Solana wallet address in localStorage and notifies listeners.
 */
export function setStoredSolanaAddress(address: string | null): void {
  if (typeof window === 'undefined') return;
  try {
    if (address && isSolanaAddress(address)) {
      localStorage.setItem(SOLANA_WALLET_STORAGE_KEY, address.trim());
    } else {
      localStorage.removeItem(SOLANA_WALLET_STORAGE_KEY);
    }
    notifyActivityUpdated();
  } catch {
    // ignore
  }
}

/**
 * Saves a service activity item to localStorage and broadcasts update event.
 */
export function saveServiceActivity(activity: ServiceActivityItem): void {
  if (typeof window === 'undefined' || !activity.userAddress) return;

  const storageKey = `${SERVICE_ACTIVITIES_KEY_PREFIX}${activity.userAddress.toLowerCase()}`;
  let list: ServiceActivityItem[] = [];

  try {
    const raw = localStorage.getItem(storageKey);
    if (raw) {
      list = JSON.parse(raw);
    }
  } catch {
    list = [];
  }

  // Deduplicate by id or orderId+type
  list = list.filter((item) => item.id !== activity.id && !(item.orderId === activity.orderId && item.type === activity.type));
  list.unshift(activity);

  try {
    localStorage.setItem(storageKey, JSON.stringify(list.slice(0, 30)));
  } catch {
    // ignore quota errors
  }

  notifyActivityUpdated();
}

/**
 * Retrieves service activity items for a given wallet address.
 */
export function getServiceActivities(userAddress?: string | null): ServiceActivityItem[] {
  if (typeof window === 'undefined' || !userAddress) return [];

  const storageKey = `${SERVICE_ACTIVITIES_KEY_PREFIX}${userAddress.toLowerCase()}`;
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return [];
    return JSON.parse(raw) as ServiceActivityItem[];
  } catch {
    return [];
  }
}

/**
 * Broadcasts an activity update event so the dashboard refreshes immediately
 * across components or browser tabs without requiring a full restart.
 */
export function notifyActivityUpdated(): void {
  if (typeof window === 'undefined') return;
  try {
    window.dispatchEvent(new CustomEvent(ACTIVITY_UPDATED_EVENT));
  } catch {
    // ignore
  }
}

/**
 * Subscribes to activity and storage events. Returns an unsubscribe function.
 */
export function subscribeToActivityUpdates(callback: () => void): () => void {
  if (typeof window === 'undefined') return () => {};

  const handleCustom = () => {
    callback();
  };

  const handleStorage = (event: StorageEvent) => {
    if (
      event.key?.startsWith(SERVICE_ACTIVITIES_KEY_PREFIX) ||
      event.key?.startsWith('veilio_activity_') ||
      event.key === SOLANA_WALLET_STORAGE_KEY
    ) {
      callback();
    }
  };

  window.addEventListener(ACTIVITY_UPDATED_EVENT, handleCustom);
  window.addEventListener('storage', handleStorage);

  return () => {
    window.removeEventListener(ACTIVITY_UPDATED_EVENT, handleCustom);
    window.removeEventListener('storage', handleStorage);
  };
}

/**
 * Merges auction activities and service activities for all linked user addresses,
 * ensuring unconfirmed/unfunded chat payment requests are clearly distinguished
 * from verified on-chain orders.
 */
export function getMergedActivities(
  evmAddress?: string | null,
  solanaAddress?: string | null
): MergedActivityItem[] {
  const items: MergedActivityItem[] = [];
  const seenIds = new Set<string>();

  const addressesToQuery: string[] = [];
  if (evmAddress) addressesToQuery.push(evmAddress);
  if (solanaAddress && !addressesToQuery.includes(solanaAddress)) {
    addressesToQuery.push(solanaAddress);
  }

  for (const addr of addressesToQuery) {
    // 1. Auction activities
    const auctionActs: UserActivity[] = getUserActivities(addr);
    for (const act of auctionActs) {
      if (seenIds.has(act.id)) continue;
      seenIds.add(act.id);

      items.push({
        id: act.id,
        kind: 'auction',
        type: act.type,
        targetId: act.auctionId,
        title: act.itemName || `Auction #${act.auctionId}`,
        amount: act.amount,
        userAddress: act.userAddress,
        txHash: act.txHash,
        networkId: act.networkId,
        timestamp: act.timestamp,
        isOnChainConfirmed: true,
        href: `/auctions/${act.auctionId}`,
      });
    }

    // 2. Service activities
    const serviceActs: ServiceActivityItem[] = getServiceActivities(addr);
    for (const sAct of serviceActs) {
      if (seenIds.has(sAct.id)) continue;
      seenIds.add(sAct.id);

      items.push({
        id: sAct.id,
        kind: 'service',
        type: sAct.type,
        targetId: sAct.orderId,
        title: sAct.title || `Service Order #${sAct.orderId}`,
        amount: sAct.amount,
        currency: sAct.currency,
        userAddress: sAct.userAddress,
        txHash: sAct.txHash,
        networkId: sAct.networkId,
        timestamp: sAct.timestamp,
        status: sAct.status,
        isOnChainConfirmed: sAct.isOnChainConfirmed,
        href: `/services/orders/${sAct.orderId}`,
      });
    }
  }

  // Sort newest first
  return items.sort((a, b) => b.timestamp - a.timestamp);
}
