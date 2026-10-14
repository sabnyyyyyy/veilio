import { NextRequest, NextResponse } from 'next/server';
import {
  getDisputeById,
  getOrderById,
  recordReviewerDecision,
  sameWalletAddress,
  normalizeServiceNetwork,
  getOrderNetwork,
  type ServiceNetworkId,
} from '@/lib/server/servicesDb';
import { decodeFunctionData, isAddress, toEventSelector } from 'viem';
import { getAgentPublicClientForChain } from '@/lib/agent-sdk/server';
import { VEIL_SERVICE_ESCROW_ABI, getServiceEscrowAddress } from '@/lib/serviceContract';
import { formatServiceOrderId } from '@/lib/agent-sdk';
import { verifyServiceAuth, isSolanaAddress } from '@/lib/server/serviceAuth';
import { getSolanaServiceReviewer } from '@/lib/cross-chain/solanaServiceEscrow';
import {
  resolveSolanaEscrowPlatformConfig,
  verifySolanaEscrowTransaction,
} from '@/lib/server/solanaServiceVerification';
import {
  networkDisplayName,
  resolveOrderNetworkForRequest,
  servicesErrorStatus,
} from '@/lib/server/serviceOrderNetwork';

import { withJsonStores } from '@/lib/server/jsonStore';
interface ReviewerConfig {
  reviewer: string | null;
  escrow: string | null;
  error?: string;
  /** Solana only: where the reviewer came from. */
  source?: 'onchain-config' | 'env';
}

/**
 * Configured platform reviewer for a settlement network:
 *   - EVM (BNB 97 / Base 84532): REVIEWER_ADDRESS (must equal the escrow contract's reviewer)
 *   - Solana Devnet: the reviewer in the escrow program's on-chain EscrowConfig PDA (the only
 *     wallet the upgraded program lets sign resolve_dispute); before the upgrade, when that
 *     account does not exist yet, NEXT_PUBLIC_SOLANA_SERVICE_REVIEWER.
 */
async function getReviewerConfig(network: ServiceNetworkId): Promise<ReviewerConfig> {
  if (network === 'solana:devnet') {
    const envReviewer = getSolanaServiceReviewer();
    const platform = await resolveSolanaEscrowPlatformConfig({
      envReviewer: envReviewer && isSolanaAddress(envReviewer) ? envReviewer : null,
    });
    if (!platform.ok) {
      return { reviewer: null, escrow: null, error: platform.error };
    }
    return { reviewer: platform.reviewer, escrow: null, source: platform.source };
  }
  const reviewer = process.env.REVIEWER_ADDRESS || '';
  const escrow = getServiceEscrowAddress(network === 'base:84532' ? 84532 : 97);
  if (!reviewer || !isAddress(reviewer) || !escrow || !isAddress(escrow)) {
    return { reviewer: null, escrow: null, error: `Reviewer address or service escrow contract is not configured for ${networkDisplayName(network)}.` };
  }
  return { reviewer: reviewer.toLowerCase(), escrow };
}

/**
 * Reviewer preflight. `?network=` (or the dispute's order network) selects the chain;
 * defaults to BNB Testnet for backward compatibility.
 */
async function handleGET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: disputeId } = await params;
  const { searchParams } = new URL(req.url);
  let network: ServiceNetworkId = normalizeServiceNetwork(searchParams.get('network')) || 'bnb:97';
  const dispute = disputeId ? getDisputeById(disputeId) : null;
  const order = dispute ? getOrderById(dispute.orderId) : null;
  if (order) network = getOrderNetwork(order);

  const config = await getReviewerConfig(network);
  const configured = Boolean(config.reviewer);
  return NextResponse.json({
    ready: configured,
    network,
    reviewerAddress: configured ? config.reviewer : null,
    escrowAddress: config.escrow,
    error: configured ? undefined : config.error,
  }, { status: configured ? 200 : 503 });
}

