/**
 * VEILIO Cross-Chain Core Types and Discriminated Unions
 * 
 * Provides type-safe abstractions for heterogeneous multi-chain operations,
 * decoupling EVM (hex/keccak256) and SVM (Base58/Ed25519) data representations.
 */

import type { PublicClient, Address as ViemAddress, Hex as ViemHex } from 'viem';

// ============================================================================
// Core Identifiers & Chain Families
// ============================================================================

export type ChainFamily = 'evm' | 'solana';

export type NetworkEnvironment = 'mainnet' | 'testnet' | 'devnet' | 'localnet';

export type CanonicalNetworkId = 
  | 'bnb:97'           // BNB Smart Chain Testnet
  | 'bnb:56'           // BNB Smart Chain Mainnet
  | 'base:84532'       // Base Sepolia Testnet
  | 'solana:devnet'    // Solana Devnet
  | 'solana:mainnet'   // Solana Mainnet-Beta
  | 'solana:localnet'; // Solana Local Validator

// ============================================================================
// Strongly-Typed Chain Transaction Identifiers (Discriminated Union)
// ============================================================================

export interface EvmTxIdentifier {
  readonly family: 'evm';
  readonly networkId: CanonicalNetworkId;
  /** 32-byte 0x-prefixed hexadecimal transaction hash */
  readonly hash: `0x${string}`;
}

export interface SolanaTxIdentifier {
  readonly family: 'solana';
  readonly networkId: CanonicalNetworkId;
  /** 64-byte Base58 encoded transaction signature string */
  readonly signature: string;
}

export type ChainTxIdentifier = EvmTxIdentifier | SolanaTxIdentifier;

// ============================================================================
// Strongly-Typed Chain Addresses (Discriminated Union)
// ============================================================================

export interface EvmChainAddress {
  readonly family: 'evm';
  readonly networkId: CanonicalNetworkId;
  readonly address: `0x${string}`;
}

export interface SolanaChainAddress {
  readonly family: 'solana';
  readonly networkId: CanonicalNetworkId;
  readonly address: string;
}

export type ChainAddress = EvmChainAddress | SolanaChainAddress;

// ============================================================================
// Normalized Status Models
// ============================================================================

export type NormalizedAuctionStatus =
  | 'CREATED'
  | 'BIDDING'
  | 'REVEALING'
  | 'INSPECTION'
  | 'REFUND_REQUESTED'
  | 'UNDER_REVIEW'
  | 'COMPLETED'
  | 'REFUNDED'
  | 'CANCELLED'
  | 'UNKNOWN';

export type NormalizedEscrowStatus =
  | 'AWAITING_PAYMENT'
  | 'IN_PROGRESS'
  | 'IN_REVIEW'
  | 'REVISION_REQUESTED'
  | 'COMPLETED'
  | 'DISPUTED'
  | 'REFUNDED'
  | 'CANCELLED'
  | 'UNKNOWN';

export type NormalizedTxFinality =
  | 'PROCESSED'   // Included in block/slot; not yet cluster-confirmed or irreversible
  | 'CONFIRMED'   // Confirmed by cluster voting / standard multi-block depth
  | 'FINALIZED';  // Irreversible root block/slot finality

export type NormalizedTxExecutionStatus =
  | 'pending'
  | 'confirmed_success'
  | 'reverted'
  | 'unknown'
  | 'rpc_unavailable';

export interface NormalizedTransactionReceipt {
  readonly txId: ChainTxIdentifier;
  readonly networkId: CanonicalNetworkId;
  readonly blockOrSlot: bigint;
  readonly finality: NormalizedTxFinality;
  readonly status: NormalizedTxExecutionStatus;
  readonly confirmations?: number;
  readonly timestamp?: number;
  readonly rawReceipt?: unknown;
}

export interface NormalizedAuctionObservation {
  readonly networkId: CanonicalNetworkId;
  readonly auctionId: string;
  readonly sourceContractOrProgram: string;
  readonly state: NormalizedAuctionStatus;
  readonly seller: string;
  readonly highestBidder?: string;
  readonly highestBidAtomic?: string;
  readonly observedAt: number;
  readonly blockOrSlot: bigint;
  readonly sourceTxHash?: string;
}

// ============================================================================
// Chain Adapter Interface Specification
// ============================================================================

export interface IChainAdapter<TFamily extends ChainFamily = ChainFamily> {
  readonly family: TFamily;
  readonly networkId: CanonicalNetworkId;
  readonly environment: NetworkEnvironment;

  /**
   * Validates if the string conforms to the address format of this chain family.
   */
  isValidAddress(address: string): boolean;

  /**
   * Validates if the string conforms to the transaction identifier format of this chain family.
   */
  isValidTxIdentifier(txId: string): boolean;

  /**
   * Retrieves the current block number (EVM) or slot height (Solana).
   */
  getLatestBlockOrSlot(): Promise<bigint>;

  /**
   * Queries the execution status and finality of a transaction.
   */
  getTransactionStatus(identifier: ChainTxIdentifier): Promise<NormalizedTransactionReceipt>;

  /**
   * Reads authoritative auction state from on-chain storage.
   */
  observeAuction(contractOrProgram: string, auctionId: string): Promise<NormalizedAuctionObservation>;

  /**
   * Verifies an off-chain cryptographic signature from a signer.
   */
  verifySignature(message: string | Uint8Array, signature: string, signer: string): Promise<boolean>;
}

export type AnyChainAdapter = IChainAdapter<'evm'> | IChainAdapter<'solana'>;

// ============================================================================
// Cross-Chain Message Verification Models (Milestone 2)
// ============================================================================

export type CrossChainEventType =
  | 'AUCTION_CREATED'
  | 'BID_COMMITTED'
  | 'AUCTION_SETTLED'
  | 'AUCTION_COMPLETED';

export type MessageVerificationStatus =
  | 'verified'
  | 'pending'
  | 'rejected'
  | 'temporarily_unavailable';

export interface CrossChainMessageEnvelope {
  readonly version: 1;
  readonly messageId: string;
  readonly sourceNetwork: CanonicalNetworkId;
  readonly sourceEmitter: string;
  readonly auctionId: string;
  readonly eventType: CrossChainEventType;
  readonly payloadHash: string;
  readonly sourceTransaction: string;
  readonly sourceBlockOrSlot: string;
  readonly observedAt: number;
  readonly sequence?: string;
  readonly vaaBytes?: string;
  readonly consistencyLevel?: number;
}

export interface MessageVerificationChecks {
  readonly proofVerified: boolean;
  readonly trustedEmitterVerified: boolean;
  readonly finalitySatisfied: boolean;
  readonly replayChecked: boolean;
}

export interface MessageVerificationResult {
  readonly status: MessageVerificationStatus;
  readonly canonicalMessageId: string;
  readonly checks: MessageVerificationChecks;
  readonly reason?: string;
  readonly verifiedAt?: number;
}

