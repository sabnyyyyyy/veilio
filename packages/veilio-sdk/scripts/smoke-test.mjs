// Offline smoke test against the built output: ESM + CJS entry points and core helpers.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createPublicClient, http } from 'viem';
import { bscTestnet, baseSepolia } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';
import * as esm from '../dist/esm/index.js';

const require = createRequire(import.meta.url);
const cjs = require('../dist/cjs/index.js');

for (const mod of [esm, cjs]) {
  for (const name of ['createVeilioAgent', 'createVeilioServicesClient', 'createVeilioServicesApi', 'signServiceAuth', 'VeilioSdkError', 'getVeilioDeployment']) {
    assert.equal(typeof mod[name], 'function', `${name} missing`);
  }
  assert.equal(mod.VEILIO_CHAIN_ID, 97);
}

// Throwaway key (well-known Hardhat account #0); never holds funds.
const account = privateKeyToAccount('0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80');
const publicClient = createPublicClient({ chain: bscTestnet, transport: http() });

const agent = esm.createVeilioAgent({ publicClient, account: account.address });
const bid = agent.prepareBid(1n, '0.05');
assert.match(bid.secret, /^0x[0-9a-f]{64}$/);
assert.match(bid.commitment, /^0x[0-9a-f]{64}$/);
assert.equal(bid.maxBidWei, '50000000000000000');
assert.equal(bid.chainId, 97);
for (const fn of ['settleAuction', 'finalizeSettlement', 'requestRefund', 'withdrawRefund', 'getPendingRefund', 'isNftAuction', 'claimAsset', 'waitForTransaction']) {
  assert.equal(typeof agent[fn], 'function', `agent.${fn} missing`);
}
assert.equal(agent.services.chainId, 97);

// ---------------------------------------------------------------- S4: chain selection + wallet chain guard
const baseAgent = esm.createVeilioAgent({ publicClient, account: account.address, chainId: 84532 });
assert.equal(baseAgent.chainId, 84532);
assert.equal(baseAgent.address, esm.VEILIO_DEPLOYMENTS.baseSepolia.auction);
assert.equal(baseAgent.services.chainId, 84532);
assert.equal(baseAgent.services.address, esm.VEILIO_DEPLOYMENTS.baseSepolia.serviceEscrow);
assert.equal(baseAgent.prepareBid(1n, '0.01').chainId, 84532);
assert.throws(() => esm.createVeilioAgent({ publicClient, account: account.address, chainId: 1 }), /Invalid chain ID 1/);

const writes = [];
const fakeWallet = (chain) => ({
  account,
  chain,
  writeContract: async (req) => {
    writes.push(req);
    return '0x' + 'ab'.repeat(32);
  },
});
// Mock reads for VeilNFTV4: auction #1 past reveal (settleable), #2 dataset in expired inspection, #3 NFT in inspection.
const now = BigInt(Math.floor(Date.now() / 1000));
const auctionRow = (id, { state, revealEnd, inspectionEnd, winner }) => [
  id, account.address, 'item', 'desc', '', 1n, now - 1000n, revealEnd, 3600n, inspectionEnd, state, winner, 10n, 1n, 1n, '0x' + '0'.repeat(64), '', '',
];
const rows = {
  1: { raw: auctionRow(1n, { state: 0, revealEnd: now - 10n, inspectionEnd: 0n, winner: '0x0000000000000000000000000000000000000000' }), state: 2, nft: 0 },
  2: { raw: auctionRow(2n, { state: 3, revealEnd: now - 5000n, inspectionEnd: now - 10n, winner: account.address }), state: 3, nft: 0 },
  3: { raw: auctionRow(3n, { state: 3, revealEnd: now - 5000n, inspectionEnd: now + 3600n, winner: account.address }), state: 3, nft: 1 },
};
const mockPublic = {
  readContract: async ({ functionName, args }) => {
    const row = rows[Number(args?.[0] ?? 0)];
    if (functionName === 'auctions') return row.raw;
    if (functionName === 'getAuctionState') return row.state;
    if (functionName === 'nftAssets') return [row.nft, account.address, 1n, 1n, true, false];
    if (functionName === 'pendingRefunds') return mockPending;
    throw new Error('unexpected read ' + functionName);
  },
};
let mockPending = 0n;
const wrongChain = esm.createVeilioAgent({ publicClient: mockPublic, walletClient: fakeWallet(baseSepolia), account: account.address });
await assert.rejects(wrongChain.settleAuction(1), (e) => e.code === 'CHAIN_MISMATCH');
await assert.rejects(wrongChain.commitBid(bid, '0.05'), (e) => e.code === 'CHAIN_MISMATCH');
const crossChainBid = { ...bid, chainId: 84532 };
const bnbAgent = esm.createVeilioAgent({ publicClient: mockPublic, walletClient: fakeWallet(bscTestnet), account: account.address });
await assert.rejects(bnbAgent.revealBid(crossChainBid), (e) => e.code === 'CHAIN_MISMATCH');
assert.equal(writes.length, 0, 'no transaction may be sent on a chain mismatch');

