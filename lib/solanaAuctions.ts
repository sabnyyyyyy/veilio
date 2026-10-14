import {
  decodeAuctionConfigAccount,
  decodeAuctionStateAccount,
  decodeBidCommitmentAccount,
  findAuctionConfigPda,
  findAuctionPda,
  findBidCommitmentPda,
  getSolanaAuctionProgramId,
  SolanaAuctionState,
  type DecodedAuctionConfig,
  type DecodedAuctionState,
  type DecodedBidCommitment,
} from './cross-chain/solanaAuction';
import {
  decodeBase58,
  encodeBase58,
  getAnchorDiscriminator,
} from './cross-chain/solanaServiceRegistry';
import type { AuctionItem } from './auctionTypes';

export function getSolanaRpcEndpoints(): string[] {
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

export function formatSolLamports(lamports: bigint): string {
  const whole = lamports / 1_000_000_000n;
  const fraction = (lamports % 1_000_000_000n).toString().padStart(9, '0').replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

export function normalizeSolanaAuction(
  decoded: DecodedAuctionState,
  pda?: string
): AuctionItem {
  const now = Date.now();
  const commitEndMs = Number(decoded.commitEndTime) * 1000;
  const revealEndMs = Number(decoded.revealEndTime) * 1000;

  let status: AuctionItem['status'] = 'Settled';
  if (
    decoded.state === SolanaAuctionState.Completed ||
    decoded.state === SolanaAuctionState.Refunded ||
    decoded.state === SolanaAuctionState.Cancelled
  ) {
    status = 'Settled';
  } else if (
    decoded.state === SolanaAuctionState.Inspection ||
    decoded.state === SolanaAuctionState.RefundRequested ||
    decoded.state === SolanaAuctionState.UnderReview
  ) {
    status = 'Settled';
  } else if (now < commitEndMs) {
    status = 'Bidding';
  } else if (now < revealEndMs) {
    status = 'Revealing';
  } else {
    status = 'Settled';
  }

  const programId = getSolanaAuctionProgramId();
  const derivedPda = pda || findAuctionPda(decoded.auctionId, programId).pda;

  return {
    id: decoded.auctionId.toString(),
    itemName: decoded.itemName,
    description: decoded.description,
    imageURI: decoded.imageUri,
    startingPrice: formatSolLamports(decoded.startingPrice),
    bidderCount: decoded.bidderCount,
    commitEndTime: commitEndMs,
    revealEndTime: revealEndMs,
    status,
    seller: decoded.seller,
    contractAddress: programId,
    networkId: 'solana:devnet',
    assetType: 'dataset',
    sellerReputation: {
      completedAuctions: 0,
      deliverySuccessRate: 100,
      verifiedSeller: true,
      score: 80,
    },
  };
}

type RpcAccount = {
  pubkey: string;
  account: {
    data: [string, 'base64'];
    executable: boolean;
    lamports: number;
    owner: string;
  };
};

async function solanaRpcRequest<T>(method: string, params: unknown[]): Promise<T> {
  const endpoints = getSolanaRpcEndpoints();
  let lastError: Error | null = null;

  for (const endpoint of endpoints) {
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method, params }),
        cache: 'no-store',
        signal: AbortSignal.timeout(8000),
      });

      if (!response.ok) {
        throw new Error(`Solana RPC returned status ${response.status} from ${endpoint}`);
      }

      const payload = (await response.json()) as {
        result?: T;
        error?: { code?: number; message?: string };
      };

      if (payload.error) {
        throw new Error(payload.error.message || `RPC call failed on ${endpoint}`);
      }

      if (payload.result === undefined) {
        throw new Error(`Empty response payload from ${endpoint}`);
      }

      return payload.result;
    } catch (err: any) {
      lastError = err;
    }
  }

  throw lastError || new Error('Solana Devnet RPC unavailable on all endpoints.');
}

/**
 * Directly queries Solana Devnet RPC for all veilio-auction accounts.
 */
export async function querySolanaOnchainAuctionsDirectly(): Promise<AuctionItem[]> {
  const programId = getSolanaAuctionProgramId();
  const disc = getAnchorDiscriminator('account', 'AuctionStateAccount');
  const base58Disc = encodeBase58(disc);

  const rawAccounts = await solanaRpcRequest<RpcAccount[]>('getProgramAccounts', [
    programId,
    {
      commitment: 'confirmed',
      encoding: 'base64',
      filters: [{ memcmp: { offset: 0, bytes: base58Disc } }],
    },
  ]);

  if (!rawAccounts || !Array.isArray(rawAccounts)) {
    return [];
  }

  const auctions: AuctionItem[] = [];
  for (const item of rawAccounts) {
    try {
      const buf = Buffer.from(item.account.data[0], 'base64');
      const decoded = decodeAuctionStateAccount(buf);
      auctions.push(normalizeSolanaAuction(decoded, item.pubkey));
    } catch (e) {
      console.warn(`Could not decode Solana auction account ${item.pubkey}:`, e);
    }
  }

  return auctions;
}

