import { NextRequest, NextResponse } from 'next/server';
import {
  getOrderById,
  addOrderSubmission,
  sameWalletAddress,
} from '@/lib/server/servicesDb';
import { isAddress, parseEventLogs } from 'viem';
import { verifyServiceAuth, isSolanaAddress } from '@/lib/server/serviceAuth';
import { getAgentPublicClientForChain } from '@/lib/agent-sdk/server';
import { VEIL_SERVICE_ESCROW_ABI, getServiceEscrowAddress } from '@/lib/serviceContract';
import { formatServiceOrderId } from '@/lib/agent-sdk';
import { verifySolanaEscrowTransaction } from '@/lib/server/solanaServiceVerification';
import {
  resolveOrderNetworkForRequest,
  servicesErrorStatus,
} from '@/lib/server/serviceOrderNetwork';

import { withJsonStores } from '@/lib/server/jsonStore';
/**
 * Seller submits deliverables. Requires the on-chain submitDelivery / submit_delivery
 * transaction (`deliveryTxHash`) so the DB never shows "InReview" while the escrow is
 * still "Funded" on-chain (which would let the buyer claim a timeout refund).
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
    const { sellerAddress, description, deliverableReferences = [], auth, deliveryTxHash, network: reqNetwork } = body;

    const caller = sellerAddress || auth?.address;
    if (!caller || typeof caller !== 'string' || (!isAddress(caller) && !isSolanaAddress(caller))) {
      return NextResponse.json({ error: 'Valid sellerAddress (EVM or Solana) is required' }, { status: 400 });
    }
    if (!sameWalletAddress(caller, order.sellerId)) {
      return NextResponse.json({ error: 'Unauthorized: only seller can submit deliverables' }, { status: 403 });
    }

    // Cryptographic wallet authentication (AUDIT-001) - EIP-191 or Ed25519
    const authResult = await verifyServiceAuth({
      action: 'submit',
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

    if (!description || typeof description !== 'string' || description.trim().length < 5) {
      return NextResponse.json({ error: 'Submission description is required (minimum 5 characters)' }, { status: 400 });
    }

    const resolved = resolveOrderNetworkForRequest(order, reqNetwork);
    if (!resolved.ok) {
      return NextResponse.json({ error: resolved.error }, { status: resolved.status });
    }

    if (!deliveryTxHash || typeof deliveryTxHash !== 'string') {
      return NextResponse.json(
        { error: 'deliveryTxHash (on-chain submitDelivery transaction) is required' },
        { status: 400 }
      );
    }

    if (resolved.network === 'solana:devnet') {
      const verification = await verifySolanaEscrowTransaction({
        signature: deliveryTxHash,
        expectation: {
          orderId: order.escrowReference || order.id,
          buyer: order.buyerId,
          seller: order.sellerId,
          allowedStatuses: ['Delivered'],
          requiredSigner: order.sellerId,
          instruction: 'submit_delivery',
        },
      });
      if (!verification.ok) {
        return NextResponse.json({ error: verification.error }, { status: verification.status });
      }
    } else {
      if (!/^0x[a-fA-F0-9]{64}$/.test(deliveryTxHash)) {
        return NextResponse.json({ error: 'deliveryTxHash must be 0x followed by 64 hex characters' }, { status: 400 });
      }
      const chainId = resolved.chainId as number;
      const escrowAddress = getServiceEscrowAddress(chainId);
      if (!escrowAddress || !isAddress(escrowAddress)) {
        return NextResponse.json(
          { error: `Server configuration error: VeilServiceEscrow address is not configured for chain ID ${chainId}` },
          { status: 500 }
        );
      }

      let receipt;
      try {
        receipt = await getAgentPublicClientForChain(chainId).getTransactionReceipt({ hash: deliveryTxHash as `0x${string}` });
      } catch (rpcErr: any) {
        return NextResponse.json(
          { error: `Delivery transaction not confirmed on-chain: ${rpcErr?.shortMessage || rpcErr?.message || 'receipt not found'}` },
          { status: 400 }
        );
      }
      if (!receipt || receipt.status !== 'success' || !receipt.to || receipt.to.toLowerCase() !== escrowAddress.toLowerCase()) {
        return NextResponse.json(
          { error: 'Delivery transaction must succeed and target the VeilServiceEscrow contract' },
          { status: 400 }
        );
      }

      const expectedOrderIdHex = formatServiceOrderId(order.escrowReference || order.id).toLowerCase();
      let logs;
      try {
        logs = parseEventLogs({ abi: VEIL_SERVICE_ESCROW_ABI, logs: receipt.logs, eventName: 'DeliverySubmitted' });
      } catch (parseErr: any) {
        return NextResponse.json({ error: `Failed to parse DeliverySubmitted event: ${parseErr.message}` }, { status: 400 });
      }
      const match = (logs || []).find((log: any) =>
        String(log.args?.orderId || '').toLowerCase() === expectedOrderIdHex &&
        String(log.args?.seller || '').toLowerCase() === order.sellerId.toLowerCase()
      );
      if (!match) {
        return NextResponse.json(
          { error: `Receipt has no DeliverySubmitted event for order ${expectedOrderIdHex} by the seller` },
          { status: 400 }
        );
      }
    }

    const refs = Array.isArray(deliverableReferences)
      ? deliverableReferences.filter((r: unknown): r is string => typeof r === 'string').map((r: string) => r.slice(0, 500))
      : [];

    const submission = addOrderSubmission(
      id,
      order.sellerId,
      description.trim(),
      refs
    );

    return NextResponse.json({ success: true, submission });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    return NextResponse.json({ error: message }, { status: servicesErrorStatus(err) });
  }
}

export const POST = withJsonStores(handlePOST);