// ---------------------------------------------------------------- S3: auction lifecycle
await bnbAgent.settleAuction(1);
assert.equal(writes.at(-1).functionName, 'settleAuction');
assert.deepEqual(writes.at(-1).args, [1n]);
await bnbAgent.finalizeSettlement(2);
assert.equal(writes.at(-1).functionName, 'finalizeSettlement');
await assert.rejects(bnbAgent.finalizeSettlement(3), /Inspection period has not ended/);
await assert.rejects(bnbAgent.claimAsset(3), /finalizeSettlement/); // NFT auction
await bnbAgent.requestRefund(3, 'ipfs://QmEvidence');
assert.equal(writes.at(-1).functionName, 'requestRefund');
assert.deepEqual(writes.at(-1).args, [3n, 'ipfs://QmEvidence']);
await assert.rejects(bnbAgent.requestRefund(2, 'ipfs://late'), /inspection period/);
await assert.rejects(bnbAgent.requestRefund(3, '  '), /evidenceHash is required/);
await assert.rejects(bnbAgent.withdrawRefund(), /No pending refund/);
mockPending = 5n;
await bnbAgent.withdrawRefund();
assert.equal(writes.at(-1).functionName, 'withdrawRefund');
assert.deepEqual(writes.at(-1).args, []);
for (const w of writes) assert.equal(w.address, esm.VEILIO_DEPLOYMENTS.bnbTestnet.auction);

// ---------------------------------------------------------------- S5: off-chain Services API helper
const calls = [];
const mockFetch = async (url, init) => {
  calls.push({ url, method: init.method, headers: init.headers, body: init.body ? JSON.parse(init.body) : undefined });
  return { ok: true, status: 200, statusText: 'OK', json: async () => ({ success: true }) };
};
const api = esm.createVeilioServicesApi({ apiBaseUrl: 'https://veilio.test/', signer: account, fetch: mockFetch });
await api.notifyDeposit({ orderId: 'order-1', txHash: '0x' + '11'.repeat(32) });
assert.equal(calls[0].url, 'https://veilio.test/api/orders/order-1/verify-deposit');
assert.equal(calls[0].body.txHash, '0x' + '11'.repeat(32));
assert.equal(calls[0].body.buyerAddress, account.address);
assert.ok(!('network' in calls[0].body), 'verify-deposit must not send network');
assert.equal(calls[0].body.auth.address, account.address);
assert.match(calls[0].body.auth.signature, /^0x[0-9a-f]{130}$/);
await assert.rejects(api.submit({ orderId: 'order-1', description: 'Delivered report' }), /deliveryTxHash/);
await api.submit({ orderId: 'order-1', deliveryTxHash: '0x' + '33'.repeat(32), description: 'Delivered report', deliverableReferences: ['ipfs://x'] });
assert.equal(calls[1].url, 'https://veilio.test/api/orders/order-1/submit');
assert.equal(calls[1].body.sellerAddress, account.address);
assert.equal(calls[1].body.deliveryTxHash, '0x' + '33'.repeat(32));
assert.deepEqual(calls[1].body.deliverableReferences, ['ipfs://x']);
await api.approve({ orderId: 'order-1', releaseTxHash: '0x' + '22'.repeat(32) });
assert.equal(calls[2].body.releaseTxHash, '0x' + '22'.repeat(32));
await api.cancel({ orderId: 'order-1', reason: 'mutual' });
assert.equal(calls[3].body.callerAddress, account.address);
for (const c of calls) assert.ok(!('network' in c.body));
assert.equal(calls[0].body.auth.nonce === calls[1].body.auth.nonce, false, 'actions use fresh nonces');