/**
 * Fetches auctions for Solana Devnet with fallback to internal API endpoint if on browser.
 */
export async function fetchSolanaOnchainAuctions(): Promise<{
  auctions: AuctionItem[];
  total: string;
}> {
  // If in browser, first try the API route
  if (typeof window !== 'undefined') {
    try {
      const res = await fetch('/api/solana/auctions', {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(10000),
      });

      if (res.ok) {
        const data = await res.json();
        if (data.success && Array.isArray(data.auctions)) {
          return {
            auctions: data.auctions,
            total: String(data.total || data.auctions.length),
          };
        } else if (!data.success && data.error) {
          throw new Error(data.error);
        }
      }
    } catch (clientErr: any) {
      if (clientErr?.message && !clientErr.message.includes('fetch')) {
        throw clientErr;
      }
      // If API route failed, fallback to direct RPC call
    }
  }

  // Direct RPC execution
  const auctions = await querySolanaOnchainAuctionsDirectly();
  return {
    auctions,
    total: String(auctions.length),
  };
}

/**
 * Fetches single auction by ID from Solana Devnet.
 */
export async function fetchSolanaOnchainAuctionById(
  auctionId: string | bigint | number
): Promise<AuctionItem | null> {
  const programId = getSolanaAuctionProgramId();
  const idBigInt = BigInt(auctionId);
  const { pda } = findAuctionPda(idBigInt, programId);

  const accountInfo = await getRpcAccountInfo(pda);

  if (!accountInfo || !accountInfo.data || !accountInfo.data[0]) {
    return null;
  }

  const buf = Buffer.from(accountInfo.data[0], 'base64');
  const decoded = decodeAuctionStateAccount(buf);
  return normalizeSolanaAuction(decoded, pda);
}

/** The all-zero Solana public key, used by the program as "no winner". */
export const SOLANA_DEFAULT_PUBKEY = '11111111111111111111111111111111';

interface RpcAccountInfo {
  data: [string, 'base64'];
  executable?: boolean;
  lamports?: number;
  owner: string;
}

/**
 * JSON-RPC getAccountInfo returns `{ context, value }`; `value` is null for a missing account.
 * Also accepts a bare account object (older stubs) so callers never misread the wrapper.
 */
async function getRpcAccountInfo(pubkey: string): Promise<RpcAccountInfo | null> {
  const raw = await solanaRpcRequest<{ value?: RpcAccountInfo | null } | RpcAccountInfo | null>(
    'getAccountInfo',
    [pubkey, { commitment: 'confirmed', encoding: 'base64' }]
  );
  if (!raw) return null;
  if ('value' in raw) return raw.value ?? null;
  return raw as RpcAccountInfo;
}

async function fetchSolanaAccountData(pubkey: string): Promise<Buffer | null> {
  const accountInfo = await getRpcAccountInfo(pubkey);
  if (!accountInfo || !accountInfo.data || !accountInfo.data[0]) return null;
  if (accountInfo.owner !== getSolanaAuctionProgramId()) return null;
  return Buffer.from(accountInfo.data[0], 'base64');
}

/**
 * Fetches the raw decoded on-chain auction state (all lifecycle fields:
 * reviewer, inspection end, refund request time, evidence hash...).
 * Returns null when the auction PDA does not exist.
 */
export async function fetchSolanaAuctionStateById(
  auctionId: string | bigint | number
): Promise<(DecodedAuctionState & { pda: string }) | null> {
  const { pda } = findAuctionPda(BigInt(auctionId), getSolanaAuctionProgramId());
  const data = await fetchSolanaAccountData(pda);
  if (!data) return null;
  return { ...decodeAuctionStateAccount(data), pda };
}

/**
 * Fetches the global AuctionConfig PDA ([b"auction_config"]) of the upgraded auction program.
 * Returns null before the upgrade / initialize_config (account missing). Its `reviewer` is the
 * only wallet the upgraded program lets sign review_refund, for every auction.
 */
export async function fetchSolanaAuctionConfig(): Promise<DecodedAuctionConfig | null> {
  const { pda } = findAuctionConfigPda(getSolanaAuctionProgramId());
  const data = await fetchSolanaAccountData(pda);
  return data ? decodeAuctionConfigAccount(data) : null;
}

/**
 * Fetches a bidder's commitment PDA for an auction. Returns null when the
 * bidder never committed or the commitment was already closed (refunded/paid).
 */
export async function fetchSolanaBidCommitment(
  auctionId: string | bigint | number,
  bidder: string
): Promise<DecodedBidCommitment | null> {
  const programId = getSolanaAuctionProgramId();
  const { pda: auctionPda } = findAuctionPda(BigInt(auctionId), programId);
  const { pda } = findBidCommitmentPda(auctionPda, bidder, programId);
  const data = await fetchSolanaAccountData(pda);
  return data ? decodeBidCommitmentAccount(data) : null;
}
