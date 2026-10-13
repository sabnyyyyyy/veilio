import { NextRequest, NextResponse } from 'next/server';
import {
  getOrderById,
  transitionOrderStatus,
} from '@/lib/server/servicesDb';
import { isAddress, parseEventLogs, parseEther } from 'viem';
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
  getSolanaServiceFeeRecipient,
  getSolanaServiceReviewer,
  parseSolToLamports,
} from '@/lib/cross-chain/solanaServiceEscrow';
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

    // SEC-NEW-01: Enforce AwaitingPayment state precondition
    if (order.status !== 'AwaitingPayment') {
      return NextResponse.json(
        { error: `Cannot verify deposit: order is in state '${order.status}' (expected 'AwaitingPayment')` },
        { status: 400 }
      );
    }

    const body = await req.json();
    const { txHash, onChainOrderId, buyerAddress, auth, network: reqNetwork } = body;

    const caller = buyerAddress || auth?.address;
    if (!caller) {
      return NextResponse.json({ error: 'Valid buyerAddress is required' }, { status: 400 });
    }

    // 1. Cryptographic wallet authentication (AUDIT-001) - multi-chain aware
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

    // Settlement network comes from the stored order; a mismatching body value is rejected.
    const resolved = resolveOrderNetworkForRequest(order, reqNetwork);
    if (!resolved.ok) {
      return NextResponse.json({ error: resolved.error }, { status: resolved.status });
    }
    const minDeadlineSec = Math.floor(order.deadline / 1000);

    if (resolved.network === 'solana:devnet') {
      // Solana Verification Flow (fail-closed: tx + escrow account must match the order)
      if (!txHash || typeof txHash !== 'string') {
        return NextResponse.json(
          { error: 'Valid Solana transaction signature is required' },
          { status: 400 }
        );
      }

      let minAmountLamports: bigint;
      try {
        minAmountLamports = parseSolToLamports(order.priceSnapshot);
      } catch {
        return NextResponse.json({ error: `Order price is not a valid SOL amount: ${order.priceSnapshot}` }, { status: 500 });
      }

      const verification = await verifySolanaEscrowTransaction({
        signature: txHash,
        expectation: {
          orderId: order.escrowReference || order.id,
          buyer: order.buyerId,
          seller: order.sellerId,
          // Seller may already have called submit_delivery by the time the buyer verifies.
          allowedStatuses: ['Funded', 'Delivered'],
          minAmountLamports,
          // Reviewer / fee recipient must be the on-chain EscrowConfig's once it exists (upgraded
          // program); before the upgrade, the env platform reviewer / fee recipient. Fail-closed
          // (503) when neither is available.
          platform: {
            envReviewer: getSolanaServiceReviewer(),
            envFeeRecipient: getSolanaServiceFeeRecipient(),
          },
          minDeadlineSec,
          requiredSigner: order.buyerId,
          instruction: 'deposit',
        },
      });

      if (!verification.ok) {
        return NextResponse.json({ error: verification.error }, { status: verification.status });
      }

      const updated = transitionOrderStatus({
        orderId: id,
        from: ['AwaitingPayment'],
        to: 'InProgress',
        paymentStatus: 'Funded',
        escrowReference: verification.escrow.orderIdHex,
        txHash,
        paymentRequestStatus: 'funded',
        message: {
          senderId: order.buyerId,
          senderType: 'human',
          content: `[ESCROW FUNDED ON SOLANA DEVNET] Buyer deposited ${order.priceSnapshot} ${order.currency} into on-chain escrow. Sig: ${txHash.slice(0, 10)}...${txHash.slice(-8)}. Provider may begin work!`,
        },
      });

      return NextResponse.json({ success: true, order: updated });
    }

    // EVM Verification Flow (BNB Chain Testnet or Base Sepolia)
    const targetChainId = normalizeChainId(resolved.network);
    const client = getAgentPublicClientForChain(targetChainId);
    const targetContractAddr = getServiceEscrowAddress(targetChainId);

    // 2. Format check on transaction hash
    if (!txHash || typeof txHash !== 'string' || !/^0x[a-fA-F0-9]{64}$/.test(txHash)) {
      return NextResponse.json(
        { error: 'Valid transaction hash is required (0x followed by 64 hex characters)' },
        { status: 400 }
      );
    }

    if (!targetContractAddr || !isAddress(targetContractAddr)) {
      return NextResponse.json(
        { error: `Server configuration error: VeilServiceEscrow address is not configured for chain ID ${targetChainId}` },
        { status: 500 }
      );
    }

    // 3. Fail-Closed On-Chain Receipt Validation (AUDIT-002)
    let receipt;
    try {
      receipt = await client.getTransactionReceipt({ hash: txHash as `0x${string}` });
    } catch (rpcErr: any) {
      return NextResponse.json(
        { error: `Deposit transaction not confirmed on-chain (${targetChainId === 84532 ? 'Base Sepolia' : 'BNB Testnet'}): ${rpcErr?.shortMessage || rpcErr?.message || 'Transaction receipt not found'}` },
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
    // The on-chain order id is derived from the stored order only; a client-supplied
    // onChainOrderId must agree with it (prevents crediting one deposit to another order).
    const expectedOrderIdHex = formatServiceOrderId(order.escrowReference || order.id).toLowerCase();
    if (onChainOrderId && String(onChainOrderId).toLowerCase() !== expectedOrderIdHex) {
      return NextResponse.json(
        { error: `onChainOrderId does not match this order (${expectedOrderIdHex})` },
        { status: 400 }
      );
    }
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
    const logDeadline = Number((matchingLog as any).args?.deadline ?? 0);
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

    // A buyer-chosen on-chain deadline shorter than the agreed one would let the buyer
    // claim a timeout refund early, so it is rejected.
    if (!Number.isFinite(logDeadline) || logDeadline < minDeadlineSec) {
      return NextResponse.json(
        { error: `OrderFunded deadline (${logDeadline}) is earlier than the agreed order deadline (${minDeadlineSec})` },
        { status: 400 }
      );
    }

    // 6. Atomically move AwaitingPayment -> InProgress/Funded (409 if it changed meanwhile)
    const escrowRef = (matchingLog as any).args?.orderId || expectedOrderIdHex;
    const networkName = networkDisplayName(resolved.network);
    const updated = transitionOrderStatus({
      orderId: id,
      from: ['AwaitingPayment'],
      to: 'InProgress',
      paymentStatus: 'Funded',
      escrowReference: escrowRef,
      txHash,
      paymentRequestStatus: 'funded',
      message: {
        senderId: order.buyerId,
        senderType: 'human',
        content: `[ESCROW FUNDED ON ${networkName.toUpperCase()}] Buyer deposited ${order.priceSnapshot} ${order.currency} into on-chain escrow. Tx: ${txHash.slice(0, 10)}...${txHash.slice(-8)}. Seller may begin work!`,
      },
    });

    return NextResponse.json({ success: true, order: updated });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    return NextResponse.json({ error: message }, { status: servicesErrorStatus(err) });
  }
}