// Session-authenticated reads: one session signature, reused, sent in x-veilio-auth.
calls.length = 0;
await api.getOrder('order-1');
await api.listConversations();
await api.getPaymentRequest('pr-1');
await api.getConversationMessages('conv-1');
assert.deepEqual(calls.map((c) => c.method), ['GET', 'GET', 'GET', 'GET']);
assert.equal(calls[0].url, 'https://veilio.test/api/orders/order-1');
assert.equal(calls[1].url, `https://veilio.test/api/conversations?userAddress=${account.address}`);
assert.equal(calls[2].url, 'https://veilio.test/api/payment-requests/pr-1');
assert.equal(calls[3].url, 'https://veilio.test/api/conversations/conv-1/messages');
const sessionPayloads = calls.map((c) => JSON.parse(c.headers['x-veilio-auth']));
assert.ok(sessionPayloads.every((p) => p.signature === sessionPayloads[0].signature), 'session is cached');
const { verifyMessage } = await import('viem');
assert.ok(
  await verifyMessage({
    address: account.address,
    message: esm.createServiceAuthMessage({ action: 'services-session', orderId: 'session', address: account.address, timestamp: sessionPayloads[0].timestamp, nonce: sessionPayloads[0].nonce }),
    signature: sessionPayloads[0].signature,
  })
);
assert.equal(esm.isServiceSessionFresh(sessionPayloads[0], account.address), true);
assert.equal(esm.isServiceSessionFresh({ ...sessionPayloads[0], timestamp: Date.now() - 30 * 60 * 1000 }), false);
const failing = esm.createVeilioServicesApi({
  apiBaseUrl: 'https://veilio.test',
  signer: account,
  fetch: async () => ({ ok: false, status: 401, statusText: 'Unauthorized', json: async () => ({ error: 'bad sig' }) }),
});
await assert.rejects(failing.approve({ orderId: 'o', releaseTxHash: '0x1' }), (e) => e.code === 'UNAUTHORIZED' && /bad sig/.test(e.message));

const services = esm.createVeilioServicesClient({ publicClient, account: account.address, chainId: 84532 });
assert.equal(services.address, esm.VEILIO_DEPLOYMENTS.baseSepolia.serviceEscrow);
assert.throws(() => esm.createVeilioServicesClient({ publicClient, chainId: 1 }), /Invalid chain ID/);

const auth = await esm.signServiceAuth(account, 'verify-deposit', 'order-1');
assert.equal(auth.address, account.address);
assert.match(auth.signature, /^0x[0-9a-f]{130}$/);

// ---------------------------------------------------------------- Solana (offline, mocked RPC)
const sol = await import('../dist/esm/solana/index.js');
const solCjs = require('../dist/cjs/solana/index.js');
assert.equal(typeof solCjs.createVeilioSolanaClient, 'function');
const { Keypair, Transaction } = await import('@solana/web3.js');

const agentKey = Keypair.generate();
const sent = [];
const mockConnection = {
  getLatestBlockhash: async () => ({ blockhash: Keypair.generate().publicKey.toBase58(), lastValidBlockHeight: 100 }),
  sendRawTransaction: async (raw) => {
    sent.push(Transaction.from(raw));
    return 'mock-signature-' + sent.length;
  },
  confirmTransaction: async () => ({ value: { err: null } }),
  getAccountInfo: async () => null,
};
const solana = sol.createVeilioSolanaClient({ connection: mockConnection, signer: sol.keypairSigner(agentKey) });

