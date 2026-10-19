import { createHash, createPrivateKey, randomBytes, sign as signEd25519 } from 'node:crypto';
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  Transaction,
  TransactionInstruction,
  type Commitment,
} from '@solana/web3.js';
import { VeilioSdkError } from '../errors.js';
import type { MessageSigner } from '../auth.js';
import type { Hex } from 'viem';
import {
  DEFAULT_SOLANA_AUCTION_PROGRAM_ID,
  computeSealedBidCommitment,
  SolanaAuctionState,
  createAcceptDatasetInstruction,
  createCreateAuctionInstruction,
  createClaimRefundInstruction,
  createCommitBidInstruction,
  createFinalizeInspectionTimeoutInstruction,
  createFinalizeRefundTimeoutInstruction,
  createRequestRefundInstruction,
  createRevealBidInstruction,
  createSettleAuctionInstruction,
  decodeAuctionConfigAccount,
  decodeAuctionStateAccount,
  findAuctionConfigPda,
  findAuctionPda,
  type DecodedAuctionConfig,
  type DecodedAuctionState,
} from './auction.js';
import {
  DEFAULT_SOLANA_SERVICE_ESCROW_PROGRAM_ID,
  createCancelOrRefundInstruction,
  createPartialRefundInstruction,
  createDepositServiceOrderInstruction,
  createDisputeOrderInstruction,
  createReleaseFundsInstruction,
  createSubmitDeliveryInstruction,
  decodeEscrowConfigAccount,
  decodeEscrowOrderAccount,
  findEscrowConfigPda,
  findEscrowOrderPda,
  parseSolToLamports,
  type DecodedSolanaEscrowConfig,
  type DecodedSolanaEscrowOrder,
} from './escrow.js';
import {
  createRegisterServiceInstruction,
  DEFAULT_SOLANA_SERVICE_REGISTRY_PROGRAM_ID,
  encodeBase58,
  getAnchorDiscriminator,
  type SolanaCompiledInstruction,
} from './registry.js';

/** Anything that can sign a legacy Transaction: a Phantom provider, a wallet adapter, or keypairSigner(). */
export interface SolanaSigner {
  publicKey: PublicKey;
  signTransaction<T extends Transaction>(transaction: T): Promise<T>;
}

/** Adapts a Solana wallet-adapter/Phantom provider to the message signer used by Services API auth. */
export function solanaMessageSigner(provider: {
  publicKey: PublicKey;
  signMessage(message: Uint8Array): Promise<Uint8Array | { signature: Uint8Array }>;
}): MessageSigner {
  return {
    address: provider.publicKey.toBase58(),
    async signMessage({ message }) {
      const result = await provider.signMessage(Buffer.from(message, 'utf8'));
      const signature = result instanceof Uint8Array ? result : result.signature;
      if (signature.length !== 64) throw new Error(`Solana wallet returned a ${signature.length}-byte signature; expected 64 bytes.`);
      return `0x${Buffer.from(signature).toString('hex')}` as Hex;
    },
  };
}

/** Ed25519 Services API signer for a local Solana keypair. Keep the keypair in a secure secret store. */
export function keypairMessageSigner(keypair: Keypair): MessageSigner {
  const pkcs8Prefix = Buffer.from('302e020100300506032b657004220420', 'hex');
  const privateKey = createPrivateKey({ key: Buffer.concat([pkcs8Prefix, Buffer.from(keypair.secretKey.subarray(0, 32))]), format: 'der', type: 'pkcs8' });
  return {
    address: keypair.publicKey.toBase58(),
    async signMessage({ message }) {
      return `0x${signEd25519(null, Buffer.from(message, 'utf8'), privateKey).toString('hex')}` as Hex;
    },
  };
}

/** Wraps a Keypair (e.g. an agent's devnet key) as a SolanaSigner. */
export function keypairSigner(keypair: Keypair): SolanaSigner {
  return {
    publicKey: keypair.publicKey,
    async signTransaction<T extends Transaction>(transaction: T): Promise<T> {
      transaction.partialSign(keypair);
      return transaction;
    },
  };
}