async function handlePOST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: disputeId } = await params;
    const dispute = getDisputeById(disputeId);
    if (!dispute) {
      return NextResponse.json({ error: 'Dispute not found' }, { status: 404 });
    }

    const order = getOrderById(dispute.orderId);
    if (!order) {
      return NextResponse.json({ error: 'Associated order not found' }, { status: 404 });
    }

    const body = await req.json();
    const {
      reviewerAddress,
      decision,
      buyerRefundPercent,
      sellerGrossAwardPercent,
      reason,
      settlementTxHash,
      auth,
      network: reqNetwork,
    } = body;

    const caller = reviewerAddress || auth?.address;
    if (!caller || typeof caller !== 'string' || (!isAddress(caller) && !isSolanaAddress(caller)) || !decision || typeof reason !== 'string' || !reason.trim()) {
      return NextResponse.json(
        { error: 'Missing required fields: reviewerAddress, decision, and reason are required' },
        { status: 400 }
      );
    }
    if (!['approved_as_recommended', 'revised_and_approved'].includes(decision)) {
      return NextResponse.json({ error: 'Invalid reviewer decision.' }, { status: 400 });
    }

    // Rule: Neither buyer nor seller may approve their own dispute outcome
    if (sameWalletAddress(caller, order.buyerId) || sameWalletAddress(caller, order.sellerId)) {
      return NextResponse.json(
        { error: 'Unauthorized: neither buyer nor seller may approve their own dispute outcome' },
        { status: 403 }
      );
    }

    if (order.status !== 'Disputed' || dispute.status === 'resolved') {
      return NextResponse.json(
        { error: `Dispute cannot be settled: order is '${order.status}', dispute is '${dispute.status}'` },
        { status: 409 }
      );
    }

    const resolved = resolveOrderNetworkForRequest(order, reqNetwork);
    if (!resolved.ok) {
      return NextResponse.json({ error: resolved.error }, { status: resolved.status });
    }

    // 1. Strictly Enforce Configured Reviewer Address for this network (AUDIT-004)
    const config = await getReviewerConfig(resolved.network);
    if (!config.reviewer) {
      return NextResponse.json(
        { error: `Reviewer settlement is disabled: ${config.error}` },
        { status: 503 }
      );
    }
    if (!sameWalletAddress(caller, config.reviewer)) {
      return NextResponse.json(
        { error: `Forbidden: caller ${caller} is not authorized as the platform reviewer (${config.reviewer})` },
        { status: 403 }
      );
    }

    // 2. Cryptographic wallet authentication (AUDIT-001) - EIP-191 or Ed25519
    const authResult = await verifyServiceAuth({
      action: 'review-dispute',
      orderId: disputeId,
      expectedAddress: config.reviewer,
      auth: auth || {
        address: caller,
        signature: body.signature,
        timestamp: body.timestamp,
        nonce: body.nonce,
      },
    });

    if (!authResult.valid) {
      return NextResponse.json(
        { error: authResult.error || 'Reviewer authentication failed' },
        { status: authResult.status || 401 }
      );
    }

    let bRefund = Number(buyerRefundPercent);
    let sAward = Number(sellerGrossAwardPercent);

    if (isNaN(bRefund) || isNaN(sAward)) {
      if (dispute.recommendation) {
        bRefund = dispute.recommendation.recommendedDistribution.buyerRefundPercent;
        sAward = dispute.recommendation.recommendedDistribution.sellerGrossAwardPercent;
      } else {
        return NextResponse.json(
          { error: 'buyerRefundPercent and sellerGrossAwardPercent are required' },
          { status: 400 }
        );
      }
    }

    if (!Number.isInteger(bRefund) || !Number.isInteger(sAward) || bRefund + sAward !== 100) {
      return NextResponse.json(
        { error: 'buyerRefundPercent and sellerGrossAwardPercent must sum to exactly 100%' },
        { status: 400 }
      );
    }

    if (bRefund < 0 || bRefund > 100 || sAward < 0 || sAward > 100) {
      return NextResponse.json(
        { error: 'Refund percentages must be bounded between 0% and 100%' },
        { status: 400 }
      );
    }

    if (typeof settlementTxHash !== 'string' || !settlementTxHash) {
      return NextResponse.json({ error: 'A valid settlementTxHash is required.' }, { status: 400 });
    }

    // A reviewer decision is only recorded after the exact split was settled on-chain.
    if (resolved.network === 'solana:devnet') {
      const verification = await verifySolanaEscrowTransaction({
        signature: settlementTxHash,
        expectation: {
          orderId: order.escrowReference || order.id,
          buyer: order.buyerId,
          seller: order.sellerId,
          allowedStatuses: [bRefund === 100 ? 'Refunded' : 'Released'],
          // Post-upgrade the program authorizes the CURRENT config reviewer (requiredSigner), so
          // an order snapshotted before a reviewer rotation is still settleable; pre-upgrade the
          // stored order reviewer must be the env platform reviewer.
          expectedReviewer: config.source === 'onchain-config' ? undefined : config.reviewer,
          requiredSigner: config.reviewer,
          instruction: 'resolve_dispute',
          instructionArgs: Uint8Array.from([bRefund]),
        },
      });
      if (!verification.ok) {
        return NextResponse.json({ error: verification.error }, { status: verification.status });
      }
    } else {
      if (!/^0x[a-fA-F0-9]{64}$/.test(settlementTxHash)) {
        return NextResponse.json({ error: 'A valid settlementTxHash is required.' }, { status: 400 });
      }
      const chainId = resolved.chainId as number;
      const targetContractAddr = config.escrow as string;
      const client = getAgentPublicClientForChain(chainId);

      let receipt;
      let transaction;
      try {
        const hash = settlementTxHash as `0x${string}`;
        [receipt, transaction] = await Promise.all([
          client.getTransactionReceipt({ hash }),
          client.getTransaction({ hash }),
        ]);
      } catch (rpcErr: any) {
        return NextResponse.json(
          { error: `Settlement transaction is not confirmed on-chain (${networkDisplayName(resolved.network)}): ${rpcErr?.shortMessage || rpcErr?.message || 'Transaction receipt not found'}` },
          { status: 400 }
        );
      }

      if (receipt.status !== 'success' || !receipt.to || receipt.to.toLowerCase() !== targetContractAddr.toLowerCase()) {
        return NextResponse.json({ error: 'Settlement transaction must succeed and target the configured service escrow contract.' }, { status: 400 });
      }
      if (!sameWalletAddress(transaction.from, config.reviewer)) {
        return NextResponse.json({ error: 'Settlement transaction signer does not match the authenticated reviewer.' }, { status: 403 });
      }

      const expectedOrderIdHex = formatServiceOrderId(order.escrowReference || order.id).toLowerCase();
      let decoded;
      try {
        decoded = decodeFunctionData({ abi: VEIL_SERVICE_ESCROW_ABI, data: transaction.input });
      } catch {
        return NextResponse.json({ error: 'Settlement transaction is not a valid resolveDispute call.' }, { status: 400 });
      }
      if (decoded.functionName !== 'resolveDispute' ||
          String(decoded.args?.[0] || '').toLowerCase() !== expectedOrderIdHex ||
          Number(decoded.args?.[1]) !== bRefund) {
        return NextResponse.json({ error: 'Settlement transaction order or buyer refund split does not match this review.' }, { status: 400 });
      }

      const disputeResolvedTopic = toEventSelector('DisputeResolved(bytes32,uint256,uint256)').toLowerCase();
      const matchingEvent = receipt.logs.some((log) =>
        log.address.toLowerCase() === targetContractAddr.toLowerCase() &&
        log.topics[0]?.toLowerCase() === disputeResolvedTopic &&
        log.topics[1]?.toLowerCase() === expectedOrderIdHex
      );
      if (!matchingEvent) {
        return NextResponse.json({ error: `Settlement receipt has no matching DisputeResolved event for ${expectedOrderIdHex}.` }, { status: 400 });
      }
    }

    const updatedDispute = recordReviewerDecision({
      disputeId,
      reviewerAddress: config.reviewer,
      decision,
      buyerRefundPercent: bRefund,
      sellerGrossAwardPercent: sAward,
      reason: reason.trim().slice(0, 4000),
      settlementTxHash,
    });

    return NextResponse.json({
      success: true,
      dispute: updatedDispute,
      message: 'Reviewer decision recorded successfully.',
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    return NextResponse.json({ error: message }, { status: servicesErrorStatus(err) });
  }
}

export const GET = withJsonStores(handleGET);
export const POST = withJsonStores(handlePOST);
