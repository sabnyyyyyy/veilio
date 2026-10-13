import { NextRequest, NextResponse } from 'next/server';
import {
  getOrderById,
  transitionOrderStatus,
  FUNDED_ACTIVE_ORDER_STATUSES,
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
  networkDisplayName,
  resolveOrderNetworkForRequest,
  servicesErrorStatus,
} from '@/lib/server/serviceOrderNetwork';

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
    const { buyerAddress, releaseTxHash, auth, network: reqNetwork } = body;

    const caller = buyerAddress || auth?.address;
    if (!caller) {
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

    // Approval/release is only valid while escrow is funded and not disputed or settled.
    if (!FUNDED_ACTIVE_ORDER_STATUSES.includes(order.status) || order.paymentStatus !== 'Funded') {
      return NextResponse.json(
        { error: `Order cannot be approved in state '${order.status}' (payment: ${order.paymentStatus})` },
        { status: 409 }
      );
    }

    // Settlement network comes from the stored order; a mismatching body value is rejected.
    const resolved = resolveOrderNetworkForRequest(order, reqNetwork);
    if (!resolved.ok) {
      return NextResponse.json({ error: resolved.error }, { status: resolved.status });
    }

    if (resolved.network === 'solana:devnet') {
      if (!releaseTxHash || typeof releaseTxHash !== 'string') {
        return NextResponse.json(
          { error: 'Valid Solana release transaction signature is required' },
          { status: 400 }
        );
      }

      // Fail-closed: the release tx must be confirmed and the escrow account Released.
      const verification = await verifySolanaEscrowTransaction({
        signature: releaseTxHash,
        expectation: {
          orderId: order.escrowReference || order.id,
          buyer: order.buyerId,
          seller: order.sellerId,
          allowedStatuses: ['Released'],
          requiredSigner: order.buyerId,
          instruction: 'release_funds',
        },
      });
      if (!verification.ok) {
        return NextResponse.json({ error: verification.error }, { status: verification.status });
      }

      const updated = transitionOrderStatus({
        orderId: id,
        from: FUNDED_ACTIVE_ORDER_STATUSES,
        to: 'Completed',
        paymentStatus: 'Released',
        txHash: releaseTxHash,
        message: {
          senderId: order.buyerId,
          senderType: 'human',
          content: `[WORK APPROVED ON SOLANA DEVNET] Buyer approved deliverables and released funds to seller (${100 - verification.escrow.feeBasisPoints / 100}% to seller, ${verification.escrow.feeBasisPoints / 100}% platform fee). Signature: ${releaseTxHash.slice(0, 10)}...${releaseTxHash.slice(-8)}.`,
        },
      });

      return NextResponse.json({ success: true, order: updated });
    }

    // EVM flow (BNB Chain Testnet or Base Sepolia)
    const targetChainId = normalizeChainId(resolved.network);
    const client = getAgentPublicClientForChain(targetChainId);
    const targetContractAddr = getServiceEscrowAddress(targetChainId);

    // 2. Validate release transaction hash
    if (!releaseTxHash || typeof releaseTxHash !== 'string' || !/^0x[a-fA-F0-9]{64}$/.test(releaseTxHash)) {
      return NextResponse.json(
        { error: 'Valid release transaction hash is required (0x followed by 64 hex characters)' },
        { status: 400 }
      );
    }

    if (!targetContractAddr || !isAddress(targetContractAddr)) {
      return NextResponse.json(
        { error: `Server configuration error: VeilServiceEscrow address is not configured for chain ID ${targetChainId}` },
        { status: 500 }
      );
    }

    // 3. Fail-Closed On-Chain Receipt Validation (AUDIT-003)
    let receipt;
    try {
      receipt = await client.getTransactionReceipt({ hash: releaseTxHash as `0x${string}` });
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

    // Match order identifier
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

    // Verify buyer and seller match
    const logBuyer = String((matchingLog as any).args?.buyer || '').toLowerCase();
    const logSeller = String((matchingLog as any).args?.seller || '').toLowerCase();
    if (logBuyer !== order.buyerId.toLowerCase() || logSeller !== order.sellerId.toLowerCase()) {
      return NextResponse.json(
        { error: 'OrderReleased event parties do not match order participants' },
        { status: 400 }
      );
    }

    // Atomically move the funded order to Completed/Released (409 if it changed meanwhile)
    const networkName = networkDisplayName(resolved.network);
    const updated = transitionOrderStatus({
      orderId: id,
      from: FUNDED_ACTIVE_ORDER_STATUSES,
      to: 'Completed',
      paymentStatus: 'Released',
      txHash: releaseTxHash,
      message: {
        senderId: order.buyerId,
        senderType: 'human',
        content: `[WORK APPROVED ON ${networkName.toUpperCase()}] Buyer approved deliverables and released funds to seller (net of the on-chain platform fee). Tx: ${releaseTxHash.slice(0, 10)}...${releaseTxHash.slice(-8)}. Thank you!`,
      },
    });

    return NextResponse.json({ success: true, order: updated });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    return NextResponse.json({ error: message }, { status: servicesErrorStatus(err) });
  }
}