assert.equal(sol.solToLamports('1.5'), 1_500_000_000n);
assert.equal(sol.solToLamports('0.000000001'), 1n);
assert.throws(() => sol.solToLamports('0.0000000001'), /max 9 decimals/);
assert.equal(sol.toSolanaOrderId('ord-1'), Buffer.concat([Buffer.from('ord-1'), Buffer.alloc(27)]).toString('hex'));

const solBid = solana.prepareBid(3, '0.25');
assert.equal(solBid.maxBidLamports, '250000000');
assert.match(solBid.salt, /^[0-9a-f]{64}$/);
await assert.rejects(solana.commitBid(solBid, '0.1'), /cover the maximum bid/);
assert.equal(await solana.commitBid(solBid, '0.3'), 'mock-signature-1');

const tx = sent[0];
assert.ok(tx.verifySignatures(), 'transaction must be signed by the agent');
const ix = tx.instructions[0];
assert.equal(ix.programId.toBase58(), solana.auctionProgramId);
assert.equal(ix.keys[2].pubkey.toBase58(), agentKey.publicKey.toBase58());
assert.ok(ix.data.subarray(8, 40).equals(Buffer.from(solBid.commitment, 'hex')));
assert.equal(ix.data.readBigUInt64LE(40), 300_000_000n);

await assert.rejects(
  solana.deposit({
    orderId: 'ord-1',
    seller: Keypair.generate().publicKey.toBase58(),
    reviewer: solana.escrowProgramId,
    feeRecipient: Keypair.generate().publicKey.toBase58(),
    amountSol: '1',
    deadline: Math.floor(Date.now() / 1000) + 3600,
  }),
  /program ID can never resolve/
);
const sellerKey = Keypair.generate().publicKey.toBase58();
await assert.rejects(
  solana.deposit({
    orderId: 'ord-1',
    seller: sellerKey.toLowerCase(),
    reviewer: Keypair.generate().publicKey.toBase58(),
    feeRecipient: Keypair.generate().publicKey.toBase58(),
    amountSol: '1',
    deadline: Math.floor(Date.now() / 1000) + 3600,
  }),
  /not a valid Solana address|base58/
);
await assert.rejects(solana.releaseFunds('ord-missing'), /not found/);

// Reveal: bidder must be writable (over-deposit refund).
await solana.revealBid(solBid);
const revealIx = sent.at(-1).instructions[0];
assert.equal(revealIx.keys[2].pubkey.toBase58(), agentKey.publicKey.toBase58());
assert.equal(revealIx.keys[2].isWritable, true);

// Lifecycle instructions
await solana.settleAuction(3);
assert.ok(sent.at(-1).instructions[0].data.equals(Buffer.from(sol.getAnchorDiscriminator('global', 'settle_auction'))));
await solana.requestRefund(3, 'ab'.repeat(32));
assert.ok(sent.at(-1).instructions[0].data.subarray(8).equals(Buffer.from('ab'.repeat(32), 'hex')));
await assert.rejects(solana.requestRefund(3, '00'.repeat(32)), /32 non-zero bytes/);
await solana.finalizeRefundTimeout(3);
assert.ok(sent.at(-1).instructions[0].data.equals(Buffer.from(sol.getAnchorDiscriminator('global', 'finalize_refund_timeout'))));
await assert.rejects(solana.finalizeInspectionTimeout(3), /not found/);
for (const fn of ['acceptDataset', 'claimRefund']) assert.equal(typeof solana[fn], 'function');

// Escrow deposit: reviewer/feeRecipient default to platform options; reviewer can't be buyer/seller.
const platformReviewer = Keypair.generate().publicKey.toBase58();
const platformFeeRecipient = Keypair.generate().publicKey.toBase58();
const deadline = Math.floor(Date.now() / 1000) + 3600;
await assert.rejects(
  solana.deposit({ orderId: 'ord-2', seller: sellerKey, amountSol: '1', deadline }),
  /platformReviewer/
);
const solanaWithPlatform = sol.createVeilioSolanaClient({
  connection: mockConnection,
  signer: sol.keypairSigner(agentKey),
  platformReviewer,
  platformFeeRecipient,
});
await solanaWithPlatform.deposit({ orderId: 'ord-2', seller: sellerKey, amountSol: '1', deadline });
const depositIx = sent.at(-1).instructions[0];
const depositData = depositIx.data;
// data = disc(8) | order_id(32) | seller(32) | reviewer(32) | fee_recipient(32) | amount | deadline
assert.equal(sol.encodeBase58(depositData.subarray(72, 104)), platformReviewer);
assert.equal(sol.encodeBase58(depositData.subarray(104, 136)), platformFeeRecipient);
await assert.rejects(
  solanaWithPlatform.deposit({ orderId: 'ord-3', seller: sellerKey, reviewer: agentKey.publicKey.toBase58(), amountSol: '1', deadline }),
  /not the buyer or seller/
);
await assert.rejects(
  solanaWithPlatform.deposit({ orderId: 'ord-3', seller: sellerKey, reviewer: sellerKey, amountSol: '1', deadline }),
  /not the buyer or seller/
);

