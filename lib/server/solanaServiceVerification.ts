/**
 * Fail-closed server-side verification of Solana Services escrow transactions.
 *
 * A Solana signature is only accepted when ALL of the following hold:
 *   1. The signature status is confirmed/finalized and not errored ('unknown', 'pending',
 *      'reverted' and RPC failures are rejected).
 *   2. getTransaction returns the transaction with meta.err === null, it invokes the
 *      configured escrow program, references this order's EscrowOrder PDA and (when
 *      requested) was signed by the expected wallet.
 *   3. The EscrowOrder PDA account is owned by the escrow program, decodes correctly and
 *      matches the stored order (order id, buyer, seller, status, and optionally amount,
 *      reviewer, fee recipient, deadline).
 *
 * Platform reviewer / fee recipient: once the upgraded program's global EscrowConfig PDA
 * ([b"escrow_config"]) exists, it is the source of truth (the program snapshots it into every
 * new order and authorizes resolve_dispute against it). Before the upgrade (no config account)
 * the env values (NEXT_PUBLIC_SOLANA_SERVICE_REVIEWER / NEXT_PUBLIC_SOLANA_FEE_RECIPIENT) apply.
 */

import { SolanaChainAdapter } from '../cross-chain/SolanaChainAdapter';
import {
  decodeEscrowConfigAccount,
  decodeEscrowOrderAccount,
  findEscrowConfigPda,
  findEscrowOrderPda,
  getSolanaServiceEscrowProgramId,
  toSolanaEscrowOrderIdHex,
  type DecodedSolanaEscrowOrder,
  type SolanaServiceEscrowStatus,
} from '../cross-chain/solanaServiceEscrow';
import { getAnchorDiscriminator } from '../cross-chain/solanaServiceRegistry';

export interface SolanaEscrowExpectation {
  /** App order id (or its escrowReference); mapped to the bytes32 escrow id. */
  orderId: string;
  buyer: string;
  seller: string;
  allowedStatuses: SolanaServiceEscrowStatus[];
  minAmountLamports?: bigint;
  expectedReviewer?: string;
  expectedFeeRecipient?: string;
  /** Escrow deadline (unix seconds) must be >= this value. */
  minDeadlineSec?: number;
  /** Wallet that must have signed the transaction. */
  requiredSigner?: string;
  /**
   * Anchor instruction (e.g. 'deposit', 'release_funds') that the transaction must invoke
   * on the escrow program with this order's escrow account.
   */
  instruction?: string;
  /** Exact instruction argument bytes (after the 8-byte discriminator), when they matter. */
  instructionArgs?: Uint8Array;
  /**
   * Require the escrow's reviewer / fee recipient to be the PLATFORM's: the on-chain EscrowConfig
   * when it exists, else these env values (pre-upgrade). Overrides expectedReviewer /
   * expectedFeeRecipient. Fails closed when neither source is available.
   */
  platform?: { envReviewer?: string | null; envFeeRecipient?: string | null };
}

export interface SolanaEscrowPlatformConfig {
  /** 'onchain-config' after the program upgrade + initialize_config, 'env' before. */
  source: 'onchain-config' | 'env';
  reviewer: string;
  feeRecipient: string | null;
  feeBasisPoints?: number;
  configPda: string;
}

export type SolanaEscrowPlatformResult =
  | ({ ok: true } & SolanaEscrowPlatformConfig)
  | { ok: false; status: number; error: string };

/**
 * Resolves the platform reviewer / fee recipient for Solana escrow orders: the on-chain
 * EscrowConfig PDA when it exists, otherwise the env fallback (pre-upgrade). Fail-closed: an RPC
 * error, a config account not owned by the escrow program or an undecodable one is an error,
 * never a silent fallback to env.
 */
