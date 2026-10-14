import { NextRequest, NextResponse } from 'next/server';
import {
  getOrderById,
  transitionOrderStatus,
  sameWalletAddress,
  FUNDED_ACTIVE_ORDER_STATUSES,
  type OrderStatus,
} from '@/lib/server/servicesDb';
import { isAddress, parseEventLogs } from 'viem';
import { getAgentPublicClientForChain } from '@/lib/agent-sdk/server';
import {
  VEIL_SERVICE_ESCROW_ABI,
  getServiceEscrowAddress,
  normalizeChainId,
} from '@/lib/serviceContract';
import { formatServiceOrderId } from '@/lib/agent-sdk';
import { verifyServiceAuth } from '@/lib/server/serviceAuth';
import { verifySolanaEscrowTransaction } from '@/lib/server/solanaServiceVerification';
import {
  resolveOrderNetworkForRequest,
  servicesErrorStatus,
} from '@/lib/server/serviceOrderNetwork';

import { withJsonStores } from '@/lib/server/jsonStore';
async function handlePOST(
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
    const { callerAddress, reason, txHash, auth, network: reqNetwork } = body;

    const caller = callerAddress || auth?.address;
    if (!caller) {
      return NextResponse.json({ error: 'Valid callerAddress is required' }, { status: 400 });
    }

    const isSeller = sameWalletAddress(order.sellerId, caller);
    const isBuyer = sameWalletAddress(order.buyerId, caller);

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

    // Only unfunded (AwaitingPayment) or funded-and-undisputed orders can be cancelled.
    // Disputed orders must be settled by the reviewer: funds stay locked on-chain.
    const cancellableStatuses: OrderStatus[] = ['AwaitingPayment', ...FUNDED_ACTIVE_ORDER_STATUSES];
    if (!cancellableStatuses.includes(order.status)) {
      return NextResponse.json({ error: `Order cannot be cancelled in state: ${order.status}` }, { status: 409 });
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
      // Once work was submitted (InReview / RevisionRequested) the escrow is Delivered
      // on-chain and the buyer timeout refund no longer applies.
      if (order.status === 'InReview' || order.status === 'RevisionRequested') {
        return NextResponse.json(
          { error: 'Cannot trigger timeout refund after deliverables have been submitted for review. Please open a dispute instead.' },
          { status: 400 }
        );
      }
    }

    const isFundedOnChain = order.paymentStatus === 'Funded' && FUNDED_ACTIVE_ORDER_STATUSES.includes(order.status);

    // Settlement network comes from the stored order; a mismatching body value is rejected.
    const resolved = resolveOrderNetworkForRequest(order, reqNetwork);
    if (!resolved.ok) {
      return NextResponse.json({ error: resolved.error }, { status: resolved.status });
    }
    const isSolana = resolved.network === 'solana:devnet';

    // 2. On-Chain Receipt Validation for funded orders (AUDIT-003)
    if (isFundedOnChain) {
      if (isSolana) {
        if (!txHash || typeof txHash !== 'string') {
          return NextResponse.json(
            { error: 'Valid Solana refund transaction signature is required' },
            { status: 400 }
          );
        }

        // Fail-closed: the refund tx must be confirmed and the escrow account Refunded.
        const verification = await verifySolanaEscrowTransaction({
          signature: txHash,
          expectation: {
            orderId: order.escrowReference || order.id,
            buyer: order.buyerId,
            seller: order.sellerId,
            allowedStatuses: ['Refunded'],
            requiredSigner: isSeller ? order.sellerId : order.buyerId,
            instruction: 'cancel_or_refund',
          },
        });
        if (!verification.ok) {
          return NextResponse.json({ error: verification.error }, { status: verification.status });
        }
      } else {
        // EVM Flow
        const targetChainId = normalizeChainId(resolved.network);
        const client = getAgentPublicClientForChain(targetChainId);
        const targetContractAddr = getServiceEscrowAddress(targetChainId);

        if (!txHash || typeof txHash !== 'string' || !/^0x[a-fA-F0-9]{64}$/.test(txHash)) {
          return NextResponse.json(
            { error: 'Valid on-chain cancellation transaction hash is required for funded orders' },
            { status: 400 }
          );
        }

        if (!targetContractAddr || !isAddress(targetContractAddr)) {
          return NextResponse.json(
            { error: `Server configuration error: VeilServiceEscrow address is not configured for chain ID ${targetChainId}` },
            { status: 500 }
          );
        }

        let receipt;
        try {
          receipt = await client.getTransactionReceipt({ hash: txHash as `0x${string}` });
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
            { error: `Failed to parse contract event logs from receipt: ${parseErr.message}` },
            { status: 400 }
          );
        }

        if (!refundedLogs || refundedLogs.length === 0) {
          return NextResponse.json(
            { error: 'Transaction receipt does not contain a valid OrderRefunded contract event' },
            { status: 400 }
          );
        }

        // Verify orderId matches
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

        // Verify buyer receives refund
        const logBuyer = String((matchingLog as any).args?.buyer || '').toLowerCase();
        if (logBuyer !== order.buyerId.toLowerCase()) {
          return NextResponse.json(
            { error: 'OrderRefunded event buyer does not match order buyer' },
            { status: 400 }
          );
        }
      }
    }

    // 3. Atomically update order status (409 if it changed during verification)
    const nextStatus: OrderStatus = isFundedOnChain ? 'Refunded' : 'Cancelled';
    const cancellationMsg = isFundedOnChain
      ? `[ORDER CANCELLED & REFUNDED] Order was cancelled by ${isSeller ? 'provider' : 'buyer'}. ${order.priceSnapshot} ${order.currency} returned 100% fee-free to buyer.`
      : `[ORDER CANCELLED] Order was cancelled before payment by ${isSeller ? 'provider' : 'buyer'}. Reason: ${reason || 'No reason provided'}`;

    const updated = transitionOrderStatus({
      orderId: id,
      from: isFundedOnChain ? FUNDED_ACTIVE_ORDER_STATUSES : ['AwaitingPayment'],
      to: nextStatus,
      paymentStatus: isFundedOnChain ? 'Refunded' : undefined,
      txHash: isFundedOnChain ? txHash : undefined,
      message: {
        senderId: isSeller ? order.sellerId : order.buyerId,
        senderType: 'human',
        content: cancellationMsg,
      },
    });

    return NextResponse.json({ success: true, order: updated });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    return NextResponse.json({ error: message }, { status: servicesErrorStatus(err) });
  }
}

export const POST = withJsonStores(handlePOST);