// Upgraded programs: deposit / resolve_dispute / create_auction / review_refund carry the global
// config PDA as their LAST, read-only account (the pre-upgrade programs ignore it).
const { PublicKey } = await import('@solana/web3.js');
const escrowConfigPda = sol.findEscrowConfigPda(solana.escrowProgramId).pda;
const auctionConfigPda = sol.findAuctionConfigPda(solana.auctionProgramId).pda;
assert.equal(escrowConfigPda, PublicKey.findProgramAddressSync([Buffer.from('escrow_config')], new PublicKey(solana.escrowProgramId))[0].toBase58());
assert.equal(auctionConfigPda, PublicKey.findProgramAddressSync([Buffer.from('auction_config')], new PublicKey(solana.auctionProgramId))[0].toBase58());
assert.equal(
  sol.findProgramDataPda(solana.escrowProgramId).pda,
  PublicKey.findProgramAddressSync([new PublicKey(solana.escrowProgramId).toBuffer()], new PublicKey(sol.BPF_LOADER_UPGRADEABLE_PROGRAM_ID))[0].toBase58()
);
assert.equal(depositIx.keys.length, 5);
assert.equal(depositIx.keys[3].pubkey.toBase58(), sol.SYSTEM_PROGRAM_ID);
assert.equal(depositIx.keys[4].pubkey.toBase58(), escrowConfigPda);
assert.equal(depositIx.keys[4].isSigner, false);
assert.equal(depositIx.keys[4].isWritable, false);
const lastKey = (ix) => ix.accounts[ix.accounts.length - 1];
const resolveIx = sol.createResolveDisputeInstruction({
  reviewer: platformReviewer, buyer: agentKey.publicKey.toBase58(), seller: sellerKey,
  feeRecipient: platformFeeRecipient, orderId: sol.toSolanaOrderId('ord-2'), splitToBuyerPercent: 40,
});
assert.equal(resolveIx.accounts.length, 8);
assert.deepEqual(lastKey(resolveIx), { pubkey: escrowConfigPda, isSigner: false, isWritable: false });
const createIx = sol.createCreateAuctionInstruction({
  seller: sellerKey, reviewer: platformReviewer, auctionId: 9n, itemName: 'n', description: 'd', imageUri: 'u',
  startingPriceLamports: 1n, commitDurationSeconds: 60, revealDurationSeconds: 60, inspectionDurationSeconds: 3600,
});
assert.equal(createIx.accounts.length, 5);
assert.deepEqual(lastKey(createIx), { pubkey: auctionConfigPda, isSigner: false, isWritable: false });
const reviewIx = sol.createReviewRefundInstruction({ auctionId: 9n, seller: sellerKey, reviewer: platformReviewer, winner: agentKey.publicKey.toBase58(), approve: true });
assert.equal(reviewIx.accounts.length, 6);
assert.deepEqual(lastKey(reviewIx), { pubkey: auctionConfigPda, isSigner: false, isWritable: false });

