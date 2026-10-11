import {
  encodePacked,
  keccak256,
  parseAbi,
  parseEther,
  formatEther,
  stringToHex,
  isAddress,
  type Address,
  type Hex,
  type PublicClient,
  type WalletClient,
  type TransactionReceipt,
} from 'viem';
import { bnbChain } from '../chain';
import { VEIL_V3_CONTRACT_ADDRESS } from '../contract';

// ============================================================================
// Core Constants & Network Configuration
// ============================================================================

export const VEILIO_CHAIN_ID = bnbChain.id;
export const VEILIO_CONTRACT_ADDRESS = VEIL_V3_CONTRACT_ADDRESS;

/**
 * Dedicated contract address for VEILIO Services Escrow.
 * Isolated from the auction / marketplace contract.
 * Note: Must be supplied via environment variable NEXT_PUBLIC_SERVICE_ESCROW_CONTRACT_ADDRESS.
 * No unverified hardcoded fallback is permitted.
 */
export const VEILIO_SERVICES_CONTRACT_ADDRESS = (
  (typeof process !== 'undefined' ? process.env.NEXT_PUBLIC_SERVICE_ESCROW_CONTRACT_ADDRESS : '') || ''
) as Address;

// ============================================================================
// Auction & Asset Marketplace ABI & Types (Preserved for 100% Backward Compatibility)
// ============================================================================

const abi = parseAbi([
  'function auctionCount() view returns (uint256)',
  'function auctions(uint256 auctionId) view returns (uint256 id, address seller, string itemName, string description, string imageURI, uint256 startingPrice, uint256 commitEndTime, uint256 revealEndTime, uint256 inspectionDuration, uint256 inspectionEndTime, uint8 state, address highestBidder, uint256 highestBid, uint256 bidderCount, uint256 revealedCount, bytes32 finalTxHash, string evidenceHash, string reviewReason)',
  'function getAuctionState(uint256 auctionId) view returns (uint8)',
  'function commitments(uint256 auctionId, address bidder) view returns (bytes32 commitment, uint256 deposit, bool revealed, uint256 maxBid)',
  'function commitBid(uint256 auctionId, bytes32 commitment) payable',
  'function revealBid(uint256 auctionId, uint256 maxBid, bytes32 secret)',
  'function acceptDataset(uint256 auctionId)',
]);

export const AUCTION_STATES = [
  'Created',
  'Bidding',
  'Revealing',
  'Inspection',
  'RefundRequested',
  'UnderReview',
  'Completed',
  'Refunded',
  'Cancelled',
] as const;
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
  servicesContractAddress?: Address;
  apiBaseUrl?: string;
}

// ============================================================================
// Services Escrow ABI & Types (New Dedicated Module)
// ============================================================================

export const serviceEscrowAbi = parseAbi([
  'function deposit(bytes32 orderId, address seller, uint256 deadline) payable',
  'function submitDelivery(bytes32 orderId, string deliverableReference)',
  'function releaseFunds(bytes32 orderId)',
  'function refund(bytes32 orderId, string reason)',
  'function cancelOrder(bytes32 orderId, string reason)',
  'function dispute(bytes32 orderId, string reason)',
  'function resolveDispute(bytes32 orderId, uint8 splitToBuyerPercent)',
  'function withdrawPending()',
  'function pendingWithdrawals(address user) view returns (uint256)',
  'function getOrder(bytes32 orderId) view returns ((bytes32 orderId, address buyer, address seller, uint256 amount, uint256 deadline, uint8 status, uint256 createdAt, uint256 settledAt, string deliverableReference))',
  'function platformFeeBasisPoints() view returns (uint256)',
  'function feeRecipient() view returns (address)',
  'function reviewer() view returns (address)',
  'function owner() view returns (address)',
  'event OrderFunded(bytes32 indexed orderId, address indexed buyer, address indexed seller, uint256 amount, uint256 deadline)',
  'event DeliverySubmitted(bytes32 indexed orderId, address indexed seller, string deliverableReference)',
  'event OrderReleased(bytes32 indexed orderId, address indexed buyer, address indexed seller, uint256 sellerAmount, uint256 feeAmount)',
  'event OrderRefunded(bytes32 indexed orderId, address indexed buyer, uint256 refundAmount, string reason)',
  'event OrderDisputed(bytes32 indexed orderId, address indexed openedBy, string reason)',
  'event DisputeResolved(bytes32 indexed orderId, uint256 buyerShare, uint256 sellerShare)',
  'event WithdrawalPending(address indexed recipient, uint256 amount)',
  'event WithdrawalClaimed(address indexed recipient, uint256 amount)',
]);