export async function resolveSolanaEscrowPlatformConfig(params: {
  adapter?: SolanaChainAdapter;
  programId?: string;
  envReviewer?: string | null;
  envFeeRecipient?: string | null;
} = {}): Promise<SolanaEscrowPlatformResult> {
  const adapter = params.adapter ?? new SolanaChainAdapter({ networkId: 'solana:devnet' });
  const programId = params.programId ?? getSolanaServiceEscrowProgramId();
  const configPda = findEscrowConfigPda(programId).pda;

  let account;
  try {
    account = await adapter.getAccountInfo(configPda);
  } catch (err: any) {
    return { ok: false, status: 503, error: `Solana RPC error while reading the escrow config: ${err?.message || err}` };
  }

  if (account) {
    if (account.owner !== programId) {
      return { ok: false, status: 500, error: `Escrow config account ${configPda} is not owned by the Services escrow program` };
    }
    try {
      const config = decodeEscrowConfigAccount(account.data);
      return {
        ok: true,
        source: 'onchain-config',
        reviewer: config.reviewer,
        feeRecipient: config.feeRecipient,
        feeBasisPoints: config.feeBasisPoints,
        configPda,
      };
    } catch (err: any) {
      return { ok: false, status: 500, error: `Escrow config account could not be decoded: ${err?.message || err}` };
    }
  }

  const envReviewer = (params.envReviewer || '').trim();
  if (!envReviewer) {
    return {
      ok: false,
      status: 503,
      error: 'Solana escrow config is not initialized on-chain and NEXT_PUBLIC_SOLANA_SERVICE_REVIEWER is not configured.',
    };
  }
  return {
    ok: true,
    source: 'env',
    reviewer: envReviewer,
    feeRecipient: (params.envFeeRecipient || '').trim() || null,
    configPda,
  };
}

export type SolanaEscrowVerificationResult =
  | {
      ok: true;
      escrow: DecodedSolanaEscrowOrder;
      escrowPda: string;
      programId: string;
      /** Set when `expectation.platform` was requested. */
      platform?: SolanaEscrowPlatformConfig;
    }
  | { ok: false; status: number; error: string };

function fail(status: number, error: string): SolanaEscrowVerificationResult {
  return { ok: false, status, error };
}

