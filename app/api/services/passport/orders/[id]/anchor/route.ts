import { NextRequest, NextResponse } from 'next/server';
import { bytesToHex, createPublicClient, http } from 'viem';
import { Connection } from '@solana/web3.js';
import { getOrderById, getTrustPassportRecordByOrder, saveTrustPassportAnchor } from '@/lib/server/servicesDb';
import { makeTrustPassportAnchorPayload } from '@/lib/server/trustPassport';
import { bnbChain, baseSepoliaChain } from '@/lib/chain';
import { withJsonStores } from '@/lib/server/jsonStore';

const SOLANA_MEMO_PROGRAM = 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr';

async function handleGET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const order = getOrderById(id);
  const record = getTrustPassportRecordByOrder(id);
  if (!order || !record) return NextResponse.json({ error: 'Trust Passport approval record not found' }, { status: 404 });
  if (!record.buyerApproval || !record.sellerApproval) return NextResponse.json({ success: true, approvals: { buyer: Boolean(record.buyerApproval), seller: Boolean(record.sellerApproval) }, anchored: false });
  if (record.anchor) return NextResponse.json({ success: true, anchor: record.anchor, alreadyAnchored: true, approvals: { buyer: true, seller: true } });
  let payload: string;
  try { payload = makeTrustPassportAnchorPayload(record); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : 'Could not build anchor payload' }, { status: 409 }); }
  return NextResponse.json({ success: true, approvals: { buyer: true, seller: true }, anchored: false, network: order.network || record.snapshot.network, payload });
}

async function handlePOST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const transaction = typeof body.transaction === 'string' ? body.transaction.trim() : '';
  const order = getOrderById(id);
  const record = getTrustPassportRecordByOrder(id);
  if (!order || !record) return NextResponse.json({ error: 'Trust Passport approval record not found' }, { status: 404 });
  if (!record.buyerApproval || !record.sellerApproval) return NextResponse.json({ error: 'Both participants must approve before anchoring' }, { status: 409 });
  if (record.anchor) return NextResponse.json({ success: true, record, alreadyAnchored: true });
  if (!transaction) return NextResponse.json({ error: 'A confirmed anchor transaction is required' }, { status: 400 });

  const payload = makeTrustPassportAnchorPayload(record);
  const network = order.network || record.snapshot.network;
  let anchor: { network: 'bnb:97' | 'base:84532' | 'solana:devnet'; transaction: string; anchoredAt: number };
  if (network === 'bnb:97' || network === 'base:84532') {
    if (!/^0x[\da-fA-F]{64}$/.test(transaction)) return NextResponse.json({ error: 'Invalid EVM transaction hash' }, { status: 400 });
    const chain = network === 'base:84532' ? baseSepoliaChain : bnbChain;
    const rpc = network === 'base:84532'
      ? (process.env.NEXT_PUBLIC_BASE_SEPOLIA_RPC || 'https://sepolia.base.org')
      : (process.env.NEXT_PUBLIC_BNB_CHAIN_RPC || 'https://bsc-testnet-rpc.publicnode.com');
    try {
      const client = createPublicClient({ chain, transport: http(rpc, { timeout: 12_000 }) });
      const tx = await client.getTransaction({ hash: transaction as `0x${string}` });
      const receipt = await client.getTransactionReceipt({ hash: transaction as `0x${string}` });
      const expectedData = bytesToHex(new TextEncoder().encode(payload));
      const participant = [record.snapshot.buyer, record.snapshot.seller].some((address) => address.toLowerCase() === tx.from.toLowerCase());
      if (receipt.status !== 'success' || tx.to?.toLowerCase() !== tx.from.toLowerCase() || tx.input.toLowerCase() !== expectedData.toLowerCase() || !participant) {
        return NextResponse.json({ error: 'EVM transaction does not contain this approved Passport proof or was not submitted by a participant' }, { status: 400 });
      }
    } catch {
      return NextResponse.json({ error: 'Could not find a successful anchor transaction on the order network' }, { status: 400 });
    }
    anchor = { network, transaction, anchoredAt: Date.now() };
  } else if (network === 'solana:devnet') {
    try {
      const connection = new Connection(process.env.SOLANA_DEVNET_RPC || 'https://api.devnet.solana.com', 'confirmed');
      const parsed = await connection.getParsedTransaction(transaction, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 });
      if (!parsed || parsed.meta?.err) return NextResponse.json({ error: 'Solana anchor transaction is not confirmed or failed' }, { status: 400 });
      const memo = parsed.transaction.message.instructions.find((instruction) =>
        'programId' in instruction && instruction.programId.toBase58() === SOLANA_MEMO_PROGRAM &&
        'parsed' in instruction && instruction.parsed === payload,
      );
      const feePayer = parsed.transaction.message.accountKeys[0];
      const participant = [record.snapshot.buyer, record.snapshot.seller].some((address) => address === feePayer.pubkey.toBase58());
      if (!memo || !feePayer.signer || !participant) return NextResponse.json({ error: 'Solana transaction does not contain this approved Passport proof or was not submitted by a participant' }, { status: 400 });
      // A parsed transaction signature is a base58 string; parsing above also validates the signature format.
    } catch {
      return NextResponse.json({ error: 'Could not verify the Passport memo transaction on Solana Devnet' }, { status: 400 });
    }
    anchor = { network, transaction, anchoredAt: Date.now() };
  } else {
    return NextResponse.json({ error: `Trust Passport anchoring is not enabled for ${network}` }, { status: 409 });
  }

  try {
    const saved = saveTrustPassportAnchor(id, record.proofHash, anchor);
    return NextResponse.json({ success: true, record: saved });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Could not save verified anchor' }, { status: 409 });
  }
}

export const GET = withJsonStores(handleGET);
export const POST = withJsonStores(handlePOST);