export const SERVICE_ESCROW_STATES = [
  'None',
  'Funded',
  'Released',
  'Refunded',
  'Disputed',
  'Delivered',
] as const;
export type ServiceEscrowState = (typeof SERVICE_ESCROW_STATES)[number];

export interface VeilioServiceOrderOnChain {
  orderId: Hex;
  buyer: Address;
  seller: Address;
  amountWei: bigint;
  amountBnb: string;
  deadline: bigint;
  status: ServiceEscrowState;
  createdAt: bigint;
  settledAt: bigint;
  deliverableReference: string;
}

export interface DepositServiceOrderInput {
  orderId: Hex | string;
  seller: Address;
  deadline: bigint | number;
  amountBnb: string;
}

export interface DisputeFindingPayload {
  claim: string;
  assessment: 'supported' | 'unsupported' | 'inconclusive';
  evidenceReferences: string[];
  explanation: string;
}

export interface DisputeDistributionPayload {
  buyerRefundPercent: number;
  sellerGrossAwardPercent: number;
  platformFeePercent: 5;
  sellerNetPayoutCalculation: string;
}

export interface DisputeRecommendationPayload {
  disputeId: string;
  orderId: string;
  policyVersion: string;
  summary: string;
  findings: DisputeFindingPayload[];
  cancellationAssessment: {
    validity: 'valid' | 'invalid' | 'partially_valid' | 'inconclusive';
    reason: string;
  };
  recommendedDistribution: DisputeDistributionPayload;
  confidence: {
    level: 'low' | 'medium' | 'high';
    explanation: string;
    isCalibratedProbability: false;
  };
  missingEvidence: string[];
  escalation: {
    required: boolean;
    reason: string;
  };
  limitations: string[];
}

export interface VeilioServicesOptions {
  publicClient: PublicClient;
  walletClient?: WalletClient;
  account?: Address;
  contractAddress?: Address;
  chainId?: number;
}

export interface ServicesTxResult {
  txHash: Hex;
  status: 'submitted';
  wait: () => Promise<TransactionReceipt>;
}

export function formatServiceOrderId(orderId: Hex | string): Hex {
  if (typeof orderId === 'string' && orderId.startsWith('0x') && orderId.length === 66) {
    return orderId as Hex;
  }
  return stringToHex(orderId, { size: 32 });
}

function serviceStateName(value: number): ServiceEscrowState {
  const state = SERVICE_ESCROW_STATES[value];
  if (!state) throw new Error(`Unknown service escrow state: ${value}`);
  return state;
}

// ============================================================================
// Dedicated Services Escrow Client Factory
// ============================================================================

