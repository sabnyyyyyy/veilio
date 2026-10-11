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
    const { buyerAddress, releaseTxHash, auth } = body;

    const caller = buyerAddress || auth?.address;
    if (!caller || !isAddress(caller)) {
      return NextResponse.json({ error: 'Valid buyerAddress is required' }, { status: 400 });
    }

    // 1. Cryptographic wallet authentication (AUDIT-001)
    const authResult = await verifyServiceAuth({
      action: 'approve',
      orderId: id,
      expectedAddress: order.buyerId,
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

    if (order.status === 'Completed') {
      return NextResponse.json({ error: 'Order is already completed' }, { status: 400 });
    }

    // 2. Validate release transaction hash
    if (!releaseTxHash || typeof releaseTxHash !== 'string' || !/^0x[a-fA-F0-9]{64}$/.test(releaseTxHash)) {
      return NextResponse.json(
        { error: 'Valid release transaction hash is required (0x followed by 64 hex characters)' },
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

    // 3. Fail-Closed On-Chain Receipt Validation (AUDIT-003)
    let receipt;
    try {
      receipt = await agentPublicClient.getTransactionReceipt({ hash: releaseTxHash as `0x${string}` });
    } catch (rpcErr: any) {
      return NextResponse.json(
        { error: `Release transaction not confirmed on-chain: ${rpcErr?.shortMessage || rpcErr?.message || 'Transaction receipt not found'}` },
        { status: 400 }
      );
    }

    if (!receipt || receipt.status !== 'success') {
      return NextResponse.json(
        { error: 'Release transaction failed, reverted, or unconfirmed on-chain' },
        { status: 400 }
      );
    }

    // Destination contract address check
    if (!receipt.to || receipt.to.toLowerCase() !== targetContractAddr.toLowerCase()) {
      return NextResponse.json(
        { error: `Release transaction recipient (${receipt.to}) does not match VeilServiceEscrow contract (${targetContractAddr})` },
        { status: 400 }
      );
    }

    // 4. Parse and validate OrderReleased event from transaction logs
    let releasedLogs;
    try {
      releasedLogs = parseEventLogs({
        abi: VEIL_SERVICE_ESCROW_ABI,
        logs: receipt.logs,
        eventName: 'OrderReleased',
      });
    } catch (parseErr: any) {
      return NextResponse.json(
        { error: `Failed to parse contract event logs from receipt: ${parseErr.message}` },
        { status: 400 }
      );
    }

    if (!releasedLogs || releasedLogs.length === 0) {
      return NextResponse.json(
        { error: 'Transaction receipt does not contain a valid OrderReleased contract event' },
        { status: 400 }
      );
    }

    // Match expected order identifier
    const expectedOrderIdHex = formatServiceOrderId(order.escrowReference || order.id).toLowerCase();
    const matchingLog = releasedLogs.find((log: any) => {
      const logOrderId = String(log.args?.orderId || '').toLowerCase();
      return logOrderId === expectedOrderIdHex;
    });

    if (!matchingLog) {
      return NextResponse.json(
        { error: `OrderReleased event orderId does not match order identifier (${expectedOrderIdHex})` },
        { status: 400 }
      );
    }

    // Validate event parties
    const logBuyer = String((matchingLog as any).args?.buyer || '').toLowerCase();
    const logSeller = String((matchingLog as any).args?.seller || '').toLowerCase();
    if (logBuyer !== order.buyerId.toLowerCase() || logSeller !== order.sellerId.toLowerCase()) {
      return NextResponse.json(
        { error: 'OrderReleased event parties do not match order buyer and seller' },
        { status: 400 }
      );
    }

    // 5. Update to Completed and Released in database
    const updated = updateOrderStatus(id, 'Completed', 'Released', order.escrowReference, releaseTxHash);

    // Notify conversation
    addServiceMessage({
      conversationId: order.conversationId,
      senderId: caller,
      senderType: 'human',
      content: `[ORDER COMPLETED & RELEASED] Buyer approved submitted work for Order #${id}. On-chain escrow settlement confirmed. Thank you for transacting on VEILIO Services!`,
    });

    return NextResponse.json({ success: true, order: updated });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