export interface VeilioSolanaClientOptions {
  connection: Connection;
  signer?: SolanaSigner;
  auctionProgramId?: string;
  escrowProgramId?: string;
  serviceRegistryProgramId?: string;
  commitment?: Commitment;
  /**
   * Default dispute reviewer for `deposit()` when the input omits `reviewer`. Use the VEILIO
   * platform reviewer wallet published for your deployment.
   */
  platformReviewer?: string;
  /** Default fee recipient for `deposit()` when the input omits `feeRecipient`. */
  platformFeeRecipient?: string;
}

/** Everything needed to reveal a Solana sealed bid. Persist it (salt included) in encrypted storage. */
export interface SolanaPreparedBid {
  auctionId: string;
  bidder: string;
  maxBidLamports: string;
  /** 32-byte salt, hex. Losing it makes the bid impossible to reveal. */
  salt: string;
  /** SHA-256 commitment, hex. */
  commitment: string;
  programId: string;
}

/**
 * SECURITY NOTE: the upgraded `veilio-service-escrow` program takes the reviewer, fee recipient and
 * fee rate from its global `EscrowConfig` PDA and ignores the values passed at deposit time.
 * `deposit()` reads that config and uses it when it exists. Before the upgrade (no config account)
 * the program stores whatever the buyer passes, so the SDK falls back to the client's
 * `platformReviewer` / `platformFeeRecipient` options and refuses a reviewer equal to the buyer or
 * seller. Sellers should check `getEscrowOrder(id).reviewer` before starting work.
 */
export interface SolanaEscrowDepositInput {
  orderId: string;
  seller: string;
  /**
   * Wallet that can resolve disputes. Defaults to the client's `platformReviewer`.
   * Must be a real signer (never a program ID) and must not be the buyer or seller.
   */
  reviewer?: string;
  /** Defaults to the client's `platformFeeRecipient`. */
  feeRecipient?: string;
  amountSol: string;
  /** Unix seconds. */
  deadline: number;
}

/**
 * Encodes an order ID into the 32-byte seed the escrow program expects.
 * Accepts a 64-char hex string as-is; otherwise UTF-8 bytes right-padded with zeros
 * (same encoding the EVM escrow uses), up to 32 bytes.
 */
export function toSolanaOrderId(orderId: string): string {
  const hex = orderId.startsWith('0x') ? orderId.slice(2) : orderId;
  if (/^[0-9a-fA-F]{64}$/.test(hex)) return hex.toLowerCase();
  const bytes = Buffer.from(orderId, 'utf8');
  if (bytes.length === 0 || bytes.length > 32) {
    throw new VeilioSdkError({ code: 'INVALID_INPUT', message: 'orderId must be 1 to 32 bytes of UTF-8, or 32 bytes of hex.' });
  }
  return Buffer.concat([bytes, Buffer.alloc(32 - bytes.length)]).toString('hex');
}

/** Converts a decimal SOL string to lamports without floating-point rounding. */
export function solToLamports(sol: string): bigint {
  const trimmed = sol.trim();
  if (!/^\d+(\.\d{1,9})?$/.test(trimmed)) {
    throw new VeilioSdkError({ code: 'INVALID_INPUT', message: `Invalid SOL amount: "${sol}" (max 9 decimals).` });
  }
  const [whole, fraction = ''] = trimmed.split('.');
  return BigInt(whole) * BigInt(LAMPORTS_PER_SOL) + BigInt(fraction.padEnd(9, '0'));
}

/**
 * Validates a base58 address. A lowercased address often still decodes to 32 bytes, so it would
 * silently point at the wrong account; real addresses with no uppercase letter are vanishingly rare.
 */
export function assertSolanaAddress(label: string, value: string): void {
  let valid = true;
  try {
    new PublicKey(value);
  } catch {
    valid = false;
  }
  if (!valid || value === value.toLowerCase()) {
    throw new VeilioSdkError({
      code: 'INVALID_INPUT',
      message: `${label} is not a valid Solana address. Base58 is case-sensitive: never lowercase it.`,
    });
  }
}

