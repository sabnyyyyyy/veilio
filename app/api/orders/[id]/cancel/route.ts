import { NextRequest, NextResponse } from 'next/server';
import {
  getOrderById,
  updateOrderStatus,
  addServiceMessage,
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
    const { id } = await params;
    const order = getOrderById(id);
    if (!order) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 });
    }

    const body = await req.json();
    const { callerAddress, reason, txHash, auth } = body;

    const caller = callerAddress || auth?.address;
    if (!caller || !isAddress(caller)) {
      return NextResponse.json({ error: 'Valid callerAddress is required' }, { status: 400 });
    }

    const callerLower = caller.toLowerCase();
    const isSeller = order.sellerId.toLowerCase() === callerLower;
    const isBuyer = order.buyerId.toLowerCase() === callerLower;

    if (!isSeller && !isBuyer) {
      return NextResponse.json(
        { error: 'Unauthorized: only buyer or seller can cancel or request refund' },
        { status: 403 }
      );
    }

    // 1. Cryptographic wallet authentication (AUDIT-001)
    const authResult = await verifyServiceAuth({
      action: 'cancel',
      orderId: id,
      expectedAddress: isSeller ? order.sellerId : order.buyerId,
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

    // Prevent cancelling already completed, disputed, or refunded orders
    if (order.status === 'Completed' || order.status === 'Refunded' || order.status === 'Cancelled') {
      return NextResponse.json({ error: `Order cannot be cancelled in state: ${order.status}` }, { status: 400 });
    }

    // Buyer timeout check: Buyer can only cancel if deadline has passed and work not delivered
    if (isBuyer) {
      const now = Date.now();
      if (now <= order.deadline) {
        return NextResponse.json(
          { error: 'Buyer cannot cancel before deadline. If you have an issue, please open a dispute.' },
          { status: 400 }
        );
      }
      if (order.status === 'InReview') {
        return NextResponse.json(
          { error: 'Cannot trigger timeout refund after deliverables have been submitted for review. Please open a dispute instead.' },
          { status: 400 }
        );
      }
    }

    const isFundedOnChain = order.paymentStatus === 'Funded' || ['Funded', 'InProgress', 'InReview', 'RevisionRequested'].includes(order.status);

    // 2. On-Chain Receipt Validation for funded orders (AUDIT-003)
    if (isFundedOnChain) {
      if (!txHash || typeof txHash !== 'string' || !/^0x[a-fA-F0-9]{64}$/.test(txHash)) {
        return NextResponse.json(
          { error: 'Valid on-chain cancellation transaction hash is required for funded orders' },
          { status: 400 }
        );
      }

      const targetContractAddr = VEIL_SERVICE_ESCROW_CONTRACT_ADDRESS || process.env.NEXT_PUBLIC_SERVICE_ESCROW_CONTRACT_ADDRESS;
      if (!targetContractAddr || !isAddress(targetContractAddr)) {
        return NextResponse.json(
          { error: 'Server configuration error: VEIL_SERVICE_ESCROW_CONTRACT_ADDRESS is not configured' },
          { status: 500 }
        );
      }

      let receipt;
      try {
        receipt = await agentPublicClient.getTransactionReceipt({ hash: txHash as `0x${string}` });
      } catch (rpcErr: any) {
        return NextResponse.json(
          { error: `Cancellation transaction not confirmed on-chain: ${rpcErr?.shortMessage || rpcErr?.message || 'Transaction receipt not found'}` },
          { status: 400 }
        );
      }

      if (!receipt || receipt.status !== 'success') {
        return NextResponse.json(
          { error: 'On-chain cancellation transaction failed or was reverted' },
          { status: 400 }
        );
      }

      if (!receipt.to || receipt.to.toLowerCase() !== targetContractAddr.toLowerCase()) {
        return NextResponse.json(
          { error: `Transaction recipient (${receipt.to}) does not match VeilServiceEscrow contract (${targetContractAddr})` },
          { status: 400 }
        );
      }

      // Parse OrderRefunded event
      let refundedLogs;
      try {
        refundedLogs = parseEventLogs({
          abi: VEIL_SERVICE_ESCROW_ABI,
          logs: receipt.logs,
          eventName: 'OrderRefunded',
        });
      } catch (parseErr: any) {
        return NextResponse.json(
          { error: `Failed to parse contract event logs from cancellation receipt: ${parseErr.message}` },
          { status: 400 }
        );
      }

      if (!refundedLogs || refundedLogs.length === 0) {
        return NextResponse.json(
          { error: 'Transaction receipt does not contain a valid OrderRefunded contract event' },
          { status: 400 }
        );
      }

      const expectedOrderIdHex = formatServiceOrderId(order.escrowReference || order.id).toLowerCase();
      const matchingLog = refundedLogs.find((log: any) => {
        const logOrderId = String(log.args?.orderId || '').toLowerCase();
        return logOrderId === expectedOrderIdHex;
      });

      if (!matchingLog) {
        return NextResponse.json(
          { error: `OrderRefunded event orderId does not match order identifier (${expectedOrderIdHex})` },
          { status: 400 }
        );
      }

      const logBuyer = String((matchingLog as any).args?.buyer || '').toLowerCase();
      if (logBuyer !== order.buyerId.toLowerCase()) {
        return NextResponse.json(
          { error: 'OrderRefunded event buyer does not match order buyer' },
          { status: 400 }
        );
      }
    }

    const newStatus = isSeller ? 'Cancelled' : 'Refunded';
    const updated = updateOrderStatus(id, newStatus, 'Refunded', order.escrowReference, txHash || order.escrowTxHash);

    const partyName = isSeller ? 'Seller' : 'Buyer (Timeout Refund)';
    addServiceMessage({
      conversationId: order.conversationId,
      senderId: caller,
      senderType: 'human',
      content: `[ORDER ${newStatus.toUpperCase()}] ${partyName} triggered cancellation and escrow refund: "${reason || 'No reason specified'}". Escrow funds returned to buyer.`,
    });

    return NextResponse.json({
      success: true,
      order: updated,
      message: `Order successfully ${newStatus.toLowerCase()} and refunded to buyer.`,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