// initialize_config / update_config builders + decoders
const adminKey = Keypair.generate().publicKey.toBase58();
const initEscrow = sol.createInitializeEscrowConfigInstruction({ admin: adminKey, reviewer: platformReviewer, feeRecipient: platformFeeRecipient, feeBasisPoints: 500 });
assert.deepEqual(initEscrow.accounts.map((a) => a.pubkey), [
  escrowConfigPda, adminKey, solana.escrowProgramId, sol.findProgramDataPda(solana.escrowProgramId).pda, sol.SYSTEM_PROGRAM_ID,
]);
assert.ok(initEscrow.data.subarray(0, 8).equals(sol.getAnchorDiscriminator('global', 'initialize_config')));
assert.equal(initEscrow.data.length, 8 + 32 + 32 + 2);
assert.throws(() => sol.createInitializeEscrowConfigInstruction({ admin: adminKey, reviewer: platformReviewer, feeRecipient: platformFeeRecipient, feeBasisPoints: 501 }), /between 0 and 500/);
const updEscrow = sol.createUpdateEscrowConfigInstruction({ admin: adminKey, reviewer: platformReviewer, feeRecipient: platformFeeRecipient, feeBasisPoints: 100 });
assert.equal(updEscrow.data.length, 8 + 32 + 32 + 2 + 32);
assert.ok(updEscrow.data.subarray(0, 8).equals(sol.getAnchorDiscriminator('global', 'update_config')));
const initAuction = sol.createInitializeAuctionConfigInstruction({ admin: adminKey, reviewer: platformReviewer });
assert.equal(initAuction.accounts.length, 5);
assert.equal(initAuction.data.length, 8 + 32);
const updAuction = sol.createUpdateAuctionConfigInstruction({ admin: adminKey, reviewer: platformReviewer, newAdmin: sellerKey });
assert.equal(sol.encodeBase58(updAuction.data.subarray(40, 72)), sellerKey);

const configReviewer = Keypair.generate().publicKey.toBase58();
const configFeeRecipient = Keypair.generate().publicKey.toBase58();
const fee = Buffer.alloc(2); fee.writeUInt16LE(300);
const escrowConfigData = Buffer.concat([
  sol.getAnchorDiscriminator('account', 'EscrowConfig'),
  new PublicKey(adminKey).toBuffer(), new PublicKey(configReviewer).toBuffer(), new PublicKey(configFeeRecipient).toBuffer(),
  fee, Buffer.from([255]),
]);
assert.deepEqual(sol.decodeEscrowConfigAccount(escrowConfigData), {
  admin: adminKey, reviewer: configReviewer, feeRecipient: configFeeRecipient, feeBasisPoints: 300, bump: 255,
});
const auctionConfigData = Buffer.concat([
  sol.getAnchorDiscriminator('account', 'AuctionConfig'), new PublicKey(adminKey).toBuffer(), new PublicKey(configReviewer).toBuffer(), Buffer.from([254]),
]);
assert.deepEqual(sol.decodeAuctionConfigAccount(auctionConfigData), { admin: adminKey, reviewer: configReviewer, bump: 254 });

// Once the on-chain EscrowConfig exists, deposit() uses it (the upgraded program ignores passed values).
const configConnection = {
  ...mockConnection,
  getAccountInfo: async (key) => {
    const k = key.toBase58();
    if (k === escrowConfigPda) return { data: escrowConfigData, owner: new PublicKey(solana.escrowProgramId) };
    if (k === auctionConfigPda) return { data: auctionConfigData, owner: new PublicKey(solana.auctionProgramId) };
    return null;
  },
};
const solanaWithConfig = sol.createVeilioSolanaClient({ connection: configConnection, signer: sol.keypairSigner(agentKey), platformReviewer, platformFeeRecipient });
assert.deepEqual(await solanaWithConfig.getEscrowConfig(), sol.decodeEscrowConfigAccount(escrowConfigData));
assert.equal((await solanaWithConfig.getAuctionConfig()).reviewer, configReviewer);
assert.equal(await solana.getEscrowConfig(), null);
await solanaWithConfig.deposit({ orderId: 'ord-4', seller: sellerKey, amountSol: '1', deadline });
const configDepositData = sent.at(-1).instructions[0].data;
assert.equal(sol.encodeBase58(configDepositData.subarray(72, 104)), configReviewer);
assert.equal(sol.encodeBase58(configDepositData.subarray(104, 136)), configFeeRecipient);

console.log('veilioexchange smoke test passed');