export function createVeilioServicesClient(options: VeilioServicesOptions) {
  const targetChainId = options.chainId ?? VEILIO_CHAIN_ID;
  if (targetChainId !== VEILIO_CHAIN_ID) {
    throw new Error(
      `Invalid chain ID ${targetChainId}. VEILIO Services operates on BNB Chain (chain ID ${VEILIO_CHAIN_ID}).`
    );
  }

  const address =
    options.contractAddress !== undefined
      ? options.contractAddress
      : (typeof process !== 'undefined'
          ? (process.env.NEXT_PUBLIC_SERVICE_ESCROW_CONTRACT_ADDRESS as Address | undefined)
          : undefined) || VEILIO_SERVICES_CONTRACT_ADDRESS;

  if (
    !address ||
    typeof address !== 'string' ||
    !isAddress(address) ||
    address === '0x0000000000000000000000000000000000000000'
  ) {
    throw new Error(
      'NEXT_PUBLIC_SERVICE_ESCROW_CONTRACT_ADDRESS is missing or invalid. Please configure a valid deployed VeilServiceEscrow contract address.'
    );
  }

  if (address.toLowerCase() === VEILIO_CONTRACT_ADDRESS.toLowerCase()) {
    throw new Error(
      'Invalid Services contract address: cannot use the VEILIO auction contract address for Services escrow.'
    );
  }

  function getServicesAccount(): Address {
    const acc =
      options.account ??
      (typeof options.walletClient?.account === 'string'
        ? options.walletClient.account
        : options.walletClient?.account?.address);
    if (!acc) throw new Error('Provide a wallet account address to execute this Services contract transaction.');
    return acc;
  }

  function assertWalletChain(walletClient?: WalletClient) {
    if (walletClient?.chain && walletClient.chain.id !== VEILIO_CHAIN_ID) {
      throw new Error(
        `Connected wallet chain ID (${walletClient.chain.id}) does not match required BNB Chain testnet (${VEILIO_CHAIN_ID}).`
      );
    }
  }

  function makeTxResult(txHash: Hex): ServicesTxResult {
    return {
      txHash,
      status: 'submitted',
      wait: async () => {
        const receipt = await options.publicClient.waitForTransactionReceipt({ hash: txHash });
        if (receipt.status === 'reverted') {
          throw new Error(`Transaction ${txHash} reverted on-chain.`);
        }
        return receipt;
      },
    };
  }

  async function getOrder(orderId: Hex | string): Promise<VeilioServiceOrderOnChain | null> {
    const id = formatServiceOrderId(orderId);
    const raw = await options.publicClient.readContract({
      address,
      abi: serviceEscrowAbi,
      functionName: 'getOrder',
      args: [id],
    });

    if (raw.status === 0 && raw.amount === 0n) {
      return null;
    }

    return {
      orderId: raw.orderId,
      buyer: raw.buyer,
      seller: raw.seller,
      amountWei: raw.amount,
      amountBnb: formatEther(raw.amount),
      deadline: raw.deadline,
      status: serviceStateName(raw.status),
      createdAt: raw.createdAt,
      settledAt: raw.settledAt,
      deliverableReference: raw.deliverableReference,
    };
  }

  async function deposit(input: DepositServiceOrderInput): Promise<ServicesTxResult> {
    const walletClient = options.walletClient;
    if (!walletClient) throw new Error('A walletClient is required to deposit escrow funds.');
    assertWalletChain(walletClient);

    const id = formatServiceOrderId(input.orderId);
    const value = parseEther(input.amountBnb);
    const deadlineBigInt = BigInt(input.deadline);

    if (value <= 0n) throw new Error('Deposit amount must be greater than zero.');
    if (deadlineBigInt <= BigInt(Math.floor(Date.now() / 1000))) {
      throw new Error('Deadline must be in the future.');
    }

    const txHash = await walletClient.writeContract({
      address,
      abi: serviceEscrowAbi,
      functionName: 'deposit',
      args: [id, input.seller, deadlineBigInt],
      value,
      account: walletClient.account ?? getServicesAccount(),
      chain: walletClient.chain ?? undefined,
    });

    return makeTxResult(txHash);
  }

  async function submitDelivery(
    orderId: Hex | string,
    deliverableReference: string
  ): Promise<ServicesTxResult> {
    const walletClient = options.walletClient;
    if (!walletClient) throw new Error('A walletClient is required to submit deliverables.');
    assertWalletChain(walletClient);
    if (!deliverableReference.trim()) throw new Error('Deliverable reference cannot be empty.');

    const id = formatServiceOrderId(orderId);
    const txHash = await walletClient.writeContract({
      address,
      abi: serviceEscrowAbi,
      functionName: 'submitDelivery',
      args: [id, deliverableReference.trim()],
      account: walletClient.account ?? getServicesAccount(),
      chain: walletClient.chain ?? undefined,
    });

    return makeTxResult(txHash);
  }

  async function releaseFunds(orderId: Hex | string): Promise<ServicesTxResult> {
    const walletClient = options.walletClient;
    if (!walletClient) throw new Error('A walletClient is required to release escrow funds.');
    assertWalletChain(walletClient);

    const id = formatServiceOrderId(orderId);
    const txHash = await walletClient.writeContract({
      address,
      abi: serviceEscrowAbi,
      functionName: 'releaseFunds',
      args: [id],
      account: walletClient.account ?? getServicesAccount(),
      chain: walletClient.chain ?? undefined,
    });

    return makeTxResult(txHash);
  }

  async function refund(orderId: Hex | string, reason: string): Promise<ServicesTxResult> {
    const walletClient = options.walletClient;
    if (!walletClient) throw new Error('A walletClient is required to refund escrow funds.');
    assertWalletChain(walletClient);

    const id = formatServiceOrderId(orderId);
    const txHash = await walletClient.writeContract({
      address,
      abi: serviceEscrowAbi,
      functionName: 'refund',
      args: [id, reason || 'Refund requested'],
      account: walletClient.account ?? getServicesAccount(),
      chain: walletClient.chain ?? undefined,
    });

    return makeTxResult(txHash);
  }

  async function cancelOrder(orderId: Hex | string, reason: string): Promise<ServicesTxResult> {
    const walletClient = options.walletClient;
    if (!walletClient) throw new Error('A walletClient is required to cancel the escrow order.');
    assertWalletChain(walletClient);

    const id = formatServiceOrderId(orderId);
    const txHash = await walletClient.writeContract({
      address,
      abi: serviceEscrowAbi,
      functionName: 'cancelOrder',
      args: [id, reason || 'Order cancelled'],
      account: walletClient.account ?? getServicesAccount(),
      chain: walletClient.chain ?? undefined,
    });

    return makeTxResult(txHash);
  }

  async function refundTimeout(orderId: Hex | string, reason?: string): Promise<ServicesTxResult> {
    return cancelOrder(orderId, reason || 'Buyer timeout refund');
  }

  async function dispute(orderId: Hex | string, reason: string): Promise<ServicesTxResult> {
    const walletClient = options.walletClient;
    if (!walletClient) throw new Error('A walletClient is required to dispute the escrow order.');
    assertWalletChain(walletClient);

    const id = formatServiceOrderId(orderId);
    const txHash = await walletClient.writeContract({
      address,
      abi: serviceEscrowAbi,
      functionName: 'dispute',
      args: [id, reason || 'Dispute escalated'],
      account: walletClient.account ?? getServicesAccount(),
      chain: walletClient.chain ?? undefined,
    });

    return makeTxResult(txHash);
  }

  async function resolveDispute(
    orderId: Hex | string,
    splitToBuyerPercent: number
  ): Promise<ServicesTxResult> {
    const walletClient = options.walletClient;
    if (!walletClient) throw new Error('A walletClient is required to resolve dispute.');
    assertWalletChain(walletClient);
    if (splitToBuyerPercent < 0 || splitToBuyerPercent > 100) {
      throw new Error('Split percentage must be between 0 and 100.');
    }

    const id = formatServiceOrderId(orderId);
    const txHash = await walletClient.writeContract({
      address,
      abi: serviceEscrowAbi,
      functionName: 'resolveDispute',
      args: [id, splitToBuyerPercent],
      account: walletClient.account ?? getServicesAccount(),
      chain: walletClient.chain ?? undefined,
    });

    return makeTxResult(txHash);
  }

  async function withdrawPending(): Promise<ServicesTxResult> {
    const walletClient = options.walletClient;
    if (!walletClient) throw new Error('A walletClient is required to claim pending withdrawals.');
    assertWalletChain(walletClient);

    const txHash = await walletClient.writeContract({
      address,
      abi: serviceEscrowAbi,
      functionName: 'withdrawPending',
      account: walletClient.account ?? getServicesAccount(),
      chain: walletClient.chain ?? undefined,
    });

    return makeTxResult(txHash);
  }

  async function getPendingWithdrawal(account?: Address): Promise<bigint> {
    const target = account ?? getServicesAccount();
    return options.publicClient.readContract({
      address,
      abi: serviceEscrowAbi,
      functionName: 'pendingWithdrawals',
      args: [target],
    });
  }

  /**
   * Reads platform fee configuration from VeilServiceEscrow.
   * Maximum allowed platform fee is 500 basis points (5%).
   * Settlement calculations are authoritative on-chain; buyer refunds are fee-free.
   */
  async function getFeeConfig() {
    const [feeRecipient, platformFeeBasisPoints] = await Promise.all([
      options.publicClient.readContract({
        address,
        abi: serviceEscrowAbi,
        functionName: 'feeRecipient',
      }),
      options.publicClient.readContract({
        address,
        abi: serviceEscrowAbi,
        functionName: 'platformFeeBasisPoints',
      }),
    ]);

    const feeBps = Number(platformFeeBasisPoints);
    return {
      feeRecipient,
      platformFeeBasisPoints: feeBps,
      platformFeeBps: feeBps,
      feePercent: feeBps / 100,
    };
  }

  async function getReviewer(): Promise<Address> {
    return options.publicClient.readContract({
      address,
      abi: serviceEscrowAbi,
      functionName: 'reviewer',
    });
  }

  return {
    address,
    chainId: targetChainId,
    getOrder,
    deposit,
    submitDelivery,
    releaseFunds,
    refund,
    cancelOrder,
    refundTimeout,
    dispute,
    resolveDispute,
    withdrawPending,
    getPendingWithdrawal,
    getFeeConfig,
    getReviewer,
  };
}