export async function verifySolanaEscrowTransaction(params: {
  signature: string;
  expectation: SolanaEscrowExpectation;
  adapter?: SolanaChainAdapter;
  programId?: string;
}): Promise<SolanaEscrowVerificationResult> {
  const { signature, expectation } = params;
  const adapter = params.adapter ?? new SolanaChainAdapter({ networkId: 'solana:devnet' });
  const programId = params.programId ?? getSolanaServiceEscrowProgramId();

  if (typeof signature !== 'string' || !adapter.isValidTxIdentifier(signature)) {
    return fail(400, 'Malformed Solana transaction signature');
  }

  let orderIdHex: string;
  let escrowPda: string;
  try {
    orderIdHex = toSolanaEscrowOrderIdHex(expectation.orderId);
    escrowPda = findEscrowOrderPda(orderIdHex, programId).pda;
  } catch (err: any) {
    return fail(400, `Cannot derive Solana escrow account for order: ${err?.message || err}`);
  }

  // 1. Signature status (fail closed on anything but a confirmed success)
  let status;
  try {
    status = await adapter.getTransactionStatus({ family: 'solana', networkId: adapter.networkId, signature });
  } catch (err: any) {
    return fail(503, `Solana RPC error while checking transaction status: ${err?.message || err}`);
  }
  if (status.status === 'rpc_unavailable') {
    return fail(503, 'Solana RPC is unavailable; transaction could not be verified. Please retry.');
  }
  if (status.status === 'reverted') {
    return fail(400, 'Solana transaction failed on-chain');
  }
  if (status.status !== 'confirmed_success') {
    return fail(409, `Solana transaction is not confirmed yet (status: ${status.status}). Retry once it is confirmed.`);
  }

  // 2. Transaction content
  let tx;
  try {
    tx = await adapter.getTransactionSummary(signature);
  } catch (err: any) {
    return fail(503, `Solana RPC error while fetching transaction: ${err?.message || err}`);
  }
  if (!tx) {
    return fail(409, 'Solana transaction not found at confirmed commitment');
  }
  if (tx.err !== null) {
    return fail(400, 'Solana transaction executed with an error');
  }
  if (!tx.invokedProgramIds.includes(programId)) {
    return fail(400, `Transaction does not invoke the Services escrow program (${programId})`);
  }
  if (!tx.accountKeys.includes(escrowPda)) {
    return fail(400, `Transaction does not reference this order's escrow account (${escrowPda})`);
  }
  if (expectation.instruction) {
    const discriminator = getAnchorDiscriminator('global', expectation.instruction);
    const matching = tx.instructions.some((ix) => {
      if (ix.programId !== programId || !ix.accounts.includes(escrowPda)) return false;
      const data = Buffer.from(ix.data);
      if (data.length < 8 || !data.subarray(0, 8).equals(discriminator)) return false;
      if (expectation.instructionArgs) {
        return data.subarray(8).equals(Buffer.from(expectation.instructionArgs));
      }
      return true;
    });
    if (!matching) {
      return fail(400, `Transaction has no matching '${expectation.instruction}' instruction for this order`);
    }
  }
  if (expectation.requiredSigner && !tx.signers.includes(expectation.requiredSigner)) {
    return fail(403, `Transaction was not signed by the expected wallet (${expectation.requiredSigner})`);
  }

  // 3. Escrow account state
  let account;
  try {
    account = await adapter.getAccountInfo(escrowPda);
  } catch (err: any) {
    return fail(503, `Solana RPC error while reading escrow account: ${err?.message || err}`);
  }
  if (!account) {
    return fail(400, `Escrow account ${escrowPda} does not exist on-chain`);
  }
  if (account.owner !== programId) {
    return fail(400, `Escrow account owner (${account.owner}) is not the Services escrow program`);
  }

  let escrow: DecodedSolanaEscrowOrder;
  try {
    escrow = decodeEscrowOrderAccount(account.data);
  } catch (err: any) {
    return fail(400, `Escrow account could not be decoded: ${err?.message || err}`);
  }

  if (escrow.orderIdHex.toLowerCase() !== orderIdHex.toLowerCase()) {
    return fail(400, 'Escrow account order id does not match this order');
  }
  if (escrow.buyer !== expectation.buyer) {
    return fail(400, `Escrow buyer (${escrow.buyer}) does not match order buyer (${expectation.buyer})`);
  }
  if (escrow.seller !== expectation.seller) {
    return fail(400, `Escrow seller (${escrow.seller}) does not match order seller (${expectation.seller})`);
  }
  if (!expectation.allowedStatuses.includes(escrow.status)) {
    return fail(400, `Escrow status is '${escrow.status}' (expected ${expectation.allowedStatuses.join(' or ')})`);
  }
  if (expectation.minAmountLamports !== undefined && escrow.amountLamports < expectation.minAmountLamports) {
    return fail(
      400,
      `Escrow amount (${escrow.amountLamports} lamports) is less than the order price (${expectation.minAmountLamports} lamports)`
    );
  }
  let expectedReviewer = expectation.expectedReviewer;
  let expectedFeeRecipient = expectation.expectedFeeRecipient;
  let platform: SolanaEscrowPlatformConfig | undefined;
  if (expectation.platform) {
    const resolved = await resolveSolanaEscrowPlatformConfig({
      adapter,
      programId,
      envReviewer: expectation.platform.envReviewer,
      envFeeRecipient: expectation.platform.envFeeRecipient,
    });
    if (!resolved.ok) return fail(resolved.status, resolved.error);
    const { ok: _ok, ...rest } = resolved;
    platform = rest;
    expectedReviewer = resolved.reviewer;
    expectedFeeRecipient = resolved.feeRecipient ?? undefined;
  }
  const platformLabel = platform?.source === 'onchain-config' ? 'on-chain config' : 'platform';
  if (expectedReviewer && escrow.reviewer !== expectedReviewer) {
    return fail(400, `Escrow reviewer (${escrow.reviewer}) is not the ${platformLabel} reviewer (${expectedReviewer})`);
  }
  if (expectedFeeRecipient && escrow.feeRecipient !== expectedFeeRecipient) {
    return fail(400, `Escrow fee recipient (${escrow.feeRecipient}) is not the ${platformLabel} fee recipient`);
  }
  if (expectation.minDeadlineSec !== undefined && escrow.deadline < expectation.minDeadlineSec) {
    return fail(400, `Escrow deadline (${escrow.deadline}) is earlier than the agreed order deadline (${expectation.minDeadlineSec})`);
  }

  return { ok: true, escrow, escrowPda, programId, ...(platform ? { platform } : {}) };
}
