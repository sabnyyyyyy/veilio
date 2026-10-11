import { NextRequest, NextResponse } from 'next/server';
import {
  getOrderById,
  createServiceDispute,
  getDisputeByOrderId,
} from '@/lib/server/servicesDb';
import { isAddress, parseEventLogs } from 'viem';
import { agentPublicClient } from '@/lib/agent-sdk/server';
import { VEIL_SERVICE_ESCROW_ABI, VEIL_SERVICE_ESCROW_CONTRACT_ADDRESS } from '@/lib/serviceContract';
import { formatServiceOrderId } from '@/lib/agent-sdk';
import { verifyServiceAuth } from '@/lib/server/serviceAuth';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: orderId } = await params;
    const dispute = getDisputeByOrderId(orderId);
    if (!dispute) {
      return NextResponse.json({ success: true, dispute: null });
    }
    return NextResponse.json({ success: true, dispute });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: orderId } = await params;
    const order = getOrderById(orderId);
    if (!order) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 });
    }

    const body = await req.json();
    const {
      initiatorAddress,
      reason,
      evidenceTitle,
      evidenceDescription,
      evidenceReferences,
      txHash,
      auth,
    } = body;

    const caller = initiatorAddress || auth?.address;
    if (!caller || !isAddress(caller) || !reason) {
      return NextResponse.json(
        { error: 'Missing required fields: initiatorAddress and reason are required' },
        { status: 400 }
      );
    }

    // Role check: Only buyer or seller can dispute
    const callerLower = caller.toLowerCase();
    const isBuyer = order.buyerId.toLowerCase() === callerLower;
    const isSeller = order.sellerId.toLowerCase() === callerLower;
    if (!isBuyer && !isSeller) {
      return NextResponse.json(
        { error: 'Unauthorized: only buyer or seller can dispute this order' },
        { status: 403 }
      );
    }

    // Cryptographic wallet authentication (AUDIT-001)
    const authResult = await verifyServiceAuth({
      action: 'dispute',
      orderId,
      expectedAddress: isBuyer ? order.buyerId : order.sellerId,
      auth: auth || {
        address: caller,
        signature: body.signature,
        timestamp: body.timestamp,
        nonce: body.nonce,
      },
    });

    if (!authResult.valid) {
      return NextResponse.json(
        { error: authResult.error || 'Authentication failed' },
        { status: authResult.status || 401 }
      );
    }

    // Fail-Closed Validation for On-Chain Dispute Tx (if provided)
    if (txHash) {
      if (typeof txHash !== 'string' || !/^0x[a-fA-F0-9]{64}$/.test(txHash)) {
        return NextResponse.json(
          { error: 'Invalid transaction hash format for on-chain dispute' },
          { status: 400 }
        );
      }

      const targetContractAddr = VEIL_SERVICE_ESCROW_CONTRACT_ADDRESS || process.env.NEXT_PUBLIC_SERVICE_ESCROW_CONTRACT_ADDRESS;
      let receipt;
      try {
        receipt = await agentPublicClient.getTransactionReceipt({ hash: txHash as `0x${string}` });
      } catch (rpcErr: any) {
        return NextResponse.json(
          { error: `Dispute transaction not confirmed on-chain: ${rpcErr?.shortMessage || rpcErr?.message || 'Transaction receipt not found'}` },
          { status: 400 }
        );
      }

      if (!receipt || receipt.status !== 'success') {
        return NextResponse.json(
          { error: 'On-chain dispute transaction failed or reverted' },
          { status: 400 }
        );
      }

      if (targetContractAddr && receipt.to && receipt.to.toLowerCase() !== targetContractAddr.toLowerCase()) {
        return NextResponse.json(
          { error: `Transaction recipient does not match VeilServiceEscrow contract` },
          { status: 400 }
        );
      }

      // Validate OrderDisputed event
      try {
        const disputedLogs = parseEventLogs({
          abi: VEIL_SERVICE_ESCROW_ABI,
          logs: receipt.logs,
          eventName: 'OrderDisputed',
        });

        if (disputedLogs && disputedLogs.length > 0) {
          const expectedOrderIdHex = formatServiceOrderId(order.escrowReference || order.id).toLowerCase();
          const matchingLog = disputedLogs.find((log: any) => {
            const logOrderId = String(log.args?.orderId || '').toLowerCase();
            return logOrderId === expectedOrderIdHex;
          });
          if (!matchingLog) {
            return NextResponse.json(
              { error: `OrderDisputed event does not match order identifier (${expectedOrderIdHex})` },
              { status: 400 }
            );
          }
        }
      } catch (parseErr: any) {
        return NextResponse.json(
          { error: `Failed to parse OrderDisputed event logs: ${parseErr.message}` },
          { status: 400 }
        );
      }
    }

    // Create dispute
    const dispute = createServiceDispute({
      orderId,
      initiatorAddress: caller,
      reason: reason.trim(),
      evidenceTitle,
      evidenceDescription,
      evidenceReferences,
      disputeTxHash: txHash,
    });

    return NextResponse.json({
      success: true,
      dispute,
      message: 'Dispute opened successfully. Evidence gathering is now active.',
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