function toTransactionInstruction(ix: SolanaCompiledInstruction): TransactionInstruction {
  return new TransactionInstruction({
    programId: new PublicKey(ix.programId),
    keys: ix.accounts.map((meta) => ({
      pubkey: new PublicKey(meta.pubkey),
      isSigner: meta.isSigner,
      isWritable: meta.isWritable,
    })),
    data: Buffer.from(ix.data),
  });
}

/**
 * High-level client for VEILIO on Solana Devnet: sealed-bid auctions and service escrow.
 * Node.js 18+ (uses node:crypto and Buffer).
 */
export function createVeilioSolanaClient(options: VeilioSolanaClientOptions) {
  const { connection } = options;
  const commitment = options.commitment ?? 'confirmed';
  const auctionProgramId = options.auctionProgramId ?? DEFAULT_SOLANA_AUCTION_PROGRAM_ID;
  const escrowProgramId = options.escrowProgramId ?? DEFAULT_SOLANA_SERVICE_ESCROW_PROGRAM_ID;
  const serviceRegistryProgramId = options.serviceRegistryProgramId ?? DEFAULT_SOLANA_SERVICE_REGISTRY_PROGRAM_ID;

  function requireSigner(): SolanaSigner {
    if (!options.signer) {
      throw new VeilioSdkError({ code: 'WALLET_REQUIRED', message: 'A Solana signer is required to send transactions.' });
    }
    return options.signer;
  }

  async function send(ix: SolanaCompiledInstruction): Promise<string> {
    const signer = requireSigner();
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash(commitment);
    const tx = new Transaction({ feePayer: signer.publicKey, blockhash, lastValidBlockHeight }).add(
      toTransactionInstruction(ix)
    );
    const signed = await signer.signTransaction(tx);
    const signature = await connection.sendRawTransaction(signed.serialize());
    const result = await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, commitment);
    if (result.value.err) {
      throw new VeilioSdkError({
        code: 'TRANSACTION_REVERTED',
        message: `Solana transaction failed: ${JSON.stringify(result.value.err)}`,
        context: { signature },
      });
    }
    return signature;
  }

  // ---------------------------------------------------------------- Auctions

  /** Global AuctionConfig (platform refund reviewer), or null before the program upgrade. */
  async function getAuctionConfig(): Promise<DecodedAuctionConfig | null> {
    const { pda } = findAuctionConfigPda(auctionProgramId);
    const account = await connection.getAccountInfo(new PublicKey(pda), commitment);
    return account ? decodeAuctionConfigAccount(account.data) : null;
  }

  async function getAuction(auctionId: bigint | number | string): Promise<DecodedAuctionState | null> {
    const { pda } = findAuctionPda(BigInt(auctionId), auctionProgramId);
    const account = await connection.getAccountInfo(new PublicKey(pda), commitment);
    return account ? decodeAuctionStateAccount(account.data) : null;
  }

  async function listAuctions(): Promise<Array<DecodedAuctionState & { address: string }>> {
    const discriminator = encodeBase58(getAnchorDiscriminator('account', 'AuctionStateAccount'));
    const accounts = await connection.getProgramAccounts(new PublicKey(auctionProgramId), {
      commitment,
      filters: [{ memcmp: { offset: 0, bytes: discriminator } }],
    });
    const auctions: Array<DecodedAuctionState & { address: string }> = [];
    for (const { pubkey, account } of accounts) {
      try {
        auctions.push({ ...decodeAuctionStateAccount(account.data), address: pubkey.toBase58() });
      } catch {
        // Skip accounts from an older layout instead of failing the whole listing.
      }
    }
    return auctions.sort((a, b) => Number(b.auctionId - a.auctionId));
  }

  /** Creates a Solana Devnet listing using the platform reviewer stored in AuctionConfig. */
  async function createAuction(input: {
    itemName: string;
    description: string;
    imageUri: string;
    startingPriceSol: string;
    commitDurationSeconds: number;
    revealDurationSeconds: number;
    inspectionDurationSeconds: number;
  }): Promise<{ auctionId: string; signature: string }> {
    const seller = requireSigner().publicKey.toBase58();
    const config = await getAuctionConfig();
    if (!config) throw new VeilioSdkError({ code: 'INVALID_CONFIG', message: 'Solana AuctionConfig is not initialized; VEILIO must initialize the reviewer config before listings can be created.' });
    const auctions = await listAuctions();
    const auctionId = auctions.reduce((max, item) => item.auctionId > max ? item.auctionId : max, 0n) + 1n;
    if (await getAuction(auctionId)) throw new VeilioSdkError({ code: 'CONTRACT_ERROR', message: `Auction ID ${auctionId} is already in use; refresh and retry.` });
    let startingPriceLamports: bigint;
    try { startingPriceLamports = solToLamports(input.startingPriceSol); }
    catch (cause) { throw new VeilioSdkError({ code: 'INVALID_INPUT', message: cause instanceof Error ? cause.message : 'Invalid starting SOL price.', cause }); }
    let instruction: SolanaCompiledInstruction;
    try {
      instruction = createCreateAuctionInstruction({
        programId: auctionProgramId, seller, reviewer: config.reviewer, auctionId,
        itemName: input.itemName.trim(), description: input.description.trim(), imageUri: input.imageUri.trim(),
        startingPriceLamports, commitDurationSeconds: input.commitDurationSeconds,
        revealDurationSeconds: input.revealDurationSeconds, inspectionDurationSeconds: input.inspectionDurationSeconds,
      });
    } catch (cause) {
      throw new VeilioSdkError({ code: 'INVALID_INPUT', message: cause instanceof Error ? cause.message : 'Invalid auction input.', cause });
    }
    const signature = await send(instruction);
    return { auctionId: auctionId.toString(), signature };
  }

  /** Registers a verified service listing in the Solana Devnet service registry. */
  async function registerService(input: {
    id: string; sellerType: 'human' | 'agent'; sellerName: string; title: string;
    description: string; category: string; price: string; deliveryTime: string;
    sampleDeliverables?: string[]; metadataURI?: string;
  }): Promise<{ signature: string; createdAt: number; metadataURI: string; metadataHash: `0x${string}` }> {
    const seller = requireSigner().publicKey.toBase58();
    if (!/^[A-Za-z0-9_-]{3,32}$/.test(input.id)) throw new VeilioSdkError({ code: 'INVALID_INPUT', message: 'Service id must be 3-32 characters: letters, numbers, _ or -.' });
    if (!input.sellerName.trim() || input.title.trim().length < 5 || input.description.trim().length < 15 || !input.category.trim() || !input.deliveryTime.trim() || !Number.isFinite(Number(input.price)) || Number(input.price) <= 0) {
      throw new VeilioSdkError({ code: 'INVALID_INPUT', message: 'Service requires sellerName, deliveryTime, title (5+ chars), description (15+ chars), category, and positive price.' });
    }
    const createdAt = Date.now();
    const id = input.id.trim();
    const canonicalMetadata = {
      category: input.category.trim(), createdAt, currency: 'SOL', deliveryTime: input.deliveryTime.trim(),
      description: input.description.trim(), id, price: String(Number(input.price)),
      sampleDeliverables: (input.sampleDeliverables ?? []).map((item) => item.trim()).filter(Boolean),
      seller, sellerName: input.sellerName.trim(), sellerType: input.sellerType,
      title: input.title.trim(), version: '1.0.0',
    };
    const metadataHash = `0x${createHash('sha256').update(JSON.stringify(canonicalMetadata), 'utf8').digest('hex')}` as `0x${string}`;
    const metadataURI = input.metadataURI?.trim() || `ipfs://QmServiceMeta-${id}`;
    const serviceId = Buffer.alloc(32);
    Buffer.from(id, 'utf8').copy(serviceId);
    let instruction: SolanaCompiledInstruction;
    try {
      instruction = createRegisterServiceInstruction({ programId: serviceRegistryProgramId, seller, serviceId, metadataHash, metadataUri: metadataURI });
    } catch (cause) {
      throw new VeilioSdkError({ code: 'INVALID_INPUT', message: cause instanceof Error ? cause.message : 'Invalid Solana service metadata.', cause });
    }
    const signature = await send(instruction);
    return { signature, createdAt, metadataURI, metadataHash };
  }

  function prepareBid(auctionId: bigint | number | string, maxBidSol: string): SolanaPreparedBid {
    const bidder = requireSigner().publicKey.toBase58();
    const id = BigInt(auctionId);
    const maxBidLamports = solToLamports(maxBidSol);
    if (id < 0n || maxBidLamports <= 0n) {
      throw new VeilioSdkError({ code: 'INVALID_INPUT', message: 'auctionId must be >= 0 and maxBid must be positive.' });
    }
    const salt = randomBytes(32);
    const { pda: auctionPda } = findAuctionPda(id, auctionProgramId);
    const commitmentHash = computeSealedBidCommitment({ auctionPubkey: auctionPda, bidderPubkey: bidder, maxBidLamports, salt });
    return {
      auctionId: id.toString(),
      bidder,
      maxBidLamports: maxBidLamports.toString(),
      salt: salt.toString('hex'),
      commitment: commitmentHash.toString('hex'),
      programId: auctionProgramId,
    };
  }

  /** Commits the sealed bid. Deposit must cover the max bid; over-deposit to hide your ceiling. */
  async function commitBid(prepared: SolanaPreparedBid, depositSol: string): Promise<string> {
    const depositLamports = solToLamports(depositSol);
    if (depositLamports < BigInt(prepared.maxBidLamports)) {
      throw new VeilioSdkError({ code: 'INVALID_INPUT', message: 'Deposit must cover the maximum bid.' });
    }
    return send(
      createCommitBidInstruction({
        programId: prepared.programId,
        auctionId: BigInt(prepared.auctionId),
        bidder: prepared.bidder,
        commitment: Buffer.from(prepared.commitment, 'hex'),
        depositLamports,
      })
    );
  }

  async function revealBid(prepared: SolanaPreparedBid): Promise<string> {
    return send(
      createRevealBidInstruction({
        programId: prepared.programId,
        auctionId: BigInt(prepared.auctionId),
        bidder: prepared.bidder,
        maxBidLamports: BigInt(prepared.maxBidLamports),
        salt: Buffer.from(prepared.salt, 'hex'),
      })
    );
  }

  /** Winner accepts the asset during inspection, releasing payment to the seller. */
  async function acceptDataset(auctionId: bigint | number | string, seller: string): Promise<string> {
    return send(
      createAcceptDatasetInstruction({
        programId: auctionProgramId,
        auctionId: BigInt(auctionId),
        seller,
        winner: requireSigner().publicKey.toBase58(),
      })
    );
  }

  /** Losing bidders reclaim their deposit after settlement. */
  async function claimRefund(auctionId: bigint | number | string): Promise<string> {
    return send(
      createClaimRefundInstruction({
        programId: auctionProgramId,
        auctionId: BigInt(auctionId),
        bidder: requireSigner().publicKey.toBase58(),
      })
    );
  }

  async function requireAuction(auctionId: bigint | number | string): Promise<DecodedAuctionState> {
    const auction = await getAuction(auctionId);
    if (!auction) {
      throw new VeilioSdkError({ code: 'NOT_FOUND', message: `Auction ${auctionId} not found on Solana.` });
    }
    return auction;
  }

  /** Anyone: closes the reveal phase after reveal_end_time (Inspection with a winner, else Completed). */
  async function settleAuction(auctionId: bigint | number | string): Promise<string> {
    requireSigner();
    return send(createSettleAuctionInstruction({ programId: auctionProgramId, auctionId: BigInt(auctionId) }));
  }

  /**
   * Winner disputes the asset during inspection. `evidenceHash` is 32 bytes (hex string or bytes),
   * e.g. sha256 of your evidence bundle. The auction reviewer then calls review_refund; if it does
   * not act within 7 days the winner can call `finalizeRefundTimeout`.
   */
  async function requestRefund(auctionId: bigint | number | string, evidenceHash: string | Uint8Array): Promise<string> {
    const hash = typeof evidenceHash === 'string' ? Buffer.from(evidenceHash.replace(/^0x/, ''), 'hex') : Buffer.from(evidenceHash);
    if (hash.length !== 32 || hash.every((b) => b === 0)) {
      throw new VeilioSdkError({ code: 'INVALID_INPUT', message: 'evidenceHash must be 32 non-zero bytes (64 hex chars).' });
    }
    return send(
      createRequestRefundInstruction({
        programId: auctionProgramId,
        auctionId: BigInt(auctionId),
        winner: requireSigner().publicKey.toBase58(),
        evidenceHash: hash,
      })
    );
  }

  /** Anyone: pays the seller once inspection ended without a refund request. Accounts are read from the auction. */
  async function finalizeInspectionTimeout(auctionId: bigint | number | string): Promise<string> {
    const caller = requireSigner().publicKey.toBase58();
    const auction = await requireAuction(auctionId);
    if (auction.state !== SolanaAuctionState.Inspection) {
      throw new VeilioSdkError({ code: 'INVALID_INPUT', message: 'Auction is not in Inspection.' });
    }
    return send(
      createFinalizeInspectionTimeoutInstruction({
        programId: auctionProgramId,
        auctionId: BigInt(auctionId),
        seller: auction.seller,
        winner: auction.highestBidder,
        caller,
      })
    );
  }

  /** Winner: refunds itself when the reviewer has not resolved a refund request within 7 days. */
  async function finalizeRefundTimeout(auctionId: bigint | number | string): Promise<string> {
    return send(
      createFinalizeRefundTimeoutInstruction({
        programId: auctionProgramId,
        auctionId: BigInt(auctionId),
        winner: requireSigner().publicKey.toBase58(),
      })
    );
  }

  // ---------------------------------------------------------- Service escrow

  async function getEscrowOrder(orderId: string): Promise<DecodedSolanaEscrowOrder | null> {
    const { pda } = findEscrowOrderPda(toSolanaOrderId(orderId), escrowProgramId);
    const account = await connection.getAccountInfo(new PublicKey(pda), commitment);
    return account ? decodeEscrowOrderAccount(account.data) : null;
  }

  /** Global EscrowConfig (platform reviewer, fee recipient, fee bps), or null before the program upgrade. */
  async function getEscrowConfig(): Promise<DecodedSolanaEscrowConfig | null> {
    const { pda } = findEscrowConfigPda(escrowProgramId);
    const account = await connection.getAccountInfo(new PublicKey(pda), commitment);
    return account ? decodeEscrowConfigAccount(account.data) : null;
  }

  async function deposit(input: SolanaEscrowDepositInput): Promise<string> {
    const buyer = requireSigner().publicKey.toBase58();
    // The upgraded program snapshots the on-chain config and ignores the passed values.
    const config = await getEscrowConfig();
    const reviewer = config?.reviewer ?? input.reviewer ?? options.platformReviewer;
    const feeRecipient = config?.feeRecipient ?? input.feeRecipient ?? options.platformFeeRecipient;
    if (!reviewer || !feeRecipient) {
      throw new VeilioSdkError({
        code: 'INVALID_CONFIG',
        message:
          'reviewer and feeRecipient are required: pass them, or set platformReviewer / platformFeeRecipient on createVeilioSolanaClient().',
      });
    }
    if (reviewer === escrowProgramId || reviewer === auctionProgramId) {
      throw new VeilioSdkError({
        code: 'INVALID_INPUT',
        message: 'reviewer must be a wallet that can sign; a program ID can never resolve a dispute.',
      });
    }
    for (const [label, value] of [['seller', input.seller], ['reviewer', reviewer], ['feeRecipient', feeRecipient]]) {
      assertSolanaAddress(label, value);
    }
    if (reviewer === buyer || reviewer === input.seller) {
      throw new VeilioSdkError({
        code: 'INVALID_INPUT',
        message: 'reviewer must be an independent wallet (the platform reviewer), not the buyer or seller.',
      });
    }
    if (input.deadline <= Math.floor(Date.now() / 1000)) {
      throw new VeilioSdkError({ code: 'INVALID_INPUT', message: 'Deadline must be in the future.' });
    }
    return send(
      createDepositServiceOrderInstruction({
        programId: escrowProgramId,
        buyer,
        seller: input.seller,
        reviewer,
        feeRecipient,
        orderId: toSolanaOrderId(input.orderId),
        amountLamports: solToLamports(input.amountSol),
        deadline: input.deadline,
      })
    );
  }

  async function submitDelivery(orderId: string, deliverableReference: string): Promise<string> {
    return send(
      createSubmitDeliveryInstruction({
        programId: escrowProgramId,
        seller: requireSigner().publicKey.toBase58(),
        orderId: toSolanaOrderId(orderId),
        deliverableReference,
      })
    );
  }

  /** Buyer releases escrow to the seller (5% fee to feeRecipient). Accounts are read from the order. */
  async function releaseFunds(orderId: string): Promise<string> {
    const order = await getEscrowOrder(orderId);
    if (!order) throw new VeilioSdkError({ code: 'NOT_FOUND', message: `Escrow order ${orderId} not found on Solana.` });
    return send(
      createReleaseFundsInstruction({
        programId: escrowProgramId,
        buyer: requireSigner().publicKey.toBase58(),
        seller: order.seller,
        feeRecipient: order.feeRecipient,
        orderId: toSolanaOrderId(orderId),
      })
    );
  }

  /** Seller cancellation, or buyer refund after the deadline. Fee-free. */
  async function refund(orderId: string, reason: string): Promise<string> {
    const order = await getEscrowOrder(orderId);
    if (!order) throw new VeilioSdkError({ code: 'NOT_FOUND', message: `Escrow order ${orderId} not found on Solana.` });
    return send(
      createCancelOrRefundInstruction({
        programId: escrowProgramId,
        caller: requireSigner().publicKey.toBase58(),
        buyer: order.buyer,
        orderId: toSolanaOrderId(orderId),
        reason,
      })
    );
  }

  /**
   * Seller: returns `amountSol` (e.g. "0.03") to the buyer after agreeing a lower price; the order
   * stays active with the remaining escrow. Use `refund` to return everything.
   */
  async function partialRefund(orderId: string, amountSol: string, reason: string): Promise<string> {
    const order = await getEscrowOrder(orderId);
    if (!order) throw new VeilioSdkError({ code: 'NOT_FOUND', message: `Escrow order ${orderId} not found on Solana.` });
    return send(
      createPartialRefundInstruction({
        programId: escrowProgramId,
        seller: requireSigner().publicKey.toBase58(),
        buyer: order.buyer,
        orderId: toSolanaOrderId(orderId),
        refundLamports: parseSolToLamports(amountSol),
        reason,
      })
    );
  }

  async function dispute(orderId: string, reason: string): Promise<string> {
    return send(
      createDisputeOrderInstruction({
        programId: escrowProgramId,
        caller: requireSigner().publicKey.toBase58(),
        orderId: toSolanaOrderId(orderId),
        reason,
      })
    );
  }

  return {
    address: options.signer?.publicKey.toBase58(),
    auctionProgramId,
    escrowProgramId,
    getAuctionConfig,
    getAuction,
    listAuctions,
    createAuction,
    registerService,
    prepareBid,
    commitBid,
    revealBid,
    settleAuction,
    acceptDataset,
    requestRefund,
    finalizeInspectionTimeout,
    finalizeRefundTimeout,
    claimRefund,
    getEscrowConfig,
    getEscrowOrder,
    deposit,
    submitDelivery,
    releaseFunds,
    refund,
    partialRefund,
    dispute,
  };
}
