// End-to-end check of the seller price reduction (VeilServiceEscrow.partialRefund) on BNB Testnet,
// through the real API: chat -> payment request -> deposit -> partial refund -> cleanup refund.
// Uses TEST_BIDDER_PRIVATE_KEY (buyer) and TEST_SELLER_PRIVATE_KEY (seller); spends ~gas only, the
// deposit is returned to the buyer at the end.
// Run with the dev server on :3000:
//   node --env-file=.env.local node_modules/jiti/lib/jiti-cli.mjs scripts/e2e-partial-refund.ts <serviceId>
import { createPublicClient, createWalletClient, fallback, formatEther, http, parseEther, type Hex } from 'viem';
import { privateKeyToAccount, type PrivateKeyAccount } from 'viem/accounts';
import { bscTestnet } from 'viem/chains';
import { VEIL_SERVICE_ESCROW_ABI, getServiceEscrowAddress } from '../lib/serviceContract';
import { formatServiceOrderId } from '../lib/agent-sdk';
import { createServiceAuthMessage, createServiceSessionMessage, generateAuthNonce } from '../lib/serviceAuth';

const API = process.env.VEILIO_API_URL || 'http://127.0.0.1:3000';
const PRICE = '0.002';
const NEW_PRICE = '0.0015';

const key = (name: string) => {
  const raw = process.env[name]?.trim();
  if (!raw) throw new Error(`${name} missing`);
  return privateKeyToAccount((raw.startsWith('0x') ? raw : `0x${raw}`) as Hex);
};
const buyer = key('TEST_BIDDER_PRIVATE_KEY');
const seller = key('TEST_SELLER_PRIVATE_KEY');
const transport = fallback([http('https://bsc-testnet-rpc.publicnode.com'), http('https://data-seed-prebsc-2-s1.bnbchain.org:8545')]);
const pub = createPublicClient({ chain: bscTestnet, transport });
const walletOf = (account: PrivateKeyAccount) => createWalletClient({ account, chain: bscTestnet, transport });
const escrow = getServiceEscrowAddress(97);

async function sign(account: PrivateKeyAccount, action: string, orderId: string) {
  const timestamp = Date.now();
  const nonce = generateAuthNonce();
  const signature = await account.signMessage({
    message: createServiceAuthMessage({ action, orderId, address: account.address, timestamp, nonce }),
  });
  return { address: account.address, signature, timestamp, nonce };
}

async function session(account: PrivateKeyAccount) {
  const timestamp = Date.now();
  const nonce = generateAuthNonce();
  const signature = await account.signMessage({ message: createServiceSessionMessage({ address: account.address, timestamp, nonce }) });
  return { address: account.address, signature, timestamp, nonce };
}

