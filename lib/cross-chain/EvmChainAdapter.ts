/**
 * VEILIO Concrete EVM Chain Adapter
 * 
 * Provides type-safe EVM chain operations, transaction receipt verification,
 * and on-chain auction state observation using Viem.
 */

import {
  isAddress,
  verifyMessage,
  createPublicClient,
  http,
  parseAbi,
  type PublicClient,
  type Address,
  type Hex,
  type TransactionReceipt,
} from 'viem';
import {
  ChainTxIdentifier,
  CanonicalNetworkId,
  IChainAdapter,
  NetworkEnvironment,
  NormalizedAuctionObservation,
  NormalizedAuctionStatus,
  NormalizedTransactionReceipt,
  NormalizedTxExecutionStatus,
  NormalizedTxFinality,
} from './types';
import { getNetworkConfig } from './networkConfig';
import { getEvmChain } from './evmChains';

const auctionAbi = parseAbi([
  'function auctions(uint256 auctionId) view returns (uint256 id, address seller, string itemName, string description, string imageURI, uint256 startingPrice, uint256 commitEndTime, uint256 revealEndTime, uint256 inspectionDuration, uint256 inspectionEndTime, uint8 state, address highestBidder, uint256 highestBid, uint256 bidderCount, uint256 revealedCount, bytes32 finalTxHash, string evidenceHash, string reviewReason)',
  'function getAuctionState(uint256 auctionId) view returns (uint8)',
]);

const AUCTION_STATUS_MAP: Record<number, NormalizedAuctionStatus> = {
  0: 'CREATED',
  1: 'BIDDING',
  2: 'REVEALING',
  3: 'INSPECTION',
  4: 'REFUND_REQUESTED',
  5: 'UNDER_REVIEW',
  6: 'COMPLETED',
  7: 'REFUNDED',
  8: 'CANCELLED',
};

export interface EvmChainAdapterOptions {
  networkId?: CanonicalNetworkId;
  expectedChainId?: number;
  publicClient?: PublicClient;
  rpcUrl?: string;
}

export class EvmChainAdapter implements IChainAdapter<'evm'> {
  public readonly family = 'evm' as const;
  public readonly networkId: CanonicalNetworkId;
  public readonly environment: NetworkEnvironment;
  public readonly expectedChainId: number;
  protected readonly client: PublicClient;

  constructor(options: EvmChainAdapterOptions = {}) {
    this.networkId = options.networkId ?? 'bnb:97';
    const config = getNetworkConfig(this.networkId);
    if (config.family !== 'evm') {
      throw new Error(`Cannot initialize EvmChainAdapter with non-EVM network: ${this.networkId}`);
    }

    this.environment = config.environment;
    const configuredChain = getEvmChain(this.networkId);
    this.expectedChainId = options.expectedChainId ?? configuredChain.id;

    if (options.publicClient) {
      this.client = options.publicClient;
    } else {
      const endpoint = options.rpcUrl || config.rpcEndpoints[0];
      this.client = createPublicClient({
        chain: configuredChain,
        transport: http(endpoint),
      }) as PublicClient;
    }
  }

  /**
   * Asserts the connected client or target matches expected EVM chain ID.
   */
  public async assertExpectedChain(): Promise<void> {
    const activeChainId = await this.client.getChainId();
    if (activeChainId !== this.expectedChainId) {
      throw new Error(
        `Chain mismatch: expected Chain ID ${this.expectedChainId}, but connected RPC returned ${activeChainId}.`
      );
    }
  }

  public isValidAddress(address: string): boolean {
    return isAddress(address);
  }

  public isValidTxIdentifier(txId: string): boolean {
    return /^0x[a-fA-F0-9]{64}$/.test(txId);
  }

  public async getLatestBlockOrSlot(): Promise<bigint> {
    return this.client.getBlockNumber();
  }

