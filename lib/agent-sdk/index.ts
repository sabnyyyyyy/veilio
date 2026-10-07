import {
  encodePacked,
  keccak256,
  parseAbi,
  parseEther,
  formatEther,
  type Address,
  type Hex,
  type PublicClient,
  type WalletClient,
} from 'viem';
import { bnbChain } from '../chain';
import { VEIL_V3_CONTRACT_ADDRESS } from '../contract';

const abi = parseAbi([
  'function auctionCount() view returns (uint256)',
  'function auctions(uint256 auctionId) view returns (uint256 id, address seller, string itemName, string description, string imageURI, uint256 startingPrice, uint256 commitEndTime, uint256 revealEndTime, uint256 inspectionDuration, uint256 inspectionEndTime, uint8 state, address highestBidder, uint256 highestBid, uint256 bidderCount, uint256 revealedCount, bytes32 finalTxHash, string evidenceHash, string reviewReason)',
  'function getAuctionState(uint256 auctionId) view returns (uint8)',
  'function commitments(uint256 auctionId, address bidder) view returns (bytes32 commitment, uint256 deposit, bool revealed, uint256 maxBid)',
  'function commitBid(uint256 auctionId, bytes32 commitment) payable',
  'function revealBid(uint256 auctionId, uint256 maxBid, bytes32 secret)',
  'function acceptDataset(uint256 auctionId)',
]);

export const VEILIO_CHAIN_ID = bnbChain.id;
export const VEILIO_CONTRACT_ADDRESS = VEIL_V3_CONTRACT_ADDRESS;
export const AUCTION_STATES = ['Created', 'Bidding', 'Revealing', 'Inspection', 'RefundRequested', 'UnderReview', 'Completed', 'Refunded', 'Cancelled'] as const;
export type AuctionState = (typeof AUCTION_STATES)[number];

export interface VeilioAuction {
  id: bigint;
  seller: Address;
  itemName: string;
  description: string;
  imageURI: string;
  startingPriceWei: bigint;
  commitEndTime: bigint;
  revealEndTime: bigint;
  inspectionDuration: bigint;
  inspectionEndTime: bigint;
  state: AuctionState;
  highestBidder: Address;
  highestBidWei: bigint;
  bidderCount: bigint;
  revealedCount: bigint;
}

export interface PreparedBid {
  auctionId: string;
  bidder: Address;
  maxBidWei: string;
  secret: Hex;
  commitment: Hex;
  chainId: number;
  contractAddress: Address;
}

export interface AssetSearchFilter {
  query?: string;
  category?: string;
  license?: string;
  limit?: number;
}

export interface AgentAssetSummary {
  id: string;
  title: string;
  description: string;
  category: string;
  license: { type: string; usage_rights: string };
  format?: string;
  file_size?: string;
  region?: string;
  language?: string;
  agent_compatible: boolean;
  auction: {
    auction_id: string;
    state: string;
    starting_price_bnb: string;
    bidder_count: number;
    commit_end_time: number;
    reveal_end_time: number;
  };
}

export interface VeilioAgentOptions {
  publicClient: PublicClient;
  walletClient?: WalletClient;
  account?: Address;
  contractAddress?: Address;
  apiBaseUrl?: string;
}

function getAccount(options: VeilioAgentOptions): Address {
  const account = options.account ?? (typeof options.walletClient?.account === 'string' ? options.walletClient.account : options.walletClient?.account?.address);
  if (!account) throw new Error('Provide an agent wallet account address.');
  return account;
}

function stateName(value: number): AuctionState {
  const state = AUCTION_STATES[value];
  if (!state) throw new Error(`Unknown auction state: ${value}`);
  return state;
}

