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
}

const STORAGE_KEY_PREFIX = 'blindbid_secret_';
const AUCTIONS_KEY_PREFIX = 'blindbid_user_auction_';
const ACTIVITIES_KEY_PREFIX = 'blindbid_activity_';

export function saveBidSecret(data: StoredSecret) {
  if (typeof window === 'undefined') return;
  const key = `${STORAGE_KEY_PREFIX}${data.auctionId}_${data.bidder.toLowerCase()}`;
  localStorage.setItem(key, JSON.stringify(data));

  // Record activity
  saveUserActivity({
    id: `act_${Date.now()}`,
    type: 'bid_committed',
    auctionId: data.auctionId,
    itemName: `Auction #${data.auctionId}`,
    amount: data.maxBid,
    timestamp: Date.now(),
    userAddress: data.bidder,
    txHash: data.commitment,
  });
}

export function getBidSecret(auctionId: string | number, bidder: string): StoredSecret | null {
  if (typeof window === 'undefined') return null;
  const key = `${STORAGE_KEY_PREFIX}${auctionId}_${bidder.toLowerCase()}`;
  const raw = localStorage.getItem(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as StoredSecret;
  } catch {
    return null;
  }
}

export function getAllUserSecrets(bidder: string): StoredSecret[] {
  if (typeof window === 'undefined' || !bidder) return [];
  const results: StoredSecret[] = [];
  const target = bidder.toLowerCase();
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && key.startsWith(STORAGE_KEY_PREFIX) && key.endsWith(`_${target}`)) {
      try {
        const item = JSON.parse(localStorage.getItem(key) || '');
        if (item) results.push(item);
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
  const target = seller.toLowerCase();
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && key.startsWith(AUCTIONS_KEY_PREFIX) && key.endsWith(`_${target}`)) {
      try {
        const item = JSON.parse(localStorage.getItem(key) || '');
        if (item) results.push(item);
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
