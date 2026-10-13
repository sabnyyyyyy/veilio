import { NextRequest } from 'next/server';
import {
  decodeAuctionStateAccount,
  decodeBidCommitmentAccount,
  getSolanaAuctionProgramId,
  SolanaAuctionState,
} from '@/lib/cross-chain/solanaAuction';
import { decodeBase58, encodeBase58, getAnchorDiscriminator } from '@/lib/cross-chain/solanaServiceRegistry';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function getRpcEndpoints(): string[] {
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

const NO_CACHE = { 'Cache-Control': 'no-store, max-age=0' };
const STATE_NAMES = ['Created', 'Bidding', 'Revealing', 'Inspection', 'Refund requested', 'Under review', 'Completed', 'Refunded', 'Cancelled'];

type RpcAccount = { pubkey: string; account: { data: [string, 'base64'] } };

async function rpc<T>(method: string, params: unknown[]): Promise<T> {
  const endpoints = getRpcEndpoints();
  let lastError: Error | null = null;
  for (const endpoint of endpoints) {
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
        cache: 'no-store',
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) {
        throw new Error(`Solana RPC HTTP ${response.status} from ${endpoint}`);
      }
      const payload = await response.json() as { result?: T; error?: { message?: string } };
      if (payload.error || payload.result === undefined) {
        throw new Error(payload.error?.message || `Solana RPC request failed on ${endpoint}`);
      }
      return payload.result;
    } catch (err: any) {
      lastError = err;
    }
  }
  throw lastError || new Error('Solana RPC request failed across all endpoints');
}

function validPublicKey(value: string) {
  try { return decodeBase58(value).length === 32; } catch { return false; }
}

function accountBytes(account: RpcAccount) {
  return Buffer.from(account.account.data[0], 'base64');
}

function solAmount(lamports: bigint) {
  const whole = lamports / 1_000_000_000n;
  const fraction = (lamports % 1_000_000_000n).toString().padStart(9, '0').replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

async function getProgramAccounts(discriminator: Buffer, wallet: string, offset: number): Promise<RpcAccount[]> {
  return rpc<RpcAccount[]>('getProgramAccounts', [getSolanaAuctionProgramId(), {
    commitment: 'confirmed',
    encoding: 'base64',
    filters: [
      { memcmp: { offset: 0, bytes: encodeBase58(discriminator) } },
      { memcmp: { offset, bytes: wallet } },
    ],
  }]);
}

export async function GET(request: NextRequest) {
  const wallet = request.nextUrl.searchParams.get('wallet') || '';
  if (!validPublicKey(wallet)) {
    return Response.json({ error: 'A valid Solana wallet address is required.' }, { status: 400, headers: NO_CACHE });
  }

  try {
    const [auctionAccounts, bidAccounts] = await Promise.all([
      getProgramAccounts(getAnchorDiscriminator('account', 'AuctionStateAccount'), wallet, 8),
      getProgramAccounts(getAnchorDiscriminator('account', 'BidCommitmentAccount'), wallet, 40),
    ]);

    const decodedAuctions = auctionAccounts.map((account) => ({
      address: account.pubkey,
      value: decodeAuctionStateAccount(accountBytes(account)),
    }));
    const auctionsByAddress = new Map(decodedAuctions.map((item) => [item.address, item.value]));
    const bids = bidAccounts.map((account) => ({
      address: account.pubkey,
      value: decodeBidCommitmentAccount(accountBytes(account)),
    }));
    const missingAuctionAddresses = [...new Set(bids.map(({ value }) => value.auction).filter((address) => !auctionsByAddress.has(address)))];

    for (let start = 0; start < missingAuctionAddresses.length; start += 100) {
      const addresses = missingAuctionAddresses.slice(start, start + 100);
      if (!addresses.length) continue;
      const accounts = await rpc<Array<{ data: [string, 'base64'] } | null>>('getMultipleAccounts', [addresses, { commitment: 'confirmed', encoding: 'base64' }]);
      accounts.forEach((account, index) => {
        if (account) auctionsByAddress.set(addresses[index], decodeAuctionStateAccount(Buffer.from(account.data[0], 'base64')));
      });
    }

    const now = Math.floor(Date.now() / 1000);
    const mappedAuctions = decodedAuctions.map(({ address, value }) => ({
      address,
      id: value.auctionId.toString(),
      itemName: value.itemName,
      description: value.description,
      imageURI: value.imageUri,
      startingPrice: solAmount(value.startingPrice),
      bidderCount: value.bidderCount,
      commitEndTime: value.commitEndTime * 1000,
      revealEndTime: value.revealEndTime * 1000,
      state: value.state,
      reveals: value.revealedCount,
      winner: value.highestBidder,
      winningPrice: solAmount(value.highestBid),
      escrowStatus: STATE_NAMES[value.state] || 'Unknown',
      seller: value.seller,
      status: value.state >= SolanaAuctionState.Inspection
        ? STATE_NAMES[value.state] || 'Completed'
        : now < value.commitEndTime ? 'Bidding'
          : now < value.revealEndTime ? 'Revealing' : 'Ended',
    })).sort((a, b) => Number(b.id) - Number(a.id));

    const mappedBids = bids.map(({ value }) => {
      const auction = auctionsByAddress.get(value.auction);
      if (!auction) return null;
      const revealOpen = auction.state < SolanaAuctionState.Inspection
        && now >= auction.commitEndTime
        && now < auction.revealEndTime;
      const isWinner = auction.state === SolanaAuctionState.Completed && auction.highestBidder === wallet;
      return {
        auctionAddress: value.auction,
        auctionId: auction.auctionId.toString(),
        itemName: auction.itemName,
        deposit: solAmount(value.deposit),
        state: auction.state,
        stateLabel: STATE_NAMES[auction.state] || 'Unknown',
        revealed: value.revealed,
        needsReveal: revealOpen && !value.revealed,
        isWinner,
      };
    }).filter((bid): bid is NonNullable<typeof bid> => bid !== null)
      .sort((a, b) => Number(b.auctionId) - Number(a.auctionId));

    return Response.json({
      network: 'Solana Devnet',
      programId: getSolanaAuctionProgramId(),
      wallet,
      auctions: mappedAuctions,
      bids: mappedBids,
    }, { headers: NO_CACHE });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not load Solana Devnet activity';
    console.error('Failed to load Solana dashboard data:', message);
    return Response.json({ error: message }, { status: 503, headers: NO_CACHE });
  }
}
