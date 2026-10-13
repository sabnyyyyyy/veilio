/**
 * VEILIO Concrete Read-Only Solana Chain Adapter
 * 
 * Implements read-only Solana SVM status observation, transaction finality checking,
 * and Base58 validation using native JSON-RPC 2.0 with zero external dependency bloat.
 */

import {
  ChainTxIdentifier,
  CanonicalNetworkId,
  IChainAdapter,
  NetworkEnvironment,
  NormalizedAuctionObservation,
  NormalizedTransactionReceipt,
  NormalizedTxExecutionStatus,
  NormalizedTxFinality,
} from './types';
import { getNetworkConfig } from './networkConfig';

// Standard Bitcoin/Solana Base58 character set (excludes 0, O, I, l)
const BASE58_REGEX = /^[1-9A-HJ-NP-Za-km-z]+$/;
const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

function decodeBase58(value: string): Uint8Array {
  const bytes = [0];
  for (const character of value) {
    const digit = BASE58_ALPHABET.indexOf(character);
    if (digit < 0) throw new Error('Invalid Base58 character');
    let carry = digit;
    for (let index = 0; index < bytes.length; index++) {
      carry += bytes[index] * 58;
      bytes[index] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }

  for (let index = 0; index < value.length && value[index] === '1'; index++) bytes.push(0);
  if (value.length === 0) return new Uint8Array();
  return Uint8Array.from(bytes.reverse());
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

export interface SolanaChainAdapterOptions {
  networkId?: CanonicalNetworkId;
  rpcUrl?: string;
  fetchFn?: typeof fetch;
  timeoutMs?: number;
}

interface SolanaRpcResponse<T> {
  jsonrpc: '2.0';
  id: number | string;
  result?: T;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

/** Minimal on-chain account snapshot returned by getAccountInfo (base64 data decoded). */
export interface SolanaAccountSnapshot {
  owner: string;
  lamports: number;
  executable: boolean;
  data: Uint8Array;
}

/** Normalized view of a confirmed transaction returned by getTransactionSummary. */
export interface SolanaTransactionSummary {
  slot: number;
  err: unknown | null;
  /** All account keys referenced by the message (static keys + loaded lookup-table keys). */
  accountKeys: string[];
  /** Account keys that signed the transaction (first numRequiredSignatures static keys). */
  signers: string[];
  /** Program ids invoked by top-level instructions. */
  invokedProgramIds: string[];
  /** Top-level instructions with resolved account keys and raw instruction data. */
  instructions: Array<{ programId: string; accounts: string[]; data: Uint8Array }>;
}

interface SignatureStatusResult {
  slot: number;
  confirmations: number | null;
  err: unknown | null;
  confirmationStatus: 'processed' | 'confirmed' | 'finalized' | null;
}

export class SolanaChainAdapter implements IChainAdapter<'solana'> {
  public readonly family = 'solana' as const;
  public readonly networkId: CanonicalNetworkId;
  public readonly environment: NetworkEnvironment;
  protected readonly rpcUrl: string;
  protected readonly fetchClient: typeof fetch;
  protected readonly timeoutMs: number;

  constructor(options: SolanaChainAdapterOptions = {}) {
    this.networkId = options.networkId ?? 'solana:devnet';
    const config = getNetworkConfig(this.networkId);
    if (config.family !== 'solana') {
      throw new Error(`Cannot initialize SolanaChainAdapter with non-Solana network: ${this.networkId}`);
    }

    // Safety guard: Prevent silent fallback to Mainnet in dev/test
    if (config.environment === 'mainnet' && !options.rpcUrl) {
      throw new Error(
        'Refusing to initialize SolanaChainAdapter for mainnet without explicit rpcUrl configuration.'
      );
    }

    this.environment = config.environment;
    this.rpcUrl = options.rpcUrl || config.rpcEndpoints[0];
    this.fetchClient = options.fetchFn ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 8000;
  }

  public isValidAddress(address: string): boolean {
    if (typeof address !== 'string') return false;
    // Reject EVM hexadecimal format immediately
    if (address.startsWith('0x')) return false;
    // Standard Solana Base58 public key length is 32 to 44 characters
    if (address.length < 32 || address.length > 44) return false;
    return BASE58_REGEX.test(address);
  }

  public isValidTxIdentifier(signature: string): boolean {
    if (typeof signature !== 'string') return false;
    // Reject EVM hexadecimal hashes
    if (signature.startsWith('0x')) return false;
    // Standard 64-byte Ed25519 signature encoded in Base58 is 87 to 88 characters
    if (signature.length < 86 || signature.length > 90) return false;
    return BASE58_REGEX.test(signature);
  }

  protected async callRpc<T>(method: string, params: unknown[] = []): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await this.fetchClient(this.rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method,
          params,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`Solana RPC HTTP error: ${response.status} ${response.statusText}`);
      }

      const data = (await response.json()) as SolanaRpcResponse<T>;
      if (data.error) {
        throw new Error(`Solana RPC error (${data.error.code}): ${data.error.message}`);
      }

      return data.result as T;
    } finally {
      clearTimeout(timer);
    }
  }

  public async getLatestBlockOrSlot(): Promise<bigint> {
    const slot = await this.callRpc<number>('getSlot', [{ commitment: 'finalized' }]);
    return BigInt(slot);
  }

  public async getTransactionStatus(identifier: ChainTxIdentifier): Promise<NormalizedTransactionReceipt> {
    if (identifier.family !== 'solana') {
      throw new TypeError(
        `Invalid identifier family for Solana adapter: expected 'solana', received '${(identifier as any).family}'.`
      );
    }

    if (!this.isValidTxIdentifier(identifier.signature)) {
      throw new Error(`Malformed Solana transaction signature: ${identifier.signature}`);
    }

    try {
      const result = await this.callRpc<{ value: (SignatureStatusResult | null)[] }>('getSignatureStatuses', [
        [identifier.signature],
        { searchTransactionHistory: true },
      ]);

      const statusItem = result?.value?.[0];

      // Missing or unobserved transaction
      if (!statusItem) {
        return {
          txId: identifier,
          networkId: this.networkId,
          blockOrSlot: 0n,
          finality: 'PROCESSED',
          status: 'unknown',
        };
      }

      const slot = BigInt(statusItem.slot || 0);

      // Reverted transaction
      if (statusItem.err !== null) {
        const finality: NormalizedTxFinality =
          statusItem.confirmationStatus === 'finalized' ? 'FINALIZED' : 'CONFIRMED';
        return {
          txId: identifier,
          networkId: this.networkId,
          blockOrSlot: slot,
          finality,
          status: 'reverted',
          confirmations: statusItem.confirmations ?? undefined,
          rawReceipt: statusItem,
        };
      }

      // Check confirmation status
      if (statusItem.confirmationStatus === 'finalized') {
        return {
          txId: identifier,
          networkId: this.networkId,
          blockOrSlot: slot,
          finality: 'FINALIZED',
          status: 'confirmed_success',
          confirmations: statusItem.confirmations ?? undefined,
          rawReceipt: statusItem,
        };
      }

      if (statusItem.confirmationStatus === 'confirmed') {
        return {
          txId: identifier,
          networkId: this.networkId,
          blockOrSlot: slot,
          finality: 'CONFIRMED',
          status: 'confirmed_success',
          confirmations: statusItem.confirmations ?? undefined,
          rawReceipt: statusItem,
        };
      }

      // Processed only: Pending / unfinalized (CRITICAL: Never label as verified!)
      return {
        txId: identifier,
        networkId: this.networkId,
        blockOrSlot: slot,
        finality: 'PROCESSED',
        status: 'pending',
        confirmations: statusItem.confirmations ?? undefined,
        rawReceipt: statusItem,
      };
    } catch (error: any) {
      const message = String(error?.message || '').toLowerCase();
      if (
        error.name === 'AbortError' ||
        message.includes('abort') ||
        message.includes('timeout') ||
        message.includes('fetch') ||
        message.includes('network') ||
        message.includes('connection')
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

  /**
   * Fetches an account at `commitment`. Returns null when the account does not exist.
   * RPC / transport failures throw (callers must fail closed).
   */
  public async getAccountInfo(
    address: string,
    commitment: 'confirmed' | 'finalized' = 'confirmed'
  ): Promise<SolanaAccountSnapshot | null> {
    if (!this.isValidAddress(address)) {
      throw new Error(`Invalid Solana account address: ${address}`);
    }
    const result = await this.callRpc<{
      value: { owner: string; lamports: number; executable: boolean; data: [string, string] } | null;
    }>('getAccountInfo', [address, { encoding: 'base64', commitment }]);

    const value = result?.value;
    if (!value) return null;
    const [encoded, encoding] = value.data || [];
    if (encoding !== 'base64' || typeof encoded !== 'string') {
      throw new Error(`Unexpected account data encoding from Solana RPC: ${encoding}`);
    }
    return {
      owner: value.owner,
      lamports: value.lamports,
      executable: value.executable,
      data: new Uint8Array(Buffer.from(encoded, 'base64')),
    };
  }

  /**
   * Fetches a transaction at `confirmed` (or `finalized`) commitment and normalizes the
   * referenced accounts / signers / invoked programs. Returns null when the RPC node
   * does not know the transaction. RPC / transport failures throw.
   */
  public async getTransactionSummary(
    signature: string,
    commitment: 'confirmed' | 'finalized' = 'confirmed'
  ): Promise<SolanaTransactionSummary | null> {
    if (!this.isValidTxIdentifier(signature)) {
      throw new Error(`Malformed Solana transaction signature: ${signature}`);
    }
    const result = await this.callRpc<{
      slot: number;
      meta: { err: unknown | null; loadedAddresses?: { writable?: string[]; readonly?: string[] } } | null;
      transaction: {
        message: {
          accountKeys: string[];
          header: { numRequiredSignatures: number };
          instructions: Array<{ programIdIndex: number; accounts?: number[]; data?: string }>;
        };
      };
    } | null>('getTransaction', [
      signature,
      { encoding: 'json', commitment, maxSupportedTransactionVersion: 0 },
    ]);

    if (!result || !result.transaction?.message) return null;
    const message = result.transaction.message;
    const staticKeys = Array.isArray(message.accountKeys) ? message.accountKeys : [];
    const loaded = result.meta?.loadedAddresses;
    const accountKeys = [
      ...staticKeys,
      ...(loaded?.writable || []),
      ...(loaded?.readonly || []),
    ];
    const numSigners = Number(message.header?.numRequiredSignatures || 0);
    const invokedProgramIds = (message.instructions || [])
      .map((ix) => accountKeys[ix.programIdIndex])
      .filter((key): key is string => typeof key === 'string');
    const instructions = (message.instructions || []).map((ix) => ({
      programId: accountKeys[ix.programIdIndex] || '',
      accounts: (ix.accounts || []).map((index) => accountKeys[index] || ''),
      // `json` encoding returns instruction data as base58.
      data: ix.data ? decodeBase58(ix.data) : new Uint8Array(),
    }));

    return {
      slot: Number(result.slot || 0),
      // A missing meta means the node cannot tell us the execution result: treat as error.
      err: result.meta ? result.meta.err ?? null : 'missing transaction meta',
      accountKeys,
      signers: staticKeys.slice(0, numSigners),
      invokedProgramIds,
      instructions,
    };
  }

  public async observeAuction(
    contractOrProgram: string,
    auctionId: string
  ): Promise<NormalizedAuctionObservation> {
    if (!this.isValidAddress(contractOrProgram)) {
      throw new Error(`Invalid Solana program or account address: ${contractOrProgram}`);
    }

    const currentSlot = await this.getLatestBlockOrSlot().catch(() => 0n);

    // No deployed VEILIO Solana program is registered yet, so do not fabricate state.
    return {
      networkId: this.networkId,
      auctionId,
      sourceContractOrProgram: contractOrProgram,
      state: 'UNKNOWN',
      seller: '',
      observedAt: Math.floor(Date.now() / 1000),
      blockOrSlot: currentSlot,
    };
  }

  public async verifySignature(
    message: string | Uint8Array,
    signature: string,
    signer: string
  ): Promise<boolean> {
    if (!this.isValidAddress(signer)) return false;
    if (!this.isValidTxIdentifier(signature)) return false;

    try {
      const publicKeyBytes = decodeBase58(signer);
      const signatureBytes = decodeBase58(signature);
      if (publicKeyBytes.length !== 32 || signatureBytes.length !== 64) return false;

      const publicKey = await globalThis.crypto.subtle.importKey(
        'raw',
        toArrayBuffer(publicKeyBytes),
        { name: 'Ed25519' },
        false,
        ['verify'],
      );
      const messageBytes = typeof message === 'string' ? new TextEncoder().encode(message) : message;
      return await globalThis.crypto.subtle.verify(
        'Ed25519',
        publicKey,
        toArrayBuffer(signatureBytes),
        toArrayBuffer(messageBytes),
      );
    } catch {
      return false;
    }
  }

  public getRpcUrl(): string {
    return this.rpcUrl;
  }

  public getCluster(): string {
    return this.environment;
  }

  /**
   * Health check utility for verifying active RPC connectivity.
   */
  public async checkHealth(): Promise<{ ok: boolean; slot: bigint; rpcUrl: string; cluster: string }> {
    try {
      const slot = await this.getLatestBlockOrSlot();
      return {
        ok: true,
        slot,
        rpcUrl: this.rpcUrl,
        cluster: this.environment,
      };
    } catch {
      return {
        ok: false,
        slot: 0n,
        rpcUrl: this.rpcUrl,
        cluster: this.environment,
      };
    }
  }
}
