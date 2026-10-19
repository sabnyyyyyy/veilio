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
import { VEILIO_DEPLOYMENTS } from './deployments.js';
import {
  VeilioSdkError,
  type VeilioErrorCode,
  type VeilioSdkErrorDetails,
  isVeilioSdkError,
  wrapAsVeilioError,
} from './errors.js';

export * from './errors.js';
export { VEILIO_DEPLOYMENTS } from './deployments.js';
export * from './auth.js';
export * from './servicesApi.js';

/**
 * Safely executes an idempotent read operation with bounded exponential backoff.
 * NOTE: Never used on state-changing transactions to prevent duplicate submissions.
 */
export async function withSafeReadRetry<T>(
  fn: () => Promise<T>,
  options: { maxAttempts?: number; initialDelayMs?: number; backoffFactor?: number } = {}
): Promise<T> {
  const maxAttempts = options.maxAttempts ?? 3;
  const initialDelayMs = options.initialDelayMs ?? 200;
  const backoffFactor = options.backoffFactor ?? 2;

  let attempt = 0;
  let delay = initialDelayMs;

  while (true) {
    attempt++;
    try {
      return await fn();
    } catch (err) {
      if (attempt >= maxAttempts) {
        throw err;
      }
      await new Promise((resolve) => setTimeout(resolve, delay));
      delay *= backoffFactor;
    }
  }
}

// ============================================================================
// Core Constants & Network Configuration
// ============================================================================

/** Default EVM chain (BNB Smart Chain Testnet). Pass `chainId: 84532` for Base Sepolia. */
export const VEILIO_CHAIN_ID = VEILIO_DEPLOYMENTS.bnbTestnet.chainId;
export const VEILIO_CONTRACT_ADDRESS: Address = VEILIO_DEPLOYMENTS.bnbTestnet.auction;

/** Default VeilServiceEscrow on BNB Smart Chain Testnet. Override with `contractAddress`. */
export const VEILIO_SERVICES_CONTRACT_ADDRESS: Address = VEILIO_DEPLOYMENTS.bnbTestnet.serviceEscrow;

/** EVM chains VEILIO is deployed on: BNB Smart Chain Testnet (97) and Base Sepolia (84532). */
export const VEILIO_SUPPORTED_CHAIN_IDS = [
  VEILIO_DEPLOYMENTS.bnbTestnet.chainId,
  VEILIO_DEPLOYMENTS.baseSepolia.chainId,
] as const;
export type VeilioEvmChainId = (typeof VEILIO_SUPPORTED_CHAIN_IDS)[number];

function chainLabel(chainId: number): string {
  return chainId === VEILIO_DEPLOYMENTS.baseSepolia.chainId ? 'Base Sepolia' : 'BNB Chain testnet';
}

/** Validates a chain ID and returns it typed as a supported VEILIO EVM chain. */
export function assertVeilioChainId(chainId: number, product = 'VEILIO'): VeilioEvmChainId {
  if (chainId !== VEILIO_DEPLOYMENTS.bnbTestnet.chainId && chainId !== VEILIO_DEPLOYMENTS.baseSepolia.chainId) {
    throw new VeilioSdkError({
      code: 'CHAIN_MISMATCH',
      message: `Invalid chain ID ${chainId}. ${product} operates on BNB Chain (chain ID ${VEILIO_CHAIN_ID}) or Base Sepolia (chain ID 84532).`,
    });
  }
  return chainId as VeilioEvmChainId;
}

/** Default deployed addresses for a supported EVM chain. */
export function getVeilioDeployment(chainId: number) {
  const id = assertVeilioChainId(chainId);
  return id === VEILIO_DEPLOYMENTS.baseSepolia.chainId ? VEILIO_DEPLOYMENTS.baseSepolia : VEILIO_DEPLOYMENTS.bnbTestnet;
}

/** Throws CHAIN_MISMATCH when the wallet is connected to a different chain than the client targets. */
function assertWalletOnChain(walletClient: WalletClient | undefined, targetChainId: number) {
  if (walletClient?.chain && walletClient.chain.id !== targetChainId) {
    throw new VeilioSdkError({
      code: 'CHAIN_MISMATCH',
      message: `Connected wallet chain ID (${walletClient.chain.id}) does not match required ${chainLabel(targetChainId)} (${targetChainId}).`,
      context: { walletChainId: walletClient.chain.id, targetChainId },
    });
  }
}

