import { NextRequest, NextResponse } from 'next/server';
import {
  getOrderById,
  applyOrderPriceReduction,
  sameWalletAddress,
  FUNDED_ACTIVE_ORDER_STATUSES,
} from '@/lib/server/servicesDb';
import { formatEther, isAddress, parseEventLogs } from 'viem';
import { getAgentPublicClientForChain } from '@/lib/agent-sdk/server';
import {
  VEIL_SERVICE_ESCROW_ABI,
  getServiceEscrowAddress,
  normalizeChainId,
} from '@/lib/serviceContract';
import { formatServiceOrderId } from '@/lib/agent-sdk';
import { verifyServiceAuth } from '@/lib/server/serviceAuth';
import { verifySolanaEscrowTransaction } from '@/lib/server/solanaServiceVerification';
import { formatLamportsToSol, parseSolToLamports } from '@/lib/cross-chain/solanaServiceEscrow';
import {
  resolveOrderNetworkForRequest,
  servicesErrorStatus,
} from '@/lib/server/serviceOrderNetwork';

import { withJsonStores } from '@/lib/server/jsonStore';
/**
 * Records a seller's on-chain `partialRefund` (renegotiated lower price) for a funded order.
 *
 * Requires: signed seller auth ('partial-refund'), and the escrow tx hash. The server checks
 * the receipt's OrderPartiallyRefunded event (order id, buyer) and then reads the order's
 * current escrowed amount on-chain, which becomes the new `priceSnapshot`.
 * Solana: the tx must invoke `partial_refund` signed by the seller; the escrow account's amount is used.
 */
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
    if (!caller || !sameWalletAddress(order.sellerId, caller)) {
      return NextResponse.json({ error: 'Unauthorized: only the seller can reduce the order price' }, { status: 403 });
    }

    const authResult = await verifyServiceAuth({
      action: 'partial-refund',
      orderId: id,
      expectedAddress: order.sellerId,
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

    if (order.paymentStatus !== 'Funded' || !FUNDED_ACTIVE_ORDER_STATUSES.includes(order.status)) {
      return NextResponse.json({ error: `Price can only be reduced on a funded, active order (current: ${order.status})` }, { status: 409 });
    }

    const resolved = resolveOrderNetworkForRequest(order, reqNetwork);
    if (!resolved.ok) {
      return NextResponse.json({ error: resolved.error }, { status: resolved.status });
    }
    const cleanReason = typeof reason === 'string' && reason.trim() ? reason.trim().slice(0, 200) : undefined;
    const record = (refundAmount: string, newPrice: string) => {
      const previousPrice = order.priceSnapshot;
      return applyOrderPriceReduction({
        orderId: id,
        refundAmount,
        newPrice,
        txHash,
        reason: cleanReason,
        message: {
          senderId: order.sellerId,
          senderType: 'human',
          content: `[PRICE REDUCED] Provider refunded ${refundAmount} ${order.currency} to the buyer on-chain. Escrowed price is now ${newPrice} ${order.currency} (was ${previousPrice}).${cleanReason ? ` Reason: ${cleanReason}` : ''} Tx: ${txHash.slice(0, 10)}...${txHash.slice(-8)}`,
        },
      });
    };

    if (resolved.network === 'solana:devnet') {
      if (!txHash || typeof txHash !== 'string') {
        return NextResponse.json({ error: 'Valid Solana partial refund transaction signature is required' }, { status: 400 });
      }
      const verification = await verifySolanaEscrowTransaction({
        signature: txHash,
        expectation: {
          orderId: order.escrowReference || order.id,
          buyer: order.buyerId,
          seller: order.sellerId,
          allowedStatuses: ['Funded', 'Delivered'],
          requiredSigner: order.sellerId,
          instruction: 'partial_refund',
        },
      });
      if (!verification.ok) {
        return NextResponse.json({ error: verification.error }, { status: verification.status });
      }
      const newPrice = formatLamportsToSol(verification.escrow.amountLamports);
      const refundAmount = formatLamportsToSol(parseSolToLamports(order.priceSnapshot) - verification.escrow.amountLamports);
      const updated = record(refundAmount, newPrice);
      return NextResponse.json({ success: true, order: updated, refundAmount, newPrice });
    }

    if (!txHash || typeof txHash !== 'string' || !/^0x[a-fA-F0-9]{64}$/.test(txHash)) {
      return NextResponse.json({ error: 'Valid partial refund transaction hash is required' }, { status: 400 });
    }

    const chainId = normalizeChainId(resolved.network);
    const client = getAgentPublicClientForChain(chainId);
    const escrowAddress = getServiceEscrowAddress(chainId);
    if (!escrowAddress || !isAddress(escrowAddress)) {
      return NextResponse.json(
        { error: `Server configuration error: VeilServiceEscrow address is not configured for chain ID ${chainId}` },
        { status: 500 }
      );
    }

    let receipt;
    try {
      receipt = await client.getTransactionReceipt({ hash: txHash as `0x${string}` });
    } catch (rpcErr: any) {
      return NextResponse.json(
        { error: `Partial refund transaction not confirmed on-chain: ${rpcErr?.shortMessage || rpcErr?.message || 'Transaction receipt not found'}` },
        { status: 400 }
      );
    }
    if (!receipt || receipt.status !== 'success') {
      return NextResponse.json({ error: 'On-chain partial refund transaction failed or was reverted' }, { status: 400 });
    }
    if (!receipt.to || receipt.to.toLowerCase() !== escrowAddress.toLowerCase()) {
      return NextResponse.json(
        { error: `Transaction recipient (${receipt.to}) does not match VeilServiceEscrow contract (${escrowAddress})` },
        { status: 400 }
      );
    }

    const escrowOrderId = formatServiceOrderId(order.escrowReference || order.id);
    const events = parseEventLogs({ abi: VEIL_SERVICE_ESCROW_ABI, logs: receipt.logs, eventName: 'OrderPartiallyRefunded' });
    const event = events.find((log: any) => String(log.args?.orderId || '').toLowerCase() === escrowOrderId.toLowerCase()) as any;
    if (!event) {
      return NextResponse.json({ error: 'Transaction does not contain an OrderPartiallyRefunded event for this order' }, { status: 400 });
    }
    if (String(event.args.buyer).toLowerCase() !== order.buyerId.toLowerCase()) {
      return NextResponse.json({ error: 'OrderPartiallyRefunded event buyer does not match order buyer' }, { status: 400 });
    }

    // Current on-chain amount is authoritative, even if several reductions are recorded out of order.
    const onChain = await client.readContract({
      address: escrowAddress,
      abi: VEIL_SERVICE_ESCROW_ABI,
      functionName: 'getOrder',
      args: [escrowOrderId],
    }) as { amount: bigint };

    const refundAmount = formatEther(event.args.refundAmount as bigint);
    const newPrice = formatEther(onChain.amount);
    const updated = record(refundAmount, newPrice);

    return NextResponse.json({ success: true, order: updated, refundAmount, newPrice });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    return NextResponse.json({ error: message }, { status: servicesErrorStatus(err) });
  }
}

export const POST = withJsonStores(handlePOST);
