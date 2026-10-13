import { NextRequest, NextResponse } from 'next/server';
import {
  getOrderById,
  createServiceDispute,
  sameWalletAddress,
  FUNDED_ACTIVE_ORDER_STATUSES,
} from '@/lib/server/servicesDb';
import { isAddress, parseEventLogs } from 'viem';
import { getAgentPublicClientForChain } from '@/lib/agent-sdk/server';
import { VEIL_SERVICE_ESCROW_ABI, getServiceEscrowAddress } from '@/lib/serviceContract';
import { formatServiceOrderId } from '@/lib/agent-sdk';
import { verifyServiceAuth, isSolanaAddress } from '@/lib/server/serviceAuth';
import { verifySolanaEscrowTransaction } from '@/lib/server/solanaServiceVerification';
import {
  networkDisplayName,
  resolveOrderNetworkForRequest,
  servicesErrorStatus,
} from '@/lib/server/serviceOrderNetwork';

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
      network: reqNetwork,
    } = body;

    const caller = initiatorAddress || auth?.address;
    if (!caller || typeof caller !== 'string' || (!isAddress(caller) && !isSolanaAddress(caller)) || !reason || typeof reason !== 'string') {
      return NextResponse.json(
        { error: 'Missing required fields: initiatorAddress and reason are required' },
        { status: 400 }
      );
    }

    // Role check: Only buyer or seller can dispute
    const isBuyer = sameWalletAddress(order.buyerId, caller);
    const isSeller = sameWalletAddress(order.sellerId, caller);
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

    // Escrow funds are locked on-chain for every disputable order, so the on-chain
    // dispute transaction is mandatory: otherwise the reviewer's resolveDispute would revert
    // (escrow not in Disputed state) and the order would be stuck off-chain.
    if (!FUNDED_ACTIVE_ORDER_STATUSES.includes(order.status) || order.paymentStatus !== 'Funded') {
      return NextResponse.json(
        { error: `Order cannot be disputed in its current status: ${order.status}` },
        { status: 409 }
      );
    }

    const resolved = resolveOrderNetworkForRequest(order, reqNetwork);
    if (!resolved.ok) {
      return NextResponse.json({ error: resolved.error }, { status: resolved.status });
    }

    if (!txHash || typeof txHash !== 'string') {
      return NextResponse.json(
        { error: `On-chain dispute transaction (txHash) on ${networkDisplayName(resolved.network)} is required` },
        { status: 400 }
      );
    }

    const initiator = isBuyer ? order.buyerId : order.sellerId;

    if (resolved.network === 'solana:devnet') {
      const verification = await verifySolanaEscrowTransaction({
        signature: txHash,
        expectation: {
          orderId: order.escrowReference || order.id,
          buyer: order.buyerId,
          seller: order.sellerId,
          allowedStatuses: ['Disputed'],
          requiredSigner: initiator,
          instruction: 'dispute',
        },
      });
      if (!verification.ok) {
        return NextResponse.json({ error: verification.error }, { status: verification.status });
      }
    } else {
      if (!/^0x[a-fA-F0-9]{64}$/.test(txHash)) {
        return NextResponse.json(
          { error: 'Invalid transaction hash format for on-chain dispute' },
          { status: 400 }
        );
      }

      const chainId = resolved.chainId as number;
      const targetContractAddr = getServiceEscrowAddress(chainId);
      if (!targetContractAddr || !isAddress(targetContractAddr)) {
        return NextResponse.json(
          { error: `Server configuration error: VeilServiceEscrow address is not configured for chain ID ${chainId}` },
          { status: 500 }
        );
      }

      let receipt;
      try {
        receipt = await getAgentPublicClientForChain(chainId).getTransactionReceipt({ hash: txHash as `0x${string}` });
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

      if (!receipt.to || receipt.to.toLowerCase() !== targetContractAddr.toLowerCase()) {
        return NextResponse.json(
          { error: `Transaction recipient does not match VeilServiceEscrow contract (${targetContractAddr})` },
          { status: 400 }
        );
      }

      // Validate OrderDisputed event (required, must match order and initiator)
      let disputedLogs;
      try {
        disputedLogs = parseEventLogs({
          abi: VEIL_SERVICE_ESCROW_ABI,
          logs: receipt.logs,
          eventName: 'OrderDisputed',
        });
      } catch (parseErr: any) {
        return NextResponse.json(
          { error: `Failed to parse OrderDisputed event logs: ${parseErr.message}` },
          { status: 400 }
        );
      }
      const expectedOrderIdHex = formatServiceOrderId(order.escrowReference || order.id).toLowerCase();
      const matchingLog = (disputedLogs || []).find((log: any) =>
        String(log.args?.orderId || '').toLowerCase() === expectedOrderIdHex &&
        String(log.args?.openedBy || '').toLowerCase() === initiator.toLowerCase()
      );
      if (!matchingLog) {
        return NextResponse.json(
          { error: `Receipt has no OrderDisputed event for order ${expectedOrderIdHex} opened by ${initiator}` },
          { status: 400 }
        );
      }
    }

    // Create dispute
    const dispute = createServiceDispute({
      orderId,
      initiatorAddress: initiator,
      reason: reason.trim().slice(0, 2000),
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
    return NextResponse.json({ error: message }, { status: servicesErrorStatus(err, 400) });
  }
}