// ============================================================================
// Auction & Asset Marketplace ABI & Types (Preserved for 100% Backward Compatibility)
// ============================================================================

/** Subset of the deployed VeilNFTV4 auction ABI (BNB testnet + Base Sepolia) used by the agent. */
export const veilAuctionAbi = parseAbi([
  'function createAuction(string itemName, string description, string imageURI, uint256 startingPrice, uint256 commitDuration, uint256 revealDuration, uint256 inspectionDuration) returns (uint256 auctionId)',
  'function auctionCount() view returns (uint256)',
  'function auctions(uint256 auctionId) view returns (uint256 id, address seller, string itemName, string description, string imageURI, uint256 startingPrice, uint256 commitEndTime, uint256 revealEndTime, uint256 inspectionDuration, uint256 inspectionEndTime, uint8 state, address highestBidder, uint256 highestBid, uint256 bidderCount, uint256 revealedCount, bytes32 finalTxHash, string evidenceHash, string reviewReason)',
  'function getAuctionState(uint256 auctionId) view returns (uint8)',
  'function commitments(uint256 auctionId, address bidder) view returns (bytes32 commitment, uint256 deposit, bool revealed, uint256 maxBid)',
  'function nftAssets(uint256 auctionId) view returns (uint8 standard, address tokenContract, uint256 tokenId, uint256 amount, bool escrowed, bool delivered)',
  'function pendingRefunds(address account) view returns (uint256)',
  'function commitBid(uint256 auctionId, bytes32 commitment) payable',
  'function revealBid(uint256 auctionId, uint256 maxBid, bytes32 secret)',
  'function settleAuction(uint256 auctionId)',
  'function acceptDataset(uint256 auctionId)',
  'function finalizeSettlement(uint256 auctionId)',
  'function requestRefund(uint256 auctionId, string evidenceHash)',
  'function withdrawRefund()',
]);
const abi = veilAuctionAbi;

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
  /**
   * Target EVM chain: 97 (BNB Smart Chain Testnet, default) or 84532 (Base Sepolia).
   * Selects the default auction + Services escrow addresses and is enforced against
   * `walletClient.chain` before every transaction.
   */
  chainId?: number;
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
  'function partialRefund(bytes32 orderId, uint256 refundAmount, string reason)',
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
  'event OrderPartiallyRefunded(bytes32 indexed orderId, address indexed buyer, uint256 refundAmount, uint256 remainingAmount, string reason)',
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
  amountEth?: string;
  deadline: bigint;
  status: ServiceEscrowState;
  createdAt: bigint;
  settledAt: bigint;
  deliverableReference: string;
  chainId?: number;
}

export interface DepositServiceOrderInput {
  orderId: Hex | string;
  seller: Address;
  deadline: bigint | number;
  amountBnb?: string;
  amountEth?: string;
  amount?: string;
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
  const targetChainId = assertVeilioChainId(options.chainId ?? VEILIO_CHAIN_ID, 'VEILIO Services');

  const defaultContractAddress =
    targetChainId === VEILIO_DEPLOYMENTS.baseSepolia.chainId
      ? VEILIO_DEPLOYMENTS.baseSepolia.serviceEscrow
      : VEILIO_SERVICES_CONTRACT_ADDRESS;

  const address =
    options.contractAddress !== undefined
      ? options.contractAddress
      : defaultContractAddress;

  if (
    !address ||
    typeof address !== 'string' ||
    !isAddress(address) ||
    address === '0x0000000000000000000000000000000000000000'
  ) {
    throw new VeilioSdkError({
      code: 'INVALID_CONFIG',
      message: 'Services escrow contract address is missing or invalid. Pass a deployed VeilServiceEscrow address as contractAddress.',
    });
  }

  if (
    address.toLowerCase() === VEILIO_CONTRACT_ADDRESS.toLowerCase() ||
    address.toLowerCase() === VEILIO_DEPLOYMENTS.baseSepolia.auction.toLowerCase()
  ) {
    throw new VeilioSdkError({
      code: 'INVALID_CONFIG',
      message: 'Invalid Services contract address: cannot use the VEILIO auction contract address for Services escrow.',
    });
  }

