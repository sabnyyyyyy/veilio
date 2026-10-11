import { NextRequest, NextResponse } from 'next/server';
import {
  getDisputeById,
  getOrderById,
  recordReviewerDecision,
} from '@/lib/server/servicesDb';
import { isAddress, parseEventLogs } from 'viem';
import { agentPublicClient } from '@/lib/agent-sdk/server';
import { VEIL_SERVICE_ESCROW_ABI, VEIL_SERVICE_ESCROW_CONTRACT_ADDRESS } from '@/lib/serviceContract';
import { formatServiceOrderId } from '@/lib/agent-sdk';
import { verifyServiceAuth } from '@/lib/server/serviceAuth';

export async function POST(
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
    } = body;

    const caller = reviewerAddress || auth?.address;
    if (!caller || !isAddress(caller) || !decision || !reason) {
      return NextResponse.json(
        { error: 'Missing required fields: reviewerAddress, decision, and reason are required' },
        { status: 400 }
      );
    }

    const revLower = caller.toLowerCase();
    // Rule: Neither buyer nor seller may approve their own dispute outcome
    if (revLower === order.buyerId.toLowerCase() || revLower === order.sellerId.toLowerCase()) {
      return NextResponse.json(
        { error: 'Unauthorized: neither buyer nor seller may approve their own dispute outcome' },
        { status: 403 }
      );
    }

    // 1. Strictly Enforce Configured Reviewer Address (AUDIT-004)
    const configuredReviewer = process.env.REVIEWER_ADDRESS?.toLowerCase();
    if (configuredReviewer && revLower !== configuredReviewer) {
      return NextResponse.json(
        { error: `Forbidden: caller ${caller} is not authorized as the platform reviewer (${process.env.REVIEWER_ADDRESS})` },
        { status: 403 }
      );
    }

    // 2. Cryptographic wallet authentication (AUDIT-001)
    const authResult = await verifyServiceAuth({
      action: 'review-dispute',
      orderId: disputeId,
      expectedAddress: configuredReviewer || revLower,
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

    if (bRefund + sAward !== 100) {
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

    // 3. Verify On-Chain Dispute Settlement Receipt if txHash is provided (AUDIT-003)
    if (settlementTxHash) {
      if (typeof settlementTxHash !== 'string' || !/^0x[a-fA-F0-9]{64}$/.test(settlementTxHash)) {
        return NextResponse.json(
          { error: 'Invalid settlementTxHash format' },
          { status: 400 }
        );
      }

      const targetContractAddr = VEIL_SERVICE_ESCROW_CONTRACT_ADDRESS || process.env.NEXT_PUBLIC_SERVICE_ESCROW_CONTRACT_ADDRESS;
      if (targetContractAddr && isAddress(targetContractAddr)) {
        let receipt;
        try {
          receipt = await agentPublicClient.getTransactionReceipt({ hash: settlementTxHash as `0x${string}` });
        } catch (rpcErr: any) {
          return NextResponse.json(
            { error: `Settlement transaction not confirmed on-chain: ${rpcErr?.shortMessage || rpcErr?.message || 'Transaction receipt not found'}` },
            { status: 400 }
          );
        }

        if (!receipt || receipt.status !== 'success') {
          return NextResponse.json(
            { error: 'On-chain dispute settlement transaction failed or was reverted' },
            { status: 400 }
          );
        }

        if (!receipt.to || receipt.to.toLowerCase() !== targetContractAddr.toLowerCase()) {
          return NextResponse.json(
            { error: `Transaction recipient does not match VeilServiceEscrow contract` },
            { status: 400 }
          );
        }

        // Validate DisputeResolved event
        let disputeLogs;
        try {
          disputeLogs = parseEventLogs({
            abi: VEIL_SERVICE_ESCROW_ABI,
            logs: receipt.logs,
            eventName: 'DisputeResolved',
          });
        } catch (err: any) {
          return NextResponse.json(
            { error: `Failed to parse DisputeResolved event: ${err.message}` },
            { status: 400 }
          );
        }

        if (!disputeLogs || disputeLogs.length === 0) {
          return NextResponse.json(
            { error: 'Transaction receipt does not contain a DisputeResolved event' },
            { status: 400 }
          );
        }

        const expectedOrderIdHex = formatServiceOrderId(order.escrowReference || order.id).toLowerCase();
        const matchingLog = disputeLogs.find((log: any) => {
          return String(log.args?.orderId || '').toLowerCase() === expectedOrderIdHex;
        });

        if (!matchingLog) {
          return NextResponse.json(
            { error: `DisputeResolved event does not match order identifier (${expectedOrderIdHex})` },
            { status: 400 }
          );
        }
      }
    }

    const updatedDispute = recordReviewerDecision({
      disputeId,
      reviewerAddress: caller,
      decision,
      buyerRefundPercent: bRefund,
      sellerGrossAwardPercent: sAward,
      reason: reason.trim(),
      settlementTxHash,
    });

    return NextResponse.json({
      success: true,
      dispute: updatedDispute,
      message: 'Reviewer decision recorded successfully.',
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