async function post(path: string, body: unknown) {
  const res = await fetch(`${API}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return { status: res.status, data: await res.json() as any };
}

function check(label: string, ok: boolean, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
  if (!ok) process.exitCode = 1;
  return ok;
}

async function send(account: PrivateKeyAccount, functionName: string, args: unknown[], value?: bigint) {
  const hash = await walletOf(account).writeContract({ address: escrow, abi: VEIL_SERVICE_ESCROW_ABI, functionName, args, value } as any);
  const receipt = await pub.waitForTransactionReceipt({ hash });
  if (receipt.status !== 'success') throw new Error(`${functionName} reverted (${hash})`);
  return hash;
}

async function main() {
  const serviceId = process.argv[2];
  if (!serviceId) throw new Error('Usage: e2e-partial-refund.ts <serviceId of a listing owned by TEST_SELLER>');
  console.log(`escrow ${escrow}\nbuyer  ${buyer.address}\nseller ${seller.address}\n`);

  // 1. Chat + payment request + accept
  const conv = await post('/api/conversations', { buyerAddress: buyer.address, serviceId, serviceTitle: 'e2e partial refund', auth: await session(buyer) });
  if (!check('buyer opens conversation', conv.data.success, conv.data.error)) return;
  const conversationId = conv.data.conversation.id;

  const pr = await post('/api/payment-requests', {
    conversationId,
    description: 'E2E: price reduction test',
    agreedPrice: PRICE,
    network: 'bnb:97',
    currency: 'BNB',
    deadline: Date.now() + 3 * 24 * 3600 * 1000,
    auth: await sign(seller, 'create-payment-request', conversationId),
  });
  if (!check('seller creates payment request', pr.data.success, pr.data.error)) return;
  const prId = (pr.data.paymentRequest ?? pr.data.request ?? pr.data.pr).id;
  check('payment request targets the new escrow', String((pr.data.paymentRequest ?? pr.data.request ?? pr.data.pr).escrowContract).toLowerCase() === escrow.toLowerCase());

  const acc = await post(`/api/payment-requests/${prId}/accept`, { buyerAddress: buyer.address, auth: await sign(buyer, 'accept-payment-request', prId) });
  if (!check('buyer accepts payment request', acc.data.success, acc.data.error)) return;
  const order = acc.data.order;
  const orderBytes = formatServiceOrderId(order.escrowReference || order.id);

  // 2. Deposit + verify
  const depositTx = await send(buyer, 'deposit', [orderBytes, seller.address, BigInt(Math.ceil(order.deadline / 1000))], parseEther(PRICE));
  const dep = await post(`/api/orders/${order.id}/verify-deposit`, { txHash: depositTx, buyerAddress: buyer.address, auth: await sign(buyer, 'verify-deposit', order.id) });
  if (!check('deposit verified by API', dep.data.success, dep.data.error || depositTx)) return;

  // 3. Seller lowers the price
  const refundWei = parseEther(PRICE) - parseEther(NEW_PRICE);
  const buyerBefore = await pub.getBalance({ address: buyer.address });
  const partialTx = await send(seller, 'partialRefund', [orderBytes, refundWei, `Price renegotiated to ${NEW_PRICE}`]);
  const buyerAfter = await pub.getBalance({ address: buyer.address });
  check('buyer received the difference on-chain', buyerAfter - buyerBefore === refundWei, `${formatEther(buyerAfter - buyerBefore)} BNB, tx ${partialTx}`);

  const onChain = await pub.readContract({ address: escrow, abi: VEIL_SERVICE_ESCROW_ABI, functionName: 'getOrder', args: [orderBytes] }) as any;
  check('escrow now holds the new price', onChain.amount === parseEther(NEW_PRICE) && Number(onChain.status) === 1, `${formatEther(onChain.amount)} BNB, status ${onChain.status}`);

  const asBuyer = await post(`/api/orders/${order.id}/partial-refund`, { callerAddress: buyer.address, txHash: partialTx, auth: await sign(buyer, 'partial-refund', order.id) });
  check('API rejects the buyer', asBuyer.status === 403, `HTTP ${asBuyer.status}`);

  const rec = await post(`/api/orders/${order.id}/partial-refund`, {
    callerAddress: seller.address,
    txHash: partialTx,
    reason: 'Scope reduced in chat',
    auth: await sign(seller, 'partial-refund', order.id),
  });
  check('API records the price reduction', rec.data.success && rec.data.order?.priceSnapshot === NEW_PRICE && rec.data.order?.originalPriceSnapshot === PRICE,
    rec.data.error || `priceSnapshot ${rec.data.order?.priceSnapshot}, original ${rec.data.order?.originalPriceSnapshot}, status ${rec.data.order?.status}`);

  const replay = await post(`/api/orders/${order.id}/partial-refund`, { callerAddress: seller.address, txHash: partialTx, auth: await sign(seller, 'partial-refund', order.id) });
  check('API rejects replaying the same tx', replay.status === 409, `HTTP ${replay.status}`);

  // 4. Cleanup: seller cancels, remaining escrow goes back to the buyer
  const cancelTx = await send(seller, 'cancelOrder', [orderBytes, 'e2e cleanup']);
  const cancel = await post(`/api/orders/${order.id}/cancel`, { callerAddress: seller.address, reason: 'e2e cleanup', txHash: cancelTx, auth: await sign(seller, 'cancel', order.id) });
  check('cleanup refund of the remaining amount', cancel.data.success, cancel.data.error || `${cancel.data.order?.status}`);

  console.log(`\norder ${order.id}`);
}

main().catch((e) => {
  console.error('FAILED:', e?.shortMessage || e?.message || e);
  process.exit(1);
});