export function createVeilioAgent(options: VeilioAgentOptions) {
  const address = options.contractAddress ?? VEILIO_CONTRACT_ADDRESS;
  const apiBase = (options.apiBaseUrl || '').replace(/\/$/, '');

  async function getAuction(auctionId: bigint | number | string): Promise<VeilioAuction> {
    const id = BigInt(auctionId);
    if (id <= 0n) throw new Error('auctionId must be a positive integer.');
    const [raw, currentState] = await Promise.all([
      options.publicClient.readContract({ address, abi, functionName: 'auctions', args: [id] }),
      options.publicClient.readContract({ address, abi, functionName: 'getAuctionState', args: [id] }),
    ]);
    if (raw[0] === 0n) throw new Error(`Auction ${id} does not exist.`);
    return {
      id: raw[0], seller: raw[1], itemName: raw[2], description: raw[3], imageURI: raw[4],
      startingPriceWei: raw[5], commitEndTime: raw[6], revealEndTime: raw[7],
      inspectionDuration: raw[8], inspectionEndTime: raw[9], state: stateName(Number(currentState)),
      highestBidder: raw[11], highestBidWei: raw[12], bidderCount: raw[13], revealedCount: raw[14],
    };
  }

  async function listAuctions(input: { cursor?: bigint | number | string; limit?: number } = {}) {
    const count = await options.publicClient.readContract({ address, abi, functionName: 'auctionCount' });
    const limit = Math.min(Math.max(Math.trunc(input.limit ?? 20), 1), 50);
    const start = input.cursor === undefined ? count : BigInt(input.cursor);
    if (start < 0n) throw new Error('cursor cannot be negative.');
    const ids: bigint[] = [];
    for (let id = start; id > 0n && ids.length < limit; id--) ids.push(id);
    const auctions = await Promise.all(ids.map((id) => getAuction(id)));
    const next = ids.length === limit && ids.at(-1)! > 1n ? (ids.at(-1)! - 1n).toString() : null;
    return { auctions, nextCursor: next };
  }

  async function searchAssets(filter: AssetSearchFilter = {}): Promise<AgentAssetSummary[]> {
    try {
      const params = new URLSearchParams();
      if (filter.query) params.set('query', filter.query);
      if (filter.category) params.set('category', filter.category);
      if (filter.license) params.set('license', filter.license);
      if (filter.limit) params.set('limit', String(filter.limit));

      const endpoint = `${apiBase}/api/agent/v1/assets?${params.toString()}`;
      const res = await fetch(endpoint);
      if (res.ok) {
        const json = await res.json();
        return json.data || [];
      }
    } catch {
      // Fallback to on-chain iteration
    }

    const { auctions } = await listAuctions({ limit: filter.limit ?? 10 });
    return auctions.map((a) => ({
      id: a.id.toString(),
      title: a.itemName,
      description: a.description,
      category: 'dataset',
      license: { type: 'commercial_use', usage_rights: 'Standard digital asset terms' },
      agent_compatible: true,
      auction: {
        auction_id: a.id.toString(),
        state: a.state,
        starting_price_bnb: formatEther(a.startingPriceWei),
        bidder_count: Number(a.bidderCount),
        commit_end_time: Number(a.commitEndTime),
        reveal_end_time: Number(a.revealEndTime),
      },
    }));
  }

  async function getAssetDetails(assetId: string | number | bigint) {
    try {
      const endpoint = `${apiBase}/api/agent/v1/assets/${assetId}`;
      const res = await fetch(endpoint);
      if (res.ok) {
        const json = await res.json();
        return json.data;
      }
    } catch {
      // Fallback to auction lookup
    }
    const auction = await getAuction(assetId);
    return {
      id: auction.id.toString(),
      title: auction.itemName,
      description: auction.description,
      category: 'dataset',
      auction: {
        auction_id: auction.id.toString(),
        state: auction.state,
        starting_price_bnb: formatEther(auction.startingPriceWei),
      },
    };
  }

  async function evaluateAsset(assetId: string | number | bigint, criteria?: { maxBudgetBnb?: number; preferredLicense?: string }) {
    const details = await getAssetDetails(assetId);
    const startingPrice = parseFloat(details?.auction?.starting_price_bnb || '0');
    const fitsBudget = criteria?.maxBudgetBnb ? startingPrice <= criteria.maxBudgetBnb : true;
    const licenseType = details?.license?.type || 'commercial_use';
    const fitsLicense = criteria?.preferredLicense ? licenseType === criteria.preferredLicense : true;

    return {
      assetId: String(assetId),
      recommended: fitsBudget && fitsLicense,
      evaluation: {
        fitsBudget,
        fitsLicense,
        startingPriceBnb: startingPrice,
        licenseType,
        category: details?.category || 'digital-asset',
      },
    };
  }

  function prepareBid(auctionId: bigint | number | string, maxBid: string): PreparedBid {
    const bidder = getAccount(options);
    const id = BigInt(auctionId);
    const maxBidWei = parseEther(String(maxBid));
    if (id <= 0n || maxBidWei <= 0n) throw new Error('auctionId and maxBid must be positive.');
    const cryptoApi = globalThis.crypto;
    if (!cryptoApi?.getRandomValues) throw new Error('A cryptographically secure random generator is required to create a bid secret.');
    const bytes = cryptoApi.getRandomValues(new Uint8Array(32));
    const secret = `0x${Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')}` as Hex;
    const commitment = keccak256(encodePacked(
      ['uint256', 'address', 'uint256', 'bytes32'],
      [id, bidder, maxBidWei, secret],
    ));
    return { auctionId: id.toString(), bidder, maxBidWei: maxBidWei.toString(), secret, commitment, chainId: VEILIO_CHAIN_ID, contractAddress: address };
  }

  async function commitBid(prepared: PreparedBid, deposit: string) {
    const walletClient = options.walletClient;
    if (!walletClient) throw new Error('A walletClient is required to submit transactions.');
    if (prepared.chainId !== VEILIO_CHAIN_ID || prepared.contractAddress.toLowerCase() !== address.toLowerCase()) throw new Error('Prepared bid belongs to a different chain or contract.');
    if (prepared.bidder.toLowerCase() !== getAccount(options).toLowerCase()) throw new Error('Prepared bid wallet does not match the connected agent wallet.');
    const depositWei = parseEther(String(deposit));
    const auction = await getAuction(prepared.auctionId);
    if (auction.state !== 'Bidding') throw new Error(`Auction is ${auction.state}; it is not accepting commitments.`);
    if (depositWei < auction.startingPriceWei) throw new Error('Deposit must meet the auction starting price.');
    if (depositWei < BigInt(prepared.maxBidWei)) throw new Error('Deposit must cover the maximum bid.');
    const commitment = await options.publicClient.readContract({ address, abi, functionName: 'commitments', args: [BigInt(prepared.auctionId), prepared.bidder] });
    if (commitment[0] !== `0x${'0'.repeat(64)}`) throw new Error('This wallet already committed to this auction.');
    return walletClient.writeContract({ address, abi, functionName: 'commitBid', args: [BigInt(prepared.auctionId), prepared.commitment], value: depositWei, account: walletClient.account ?? getAccount(options), chain: walletClient.chain ?? undefined });
  }

  async function revealBid(prepared: PreparedBid) {
    const walletClient = options.walletClient;
    if (!walletClient) throw new Error('A walletClient is required to submit transactions.');
    if (prepared.chainId !== VEILIO_CHAIN_ID || prepared.contractAddress.toLowerCase() !== address.toLowerCase()) throw new Error('Prepared bid belongs to a different chain or contract.');
    if (prepared.bidder.toLowerCase() !== getAccount(options).toLowerCase()) throw new Error('Prepared bid wallet does not match the connected agent wallet.');
    const auction = await getAuction(prepared.auctionId);
    if (auction.state !== 'Revealing') throw new Error(`Auction is ${auction.state}; it is not accepting reveals.`);
    const commitment = await options.publicClient.readContract({ address, abi, functionName: 'commitments', args: [BigInt(prepared.auctionId), prepared.bidder] });
    if (commitment[0] !== prepared.commitment || commitment[2]) throw new Error('On-chain commitment is missing, mismatched, or already revealed.');
    const expected = keccak256(encodePacked(
      ['uint256', 'address', 'uint256', 'bytes32'],
      [BigInt(prepared.auctionId), prepared.bidder, BigInt(prepared.maxBidWei), prepared.secret],
    ));
    if (expected !== prepared.commitment) throw new Error('Prepared bid secret does not match its commitment.');
    return walletClient.writeContract({ address, abi, functionName: 'revealBid', args: [BigInt(prepared.auctionId), BigInt(prepared.maxBidWei), prepared.secret], account: walletClient.account ?? getAccount(options), chain: walletClient.chain ?? undefined });
  }

  async function getAuctionResult(auctionId: bigint | number | string) {
    const auction = await getAuction(auctionId);
    const agentAddress = getAccount(options).toLowerCase();
    const isWinner = auction.highestBidder.toLowerCase() === agentAddress;
    return {
      auctionId: String(auctionId),
      state: auction.state,
      isWinner,
      highestBidder: auction.highestBidder,
      winningBidBnb: formatEther(auction.highestBidWei),
    };
  }

  async function claimAsset(auctionId: bigint | number | string) {
    const walletClient = options.walletClient;
    if (!walletClient) throw new Error('A walletClient is required to submit transactions.');
    return walletClient.writeContract({
      address,
      abi,
      functionName: 'acceptDataset',
      args: [BigInt(auctionId)],
      account: walletClient.account ?? getAccount(options),
      chain: walletClient.chain ?? undefined,
    });
  }

  async function getLicense(auctionId: bigint | number | string) {
    const details = await getAssetDetails(auctionId);
    return {
      auctionId: String(auctionId),
      assetTitle: details?.title,
      license: details?.license,
      verificationUrl: `/verify/${auctionId}`,
    };
  }

  return {
    address,
    chainId: VEILIO_CHAIN_ID,
    getAuction,
    listAuctions,
    searchAssets,
    getAssetDetails,
    evaluateAsset,
    prepareBid,
    commitBid,
    revealBid,
    getAuctionResult,
    claimAsset,
    getLicense,
  };
}