  public async getTransactionStatus(identifier: ChainTxIdentifier): Promise<NormalizedTransactionReceipt> {
    if (identifier.family !== 'evm') {
      throw new TypeError(
        `Invalid identifier family for EVM adapter: expected 'evm', received '${(identifier as any).family}'.`
      );
    }

    if (identifier.networkId !== this.networkId) {
      throw new Error(
        `Network mismatch: adapter is configured for ${this.networkId}, but transaction is tagged ${identifier.networkId}.`
      );
    }

    if (!this.isValidTxIdentifier(identifier.hash)) {
      throw new Error(`Malformed EVM transaction hash: ${identifier.hash}`);
    }

    try {
      let receipt: TransactionReceipt | null = null;
      try {
        receipt = await this.client.getTransactionReceipt({ hash: identifier.hash });
      } catch (err: any) {
        const msg = String(err?.message || '').toLowerCase();
        if (
          msg.includes('fetch') ||
          msg.includes('network') ||
          msg.includes('connection') ||
          msg.includes('timeout') ||
          msg.includes('econnrefused') ||
          msg.includes('rpc')
        ) {
          return {
            txId: identifier,
            networkId: this.networkId,
            blockOrSlot: 0n,
            finality: 'PROCESSED',
            status: 'rpc_unavailable',
          };
        }
        // Receipt not yet mined / not found
      }

      if (receipt) {
        const latestBlock = await this.client.getBlockNumber();
        const confirmations = Number(latestBlock - receipt.blockNumber + 1n);
        const config = getNetworkConfig(this.networkId);
        const finality: NormalizedTxFinality =
          confirmations >= config.finalityConfig.requiredConfirmations ? 'FINALIZED' : 'CONFIRMED';
        const status: NormalizedTxExecutionStatus =
          receipt.status === 'success' ? 'confirmed_success' : 'reverted';

        return {
          txId: identifier,
          networkId: this.networkId,
          blockOrSlot: receipt.blockNumber,
          finality,
          status,
          confirmations,
          rawReceipt: receipt,
        };
      }

      // Receipt not found; check if pending in mempool if getTransaction is available
      if (typeof this.client.getTransaction === 'function') {
        try {
          const tx = await this.client.getTransaction({ hash: identifier.hash });
          if (tx && tx.blockNumber === null) {
            return {
              txId: identifier,
              networkId: this.networkId,
              blockOrSlot: 0n,
              finality: 'PROCESSED',
              status: 'pending',
            };
          }
        } catch (err: any) {
          const msg = String(err?.message || '').toLowerCase();
          if (
            msg.includes('fetch') ||
            msg.includes('network') ||
            msg.includes('connection') ||
            msg.includes('timeout') ||
            msg.includes('econnrefused') ||
            msg.includes('rpc')
          ) {
            return {
              txId: identifier,
              networkId: this.networkId,
              blockOrSlot: 0n,
              finality: 'PROCESSED',
              status: 'rpc_unavailable',
            };
          }
        }
      }

      return {
        txId: identifier,
        networkId: this.networkId,
        blockOrSlot: 0n,
        finality: 'PROCESSED',
        status: 'unknown',
      };
    } catch (error: any) {
      const message = String(error?.message || '').toLowerCase();
      if (
        message.includes('fetch') ||
        message.includes('network') ||
        message.includes('connection') ||
        message.includes('timeout') ||
        message.includes('econnrefused') ||
        message.includes('rpc')
      ) {
        return {
          txId: identifier,
          networkId: this.networkId,
          blockOrSlot: 0n,
          finality: 'PROCESSED',
          status: 'rpc_unavailable',
        };
      }
      throw error;
    }
  }

  public async observeAuction(
    contractOrProgram: string,
    auctionId: string
  ): Promise<NormalizedAuctionObservation> {
    if (!this.isValidAddress(contractOrProgram)) {
      throw new Error(`Invalid contract address: ${contractOrProgram}`);
    }

    const idBigInt = BigInt(auctionId);
    const contractAddr = contractOrProgram as Address;

    const [auctionData, rawState, currentBlock] = await Promise.all([
      this.client.readContract({
        address: contractAddr,
        abi: auctionAbi,
        functionName: 'auctions',
        args: [idBigInt],
      }),
      this.client.readContract({
        address: contractAddr,
        abi: auctionAbi,
        functionName: 'getAuctionState',
        args: [idBigInt],
      }),
      this.client.getBlockNumber(),
    ]);

    const stateEnum = Number(rawState);
    const state: NormalizedAuctionStatus = AUCTION_STATUS_MAP[stateEnum] || 'UNKNOWN';

    return {
      networkId: this.networkId,
      auctionId,
      sourceContractOrProgram: contractOrProgram,
      state,
      seller: auctionData[1],
      highestBidder: auctionData[11] === '0x0000000000000000000000000000000000000000' ? undefined : auctionData[11],
      highestBidAtomic: auctionData[12].toString(),
      observedAt: Math.floor(Date.now() / 1000),
      blockOrSlot: currentBlock,
    };
  }

  public async verifySignature(
    message: string | Uint8Array,
    signature: string,
    signer: string
  ): Promise<boolean> {
    if (!this.isValidAddress(signer)) return false;
    if (!signature.startsWith('0x')) return false;

    try {
      const msgString = typeof message === 'string' ? message : new TextDecoder().decode(message);
      return await verifyMessage({
        address: signer as Address,
        message: msgString,
        signature: signature as Hex,
      });
    } catch {
      return false;
    }
  }
}