// ============================================================================
// Main Agent SDK Factory (Preserves Existing APIs & Adds Services Client)
// ============================================================================

function getAccount(options: VeilioAgentOptions): Address {
  const account =
    options.account ??
    (typeof options.walletClient?.account === 'string'
      ? options.walletClient.account
      : options.walletClient?.account?.address);
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

  // Dedicated Services escrow client instance attached to the agent (if configured or provided)
  let servicesClientInstance: ReturnType<typeof createVeilioServicesClient> | undefined;
  try {
    servicesClientInstance = createVeilioServicesClient({
      publicClient: options.publicClient,
      walletClient: options.walletClient,
      account: options.account,
      contractAddress: options.servicesContractAddress,
      chainId: VEILIO_CHAIN_ID,
    });
  } catch {
    // If Services address is not configured yet, servicesClientInstance remains undefined
    // until explicitly configured, avoiding breaking legacy auction-only agents.
  }

  async function getAuction(auctionId: bigint | number | string): Promise<VeilioAuction> {
    const id = BigInt(auctionId);
    if (id <= 0n) throw new Error('auctionId must be a positive integer.');
    const [raw, currentState] = await Promise.all([
      options.publicClient.readContract({ address, abi, functionName: 'auctions', args: [id] }),
      options.publicClient.readContract({ address, abi, functionName: 'getAuctionState', args: [id] }),
    ]);
    if (raw[0] === 0n) throw new Error(`Auction ${id} does not exist.`);
    return {
      id: raw[0],
      seller: raw[1],
      itemName: raw[2],
      description: raw[3],
      imageURI: raw[4],
      startingPriceWei: raw[5],
      commitEndTime: raw[6],
      revealEndTime: raw[7],
      inspectionDuration: raw[8],
      inspectionEndTime: raw[9],
      state: stateName(Number(currentState)),
      highestBidder: raw[11],
      highestBidWei: raw[12],
      bidderCount: raw[13],
      revealedCount: raw[14],
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

  async function evaluateAsset(
    assetId: string | number | bigint,
    criteria?: { maxBudgetBnb?: number; preferredLicense?: string }
  ) {
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
    if (!cryptoApi?.getRandomValues) {
      throw new Error('A cryptographically secure random generator is required to create a bid secret.');
    }
    const bytes = cryptoApi.getRandomValues(new Uint8Array(32));
    const secret = `0x${Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')}` as Hex;
    const commitment = keccak256(
      encodePacked(['uint256', 'address', 'uint256', 'bytes32'], [id, bidder, maxBidWei, secret])
    );
    return {
      auctionId: id.toString(),
      bidder,
      maxBidWei: maxBidWei.toString(),
      secret,
      commitment,
      chainId: VEILIO_CHAIN_ID,
      contractAddress: address,
    };
  }

  async function commitBid(prepared: PreparedBid, depositAmount: string) {
    const walletClient = options.walletClient;
    if (!walletClient) throw new Error('A walletClient is required to submit transactions.');
    if (
      prepared.chainId !== VEILIO_CHAIN_ID ||
      prepared.contractAddress.toLowerCase() !== address.toLowerCase()
    ) {
      throw new Error('Prepared bid belongs to a different chain or contract.');
    }
    if (prepared.bidder.toLowerCase() !== getAccount(options).toLowerCase()) {
      throw new Error('Prepared bid wallet does not match the connected agent wallet.');
    }
    const depositWei = parseEther(String(depositAmount));
    const auction = await getAuction(prepared.auctionId);
    if (auction.state !== 'Bidding') {
      throw new Error(`Auction is ${auction.state}; it is not accepting commitments.`);
    }
    if (depositWei < auction.startingPriceWei) {
      throw new Error('Deposit must meet the auction starting price.');
    }
    if (depositWei < BigInt(prepared.maxBidWei)) {
      throw new Error('Deposit must cover the maximum bid.');
    }
    const commitment = await options.publicClient.readContract({
      address,
      abi,
      functionName: 'commitments',
      args: [BigInt(prepared.auctionId), prepared.bidder],
    });
    if (commitment[0] !== `0x${'0'.repeat(64)}`) {
      throw new Error('This wallet already committed to this auction.');
    }
    return walletClient.writeContract({
      address,
      abi,
      functionName: 'commitBid',
      args: [BigInt(prepared.auctionId), prepared.commitment],
      value: depositWei,
      account: walletClient.account ?? getAccount(options),
      chain: walletClient.chain ?? undefined,
    });
  }

  async function revealBid(prepared: PreparedBid) {
    const walletClient = options.walletClient;
    if (!walletClient) throw new Error('A walletClient is required to submit transactions.');
    if (
      prepared.chainId !== VEILIO_CHAIN_ID ||
      prepared.contractAddress.toLowerCase() !== address.toLowerCase()
    ) {
      throw new Error('Prepared bid belongs to a different chain or contract.');
    }
    if (prepared.bidder.toLowerCase() !== getAccount(options).toLowerCase()) {
      throw new Error('Prepared bid wallet does not match the connected agent wallet.');
    }
    const auction = await getAuction(prepared.auctionId);
    if (auction.state !== 'Revealing') {
      throw new Error(`Auction is ${auction.state}; it is not accepting reveals.`);
    }
    const commitment = await options.publicClient.readContract({
      address,
      abi,
      functionName: 'commitments',
      args: [BigInt(prepared.auctionId), prepared.bidder],
    });
    if (commitment[0] !== prepared.commitment || commitment[2]) {
      throw new Error('On-chain commitment is missing, mismatched, or already revealed.');
    }
    const expected = keccak256(
      encodePacked(
        ['uint256', 'address', 'uint256', 'bytes32'],
        [BigInt(prepared.auctionId), prepared.bidder, BigInt(prepared.maxBidWei), prepared.secret]
      )
    );
    if (expected !== prepared.commitment) {
      throw new Error('Prepared bid secret does not match its commitment.');
    }
    return walletClient.writeContract({
      address,
      abi,
      functionName: 'revealBid',
      args: [BigInt(prepared.auctionId), BigInt(prepared.maxBidWei), prepared.secret],
      account: walletClient.account ?? getAccount(options),
      chain: walletClient.chain ?? undefined,
    });
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
    services: servicesClientInstance,
  };
}
