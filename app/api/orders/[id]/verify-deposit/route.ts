import { NextRequest, NextResponse } from 'next/server';
import {
  getOrderById,
  updateOrderStatus,
  addServiceMessage,
  updatePaymentRequestStatus,
} from '@/lib/server/servicesDb';
import { isAddress, parseEventLogs, parseEther } from 'viem';
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

    // SEC-NEW-01: Enforce AwaitingPayment state precondition
    if (order.status !== 'AwaitingPayment') {
      return NextResponse.json(
        { error: `Cannot verify deposit: order is in state '${order.status}' (expected 'AwaitingPayment')` },
        { status: 400 }
      );
    }

    const body = await req.json();
    const { txHash, onChainOrderId, buyerAddress, auth } = body;

    const caller = buyerAddress || auth?.address;
    if (!caller || !isAddress(caller)) {
      return NextResponse.json({ error: 'Valid buyerAddress is required' }, { status: 400 });
    }

    // 1. Cryptographic wallet authentication (AUDIT-001)
    const authResult = await verifyServiceAuth({
      action: 'verify-deposit',
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

    // 2. Format check on transaction hash
    if (!txHash || typeof txHash !== 'string' || !/^0x[a-fA-F0-9]{64}$/.test(txHash)) {
      return NextResponse.json(
        { error: 'Valid transaction hash is required (0x followed by 64 hex characters)' },
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

    // 3. Fail-Closed On-Chain Receipt Validation (AUDIT-002)
    let receipt;
    try {
      receipt = await agentPublicClient.getTransactionReceipt({ hash: txHash as `0x${string}` });
    } catch (rpcErr: any) {
      return NextResponse.json(
        { error: `Deposit transaction not confirmed on-chain: ${rpcErr?.shortMessage || rpcErr?.message || 'Transaction receipt not found'}` },
        { status: 400 }
      );
    }

    if (!receipt || receipt.status !== 'success') {
      return NextResponse.json(
        { error: 'Deposit transaction failed, reverted, or unconfirmed on-chain' },
        { status: 400 }
      );
    }

    // 4. Destination contract address check
    if (!receipt.to || receipt.to.toLowerCase() !== targetContractAddr.toLowerCase()) {
      return NextResponse.json(
        { error: `Transaction recipient (${receipt.to}) does not match VeilServiceEscrow contract (${targetContractAddr})` },
        { status: 400 }
      );
    }

    // 5. Parse and validate OrderFunded event from transaction logs
    let fundedLogs;
    try {
      fundedLogs = parseEventLogs({
        abi: VEIL_SERVICE_ESCROW_ABI,
        logs: receipt.logs,
        eventName: 'OrderFunded',
      });
    } catch (parseErr: any) {
      return NextResponse.json(
        { error: `Failed to parse contract event logs from receipt: ${parseErr.message}` },
        { status: 400 }
      );
    }

    if (!fundedLogs || fundedLogs.length === 0) {
      return NextResponse.json(
        { error: 'Transaction receipt does not contain a valid OrderFunded contract event' },
        { status: 400 }
      );
    }

    // Match expected order identifier
    const expectedOrderIdHex = formatServiceOrderId(onChainOrderId || order.escrowReference || order.id).toLowerCase();
    const matchingLog = fundedLogs.find((log: any) => {
      const logOrderId = String(log.args?.orderId || '').toLowerCase();
      return logOrderId === expectedOrderIdHex;
    });

    if (!matchingLog) {
      return NextResponse.json(
        { error: `OrderFunded event orderId does not match order identifier (${expectedOrderIdHex})` },
        { status: 400 }
      );
    }

    // Validate event parties & funded deposit amount
    const logBuyer = String((matchingLog as any).args?.buyer || '').toLowerCase();
    const logSeller = String((matchingLog as any).args?.seller || '').toLowerCase();
    const logAmount = BigInt((matchingLog as any).args?.amount || 0n);
    const expectedMinAmount = parseEther(order.priceSnapshot);

    if (logBuyer !== order.buyerId.toLowerCase()) {
      return NextResponse.json(
        { error: `OrderFunded event buyer (${logBuyer}) does not match order buyer (${order.buyerId.toLowerCase()})` },
        { status: 400 }
      );
    }

    if (logSeller !== order.sellerId.toLowerCase()) {
      return NextResponse.json(
        { error: `OrderFunded event seller (${logSeller}) does not match order seller (${order.sellerId.toLowerCase()})` },
        { status: 400 }
      );
    }

    if (logAmount < expectedMinAmount) {
      return NextResponse.json(
        { error: `OrderFunded amount (${logAmount.toString()} wei) is less than required price (${expectedMinAmount.toString()} wei)` },
        { status: 400 }
      );
    }

    // Re-check order status immediately prior to persistence to guard against concurrent modifications (SEC-NEW-01)
    const freshOrder = getOrderById(id);
    if (!freshOrder || freshOrder.status !== 'AwaitingPayment') {
      return NextResponse.json(
        { error: `State conflict: order status changed to '${freshOrder?.status || 'Unknown'}' during verification` },
        { status: 409 }
      );
    }

    // 6. Update order status to Funded & InProgress in database
    const escrowRef = onChainOrderId || (matchingLog as any).args?.orderId || txHash;
    const updated = updateOrderStatus(id, 'InProgress', 'Funded', escrowRef, txHash);

    // Sync associated payment request status if present
    if (order.paymentRequestId) {
      updatePaymentRequestStatus(order.paymentRequestId, 'funded');
    }

    // Notify conversation
    addServiceMessage({
      conversationId: order.conversationId,
      senderId: caller,
      senderType: 'human',
      content: `[ESCROW FUNDED] Buyer deposited ${order.priceSnapshot} ${order.currency} into on-chain escrow. Tx: ${txHash.slice(0, 10)}...${txHash.slice(-8)}. Seller may begin work!`,
    });

    return NextResponse.json({ success: true, order: updated });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