  function getServicesAccount(): Address {
    const acc =
      options.account ??
      (typeof options.walletClient?.account === 'string'
        ? options.walletClient.account
        : options.walletClient?.account?.address);
    if (!acc) {
      throw new VeilioSdkError({
        code: 'WALLET_REQUIRED',
        message: 'Provide a wallet account address to execute this Services contract transaction.',
      });
    }
    return acc;
  }

  function assertWalletChain(walletClient?: WalletClient) {
    assertWalletOnChain(walletClient, targetChainId);
  }

  function makeTxResult(txHash: Hex): ServicesTxResult {
    return {
      txHash,
      status: 'submitted',
      wait: async () => {
        const receipt = await options.publicClient.waitForTransactionReceipt({ hash: txHash });
        if (receipt.status === 'reverted') {
          throw new VeilioSdkError({
            code: 'TRANSACTION_REVERTED',
            message: `Transaction ${txHash} reverted on-chain.`,
            context: { txHash, status: receipt.status },
          });
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
      amountEth: formatEther(raw.amount),
      deadline: raw.deadline,
      status: serviceStateName(raw.status),
      createdAt: raw.createdAt,
      settledAt: raw.settledAt,
      deliverableReference: raw.deliverableReference,
      chainId: targetChainId,
    };
  }

  async function deposit(input: DepositServiceOrderInput): Promise<ServicesTxResult> {
    const walletClient = options.walletClient;
    if (!walletClient) {
      throw new VeilioSdkError({ code: 'WALLET_REQUIRED', message: 'A walletClient is required to deposit escrow funds.' });
    }
    assertWalletChain(walletClient);

    const id = formatServiceOrderId(input.orderId);
    const depositAmount = input.amount ?? (targetChainId === 84532 ? (input.amountEth ?? input.amountBnb) : input.amountBnb);
    if (!depositAmount) {
      throw new VeilioSdkError({ code: 'INVALID_INPUT', message: 'Deposit amount must be provided.' });
    }
    const value = parseEther(depositAmount);
    const deadlineBigInt = BigInt(input.deadline);

    if (value <= 0n) {
      throw new VeilioSdkError({ code: 'INVALID_INPUT', message: 'Deposit amount must be greater than zero.' });
    }
    if (deadlineBigInt <= BigInt(Math.floor(Date.now() / 1000))) {
      throw new VeilioSdkError({ code: 'INVALID_INPUT', message: 'Deadline must be in the future.' });
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
    if (!walletClient) {
      throw new VeilioSdkError({ code: 'WALLET_REQUIRED', message: 'A walletClient is required to submit deliverables.' });
    }
    assertWalletChain(walletClient);
    if (!deliverableReference.trim()) {
      throw new VeilioSdkError({ code: 'INVALID_INPUT', message: 'Deliverable reference cannot be empty.' });
    }

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
    if (!walletClient) {
      throw new VeilioSdkError({ code: 'WALLET_REQUIRED', message: 'A walletClient is required to release escrow funds.' });
    }
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
    if (!walletClient) {
      throw new VeilioSdkError({ code: 'WALLET_REQUIRED', message: 'A walletClient is required to refund escrow funds.' });
    }
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
    if (!walletClient) {
      throw new VeilioSdkError({ code: 'WALLET_REQUIRED', message: 'A walletClient is required to cancel the escrow order.' });
    }
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

  /** Seller returns part of the escrow (amount in native units, e.g. "0.03") after agreeing a lower price. */
  async function partialRefund(orderId: Hex | string, amount: string, reason: string): Promise<ServicesTxResult> {
    const walletClient = options.walletClient;
    if (!walletClient) {
      throw new VeilioSdkError({ code: 'WALLET_REQUIRED', message: 'A walletClient is required to partially refund the escrow order.' });
    }
    assertWalletChain(walletClient);

    const id = formatServiceOrderId(orderId);
    const txHash = await walletClient.writeContract({
      address,
      abi: serviceEscrowAbi,
      functionName: 'partialRefund',
      args: [id, parseEther(String(amount)), reason || 'Price reduced'],
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
    if (!walletClient) {
      throw new VeilioSdkError({ code: 'WALLET_REQUIRED', message: 'A walletClient is required to dispute the escrow order.' });
    }
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
    if (!walletClient) {
      throw new VeilioSdkError({ code: 'WALLET_REQUIRED', message: 'A walletClient is required to resolve dispute.' });
    }
    assertWalletChain(walletClient);
    if (splitToBuyerPercent < 0 || splitToBuyerPercent > 100) {
      throw new VeilioSdkError({ code: 'INVALID_INPUT', message: 'Split percentage must be between 0 and 100.' });
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
    if (!walletClient) {
      throw new VeilioSdkError({ code: 'WALLET_REQUIRED', message: 'A walletClient is required to claim pending withdrawals.' });
    }
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
    partialRefund,
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
  if (!account) {
    throw new VeilioSdkError({ code: 'WALLET_REQUIRED', message: 'Provide an agent wallet account address.' });
  }
  return account;
}

function stateName(value: number): AuctionState {
  const state = AUCTION_STATES[value];
  if (!state) {
    throw new VeilioSdkError({ code: 'CONTRACT_ERROR', message: `Unknown auction state: ${value}` });
  }
  return state;
}

export function createVeilioAgent(options: VeilioAgentOptions) {
  const targetChainId = assertVeilioChainId(options.chainId ?? VEILIO_CHAIN_ID, 'VEILIO auctions');
  const address = options.contractAddress ?? getVeilioDeployment(targetChainId).auction;
  if (!isAddress(address)) {
    throw new VeilioSdkError({ code: 'INVALID_CONFIG', message: 'Auction contractAddress is not a valid EVM address.' });
  }
  const apiBase = (options.apiBaseUrl || '').replace(/\/$/, '');

  // Dedicated Services escrow client instance attached to the agent (same chain as the auction agent)
  let servicesClientInstance: ReturnType<typeof createVeilioServicesClient> | undefined;
  try {
    servicesClientInstance = createVeilioServicesClient({
      publicClient: options.publicClient,
      walletClient: options.walletClient,
      account: options.account,
      contractAddress: options.servicesContractAddress,
      chainId: targetChainId,
    });
  } catch {
    // If Services address is not configured yet, servicesClientInstance remains undefined
    // until explicitly configured, avoiding breaking legacy auction-only agents.
  }

  async function getAuction(auctionId: bigint | number | string): Promise<VeilioAuction> {
    const id = BigInt(auctionId);
    if (id <= 0n) {
      throw new VeilioSdkError({ code: 'INVALID_INPUT', message: 'auctionId must be a positive integer.' });
    }
    const [raw, currentState] = await Promise.all([
      options.publicClient.readContract({ address, abi, functionName: 'auctions', args: [id] }),
      options.publicClient.readContract({ address, abi, functionName: 'getAuctionState', args: [id] }),
    ]);
    if (raw[0] === 0n) {
      throw new VeilioSdkError({ code: 'NOT_FOUND', message: `Auction ${id} does not exist.` });
    }
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
    if (start < 0n) {
      throw new VeilioSdkError({ code: 'INVALID_INPUT', message: 'cursor cannot be negative.' });
    }
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
    if (id <= 0n || maxBidWei <= 0n) {
      throw new VeilioSdkError({ code: 'INVALID_INPUT', message: 'auctionId and maxBid must be positive.' });
    }
    const cryptoApi = globalThis.crypto;
    if (!cryptoApi?.getRandomValues) {
      throw new VeilioSdkError({
        code: 'INVALID_CONFIG',
        message: 'A cryptographically secure random generator is required to create a bid secret.',
      });
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
      chainId: targetChainId,
      contractAddress: address,
    };
  }

  function requireWallet(): WalletClient {
    const walletClient = options.walletClient;
    if (!walletClient) {
      throw new VeilioSdkError({ code: 'WALLET_REQUIRED', message: 'A walletClient is required to submit transactions.' });
    }
    assertWalletOnChain(walletClient, targetChainId);
    return walletClient;
  }

  function assertPreparedBidTarget(prepared: PreparedBid) {
    if (
      prepared.chainId !== targetChainId ||
      prepared.contractAddress.toLowerCase() !== address.toLowerCase()
    ) {
      throw new VeilioSdkError({
        code: 'CHAIN_MISMATCH',
        message: 'Prepared bid belongs to a different chain or contract.',
        context: { preparedChainId: prepared.chainId, targetChainId },
      });
    }
    if (prepared.bidder.toLowerCase() !== getAccount(options).toLowerCase()) {
      throw new VeilioSdkError({ code: 'UNAUTHORIZED', message: 'Prepared bid wallet does not match the connected agent wallet.' });
    }
  }

  async function write(
    walletClient: WalletClient,
    functionName: 'createAuction' | 'commitBid' | 'revealBid' | 'settleAuction' | 'acceptDataset' | 'finalizeSettlement' | 'requestRefund' | 'withdrawRefund',
    args: readonly unknown[],
    value?: bigint
  ): Promise<Hex> {
    return walletClient.writeContract({
      address,
      abi,
      functionName,
      args,
      value,
      account: walletClient.account ?? getAccount(options),
      chain: walletClient.chain ?? undefined,
    } as Parameters<WalletClient['writeContract']>[0]);
  }

  const nowSeconds = () => BigInt(Math.floor(Date.now() / 1000));

  /** Creates an EVM auction listing. The connected seller wallet signs and pays gas. */
  async function createAuction(input: {
    itemName: string;
    description: string;
    imageURI: string;
    startingPrice: string;
    commitDurationSeconds: number;
    revealDurationSeconds: number;
    inspectionDurationSeconds: number;
  }): Promise<Hex> {
    const walletClient = requireWallet();
    if (!input.itemName.trim() || !input.description.trim()) {
      throw new VeilioSdkError({ code: 'INVALID_INPUT', message: 'Auction itemName and description are required.' });
    }
    if (!input.imageURI.trim()) {
      throw new VeilioSdkError({ code: 'INVALID_INPUT', message: 'imageURI is required.' });
    }
    if (!Number.isSafeInteger(input.commitDurationSeconds) || input.commitDurationSeconds < 60 ||
        !Number.isSafeInteger(input.revealDurationSeconds) || input.revealDurationSeconds < 60 ||
        !Number.isSafeInteger(input.inspectionDurationSeconds) || input.inspectionDurationSeconds < 3600) {
      throw new VeilioSdkError({ code: 'INVALID_INPUT', message: 'Commit/reveal must be at least 60 seconds and inspection at least 3600 seconds.' });
    }
    const startingPrice = parseEther(input.startingPrice);
    if (startingPrice <= 0n) throw new VeilioSdkError({ code: 'INVALID_INPUT', message: 'startingPrice must be positive.' });
    return write(walletClient, 'createAuction', [
      input.itemName.trim(), input.description.trim(), input.imageURI.trim(), startingPrice,
      BigInt(input.commitDurationSeconds), BigInt(input.revealDurationSeconds), BigInt(input.inspectionDurationSeconds),
    ]);
  }

  async function commitBid(prepared: PreparedBid, depositAmount: string): Promise<Hex> {
    const walletClient = requireWallet();
    assertPreparedBidTarget(prepared);
    const depositWei = parseEther(String(depositAmount));
    const auction = await getAuction(prepared.auctionId);
    if (auction.state !== 'Bidding') {
      throw new VeilioSdkError({ code: 'INVALID_INPUT', message: `Auction is ${auction.state}; it is not accepting commitments.` });
    }
    if (depositWei < auction.startingPriceWei) {
      throw new VeilioSdkError({ code: 'INVALID_INPUT', message: 'Deposit must meet the auction starting price.' });
    }
    if (depositWei < BigInt(prepared.maxBidWei)) {
      throw new VeilioSdkError({ code: 'INVALID_INPUT', message: 'Deposit must cover the maximum bid.' });
    }
    const commitment = await options.publicClient.readContract({
      address,
      abi,
      functionName: 'commitments',
      args: [BigInt(prepared.auctionId), prepared.bidder],
    });
    if (commitment[0] !== `0x${'0'.repeat(64)}`) {
      throw new VeilioSdkError({ code: 'INVALID_INPUT', message: 'This wallet already committed to this auction.' });
    }
    return write(walletClient, 'commitBid', [BigInt(prepared.auctionId), prepared.commitment], depositWei);
  }

  async function revealBid(prepared: PreparedBid): Promise<Hex> {
    const walletClient = requireWallet();
    assertPreparedBidTarget(prepared);
    const auction = await getAuction(prepared.auctionId);
    if (auction.state !== 'Revealing' || nowSeconds() >= auction.revealEndTime) {
      throw new VeilioSdkError({
        code: 'INVALID_INPUT',
        message:
          auction.state === 'Revealing'
            ? 'Reveal phase has ended; the auction is waiting for settleAuction().'
            : `Auction is ${auction.state}; it is not accepting reveals.`,
      });
    }
    const commitment = await options.publicClient.readContract({
      address,
      abi,
      functionName: 'commitments',
      args: [BigInt(prepared.auctionId), prepared.bidder],
    });
    if (commitment[0] !== prepared.commitment || commitment[2]) {
      throw new VeilioSdkError({
        code: 'INVALID_INPUT',
        message: 'On-chain commitment is missing, mismatched, or already revealed.',
      });
    }
    const expected = keccak256(
      encodePacked(
        ['uint256', 'address', 'uint256', 'bytes32'],
        [BigInt(prepared.auctionId), prepared.bidder, BigInt(prepared.maxBidWei), prepared.secret]
      )
    );
    if (expected !== prepared.commitment) {
      throw new VeilioSdkError({ code: 'INVALID_INPUT', message: 'Prepared bid secret does not match its commitment.' });
    }
    return write(walletClient, 'revealBid', [BigInt(prepared.auctionId), BigInt(prepared.maxBidWei), prepared.secret]);
  }

  async function getAuctionResult(auctionId: bigint | number | string) {
    const auction = await getAuction(auctionId);
    const agentAddress = getAccount(options).toLowerCase();
    const isWinner = auction.highestBidder.toLowerCase() === agentAddress;
    return {
      auctionId: String(auctionId),
      chainId: targetChainId,
      state: auction.state,
      isWinner,
      highestBidder: auction.highestBidder,
      /** Native-token amount (BNB on chain 97, ETH on Base Sepolia). */
      winningBid: formatEther(auction.highestBidWei),
      /** @deprecated Use `winningBid`; kept for 0.2.x compatibility (also set on Base Sepolia). */
      winningBidBnb: formatEther(auction.highestBidWei),
    };
  }

  /** True when the auction escrows an ERC-721/ERC-1155 token (VeilNFTV4 `nftAssets.standard != None`). */
  async function isNftAuction(auctionId: bigint | number | string): Promise<boolean> {
    const asset = await options.publicClient.readContract({
      address,
      abi,
      functionName: 'nftAssets',
      args: [BigInt(auctionId)],
    });
    return Number(asset[0]) !== 0;
  }

  /**
   * Moves an auction out of the reveal phase once `revealEndTime` has passed. Anyone can call it.
   * With a winner the auction enters Inspection; without one, deposits become withdrawable
   * (`withdrawRefund`) and an escrowed NFT returns to the seller.
   */
  async function settleAuction(auctionId: bigint | number | string): Promise<Hex> {
    const walletClient = requireWallet();
    const auction = await getAuction(auctionId);
    if (auction.state !== 'Revealing') {
      throw new VeilioSdkError({ code: 'INVALID_INPUT', message: `Auction is ${auction.state}; only an auction past its reveal phase can be settled.` });
    }
    if (nowSeconds() < auction.revealEndTime) {
      throw new VeilioSdkError({ code: 'INVALID_INPUT', message: 'Reveal phase has not finished yet.', context: { revealEndTime: auction.revealEndTime.toString() } });
    }
    return write(walletClient, 'settleAuction', [BigInt(auctionId)]);
  }

  /**
   * Winner accepts a dataset auction during inspection (`acceptDataset`), paying the seller.
   * NFT auctions cannot be accepted: VeilNFTV4 delivers the token automatically through
   * `finalizeSettlement` after inspection ends, so this throws for NFT auctions.
   */
  async function claimAsset(auctionId: bigint | number | string): Promise<Hex> {
    const walletClient = requireWallet();
    if (await isNftAuction(auctionId)) {
      throw new VeilioSdkError({
        code: 'INVALID_INPUT',
        message: 'NFT auctions are completed with finalizeSettlement() after the inspection period ends; acceptDataset is blocked for NFTs.',
      });
    }
    const auction = await getAuction(auctionId);
    if (auction.state !== 'Inspection') {
      throw new VeilioSdkError({ code: 'INVALID_INPUT', message: `Auction is ${auction.state}; acceptDataset requires Inspection.` });
    }
    if (auction.highestBidder.toLowerCase() !== getAccount(options).toLowerCase()) {
      throw new VeilioSdkError({ code: 'UNAUTHORIZED', message: 'Only the winning bidder can accept the asset.' });
    }
    return write(walletClient, 'acceptDataset', [BigInt(auctionId)]);
  }

  /**
   * Completes an auction once the inspection period has ended without a refund request:
   * pays the seller (minus the 10% platform fee, credited as pull payments) and, for NFT
   * auctions, delivers the escrowed token to the winner. Anyone can call it.
   * This is the required completion path for NFT auctions.
   */
  async function finalizeSettlement(auctionId: bigint | number | string): Promise<Hex> {
    const walletClient = requireWallet();
    const auction = await getAuction(auctionId);
    if (auction.state !== 'Inspection') {
      throw new VeilioSdkError({ code: 'INVALID_INPUT', message: `Auction is ${auction.state}; finalizeSettlement requires Inspection.` });
    }
    if (nowSeconds() <= auction.inspectionEndTime) {
      throw new VeilioSdkError({
        code: 'INVALID_INPUT',
        message: 'Inspection period has not ended yet.',
        context: { inspectionEndTime: auction.inspectionEndTime.toString() },
      });
    }
    return write(walletClient, 'finalizeSettlement', [BigInt(auctionId)]);
  }

  /**
   * Winner disputes the asset during inspection. `evidenceHash` is stored on-chain (e.g. an IPFS CID
   * or sha256 of your evidence bundle); the platform reviewer then resolves the request.
   * Note: on the deployed EVM contracts a refund request has no timeout, so funds stay locked until
   * the reviewer acts.
   */
  async function requestRefund(auctionId: bigint | number | string, evidenceHash: string): Promise<Hex> {
    const walletClient = requireWallet();
    const evidence = String(evidenceHash ?? '').trim();
    if (!evidence) {
      throw new VeilioSdkError({ code: 'INVALID_INPUT', message: 'evidenceHash is required to request a refund.' });
    }
    const auction = await getAuction(auctionId);
    if (auction.state !== 'Inspection' || nowSeconds() > auction.inspectionEndTime) {
      throw new VeilioSdkError({ code: 'INVALID_INPUT', message: 'Refunds can only be requested during the inspection period.' });
    }
    if (auction.highestBidder.toLowerCase() !== getAccount(options).toLowerCase()) {
      throw new VeilioSdkError({ code: 'UNAUTHORIZED', message: 'Only the winning bidder can request a refund.' });
    }
    return write(walletClient, 'requestRefund', [BigInt(auctionId), evidence]);
  }

  /** Pull-payment balance credited to `account` (losing deposits, over-deposits, seller proceeds, approved refunds). */
  async function getPendingRefund(account?: Address): Promise<bigint> {
    return options.publicClient.readContract({
      address,
      abi,
      functionName: 'pendingRefunds',
      args: [account ?? getAccount(options)],
    });
  }

  /** Withdraws the caller's whole `pendingRefunds` balance (all auctions at once). */
  async function withdrawRefund(): Promise<Hex> {
    const walletClient = requireWallet();
    const pending = await getPendingRefund();
    if (pending <= 0n) {
      throw new VeilioSdkError({ code: 'INVALID_INPUT', message: 'No pending refund to withdraw for this wallet.' });
    }
    return write(walletClient, 'withdrawRefund', []);
  }

  /** Waits for a transaction returned by this agent and throws TRANSACTION_REVERTED on failure. */
  async function waitForTransaction(hash: Hex): Promise<TransactionReceipt> {
    const receipt = await options.publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status === 'reverted') {
      throw new VeilioSdkError({
        code: 'TRANSACTION_REVERTED',
        message: `Transaction ${hash} reverted on-chain.`,
        context: { txHash: hash, status: receipt.status },
      });
    }
    return receipt;
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
    chainId: targetChainId,
    getAuction,
    listAuctions,
    createAuction,
    searchAssets,
    getAssetDetails,
    evaluateAsset,
    prepareBid,
    commitBid,
    revealBid,
    getAuctionResult,
    isNftAuction,
    settleAuction,
    claimAsset,
    finalizeSettlement,
    requestRefund,
    getPendingRefund,
    withdrawRefund,
    waitForTransaction,
    getLicense,
    services: servicesClientInstance,
  };
}
