import { expect } from 'chai';
import { ed25519 } from '@noble/curves/ed25519';
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts';
import {
  createPaymentRequest,
  createOrderFromPaymentRequest,
  getConversationMessages,
  getOrCreateConversation,
  getOrderById,
  getOrderNetwork,
  addOrderSubmission,
  addOrderRevision,
  transitionOrderStatus,
  updateOrderStatus,
  normalizeWalletAddress,
  OrderStateConflictError,
  type ServiceOrder,
} from '../lib/server/servicesDb';
import { resolveOrderNetworkForRequest } from '../lib/server/serviceOrderNetwork';
import { verifyServiceSessionAuth, extractServiceAuth } from '../lib/server/serviceAuth';
import {
  createServiceAuthMessage,
  createServiceSessionMessage,
  SERVICE_AUTH_HEADER,
  SERVICE_SESSION_MAX_AGE_MS,
} from '../lib/serviceAuth';
import { buildCanonicalMetadata, hashCanonicalMetadata } from '../lib/serviceRegistry';
import { SolanaChainAdapter } from '../lib/cross-chain/SolanaChainAdapter';
import {
  findEscrowConfigPda,
  findEscrowOrderPda,
  findVaultPda,
  toSolanaEscrowOrderIdHex,
  DEFAULT_SOLANA_SERVICE_ESCROW_PROGRAM_ID,
} from '../lib/cross-chain/solanaServiceEscrow';
import {
  decodeBase58,
  encodeBase58,
  getAnchorDiscriminator,
  SYSTEM_PROGRAM_ID,
} from '../lib/cross-chain/solanaServiceRegistry';
import {
  resolveSolanaEscrowPlatformConfig,
  verifySolanaEscrowTransaction,
} from '../lib/server/solanaServiceVerification';

// Services DB tests write to VEILIO_SERVICES_DB_FILE when set (recommended), else data/db.

function solanaKeypair() {
  const secret = ed25519.utils.randomPrivateKey();
  return { secret, address: encodeBase58(ed25519.getPublicKey(secret)) };
}

function randomSignature(): string {
  // 64 random bytes -> 87/88 base58 chars (valid Solana signature shape)
  for (;;) {
    const sig = encodeBase58(Buffer.concat([
      Buffer.from(ed25519.utils.randomPrivateKey()),
      Buffer.from(ed25519.utils.randomPrivateKey()),
    ]));
    if (sig.length >= 86 && sig.length <= 90) return sig;
  }
}

function encodeEscrowAccount(p: {
  buyer: string; seller: string; reviewer: string; feeRecipient: string;
  orderIdHex: string; amount: bigint; deadline: number; status: number;
}): Buffer {
  const u64 = Buffer.alloc(8); u64.writeBigUInt64LE(p.amount);
  const fee = Buffer.alloc(2); fee.writeUInt16LE(500);
  const deadline = Buffer.alloc(8); deadline.writeBigInt64LE(BigInt(p.deadline));
  const ts = Buffer.alloc(8); ts.writeBigInt64LE(1n);
  const strLen = Buffer.alloc(4); strLen.writeUInt32LE(0);
  return Buffer.concat([
    getAnchorDiscriminator('account', 'EscrowOrder'),
    Buffer.from(decodeBase58(p.buyer)),
    Buffer.from(decodeBase58(p.seller)),
    Buffer.from(decodeBase58(p.reviewer)),
    Buffer.from(decodeBase58(p.feeRecipient)),
    Buffer.from(p.orderIdHex.slice(2), 'hex'),
    u64, fee, deadline, Buffer.from([p.status]), ts, ts, strLen, Buffer.from([255, 254]),
  ]);
}

describe('Services flow remediation (network binding, fail-closed Solana, DB integrity, auth)', () => {
  describe('servicesDb: lost-write, address normalization, state guards', () => {
    const seller = '0x1111111111111111111111111111111111111111';
    const buyer = '0x2222222222222222222222222222222222222222';
    const serviceId = `srv-remediation-${Date.now()}`;
    let conversationId: string;

    it('persists the payment request card message (no lost write) and order network', () => {
      const conv = getOrCreateConversation(buyer, seller, serviceId, 'Remediation test');
      conversationId = conv.id;
      const pr = createPaymentRequest({
        conversationId,
        serviceId,
        buyerId: buyer,
        sellerId: seller,
        description: 'Base order',
        scope: 'scope',
        agreedPrice: '0.01',
        currency: 'ETH',
        deadline: Date.now() + 3 * 86400000,
        revisionTerms: 'std',
        escrowContract: '0x794f1610B5588a55B19D8c82e4381448a388C965',
        network: 'base:84532',
        expiresAt: Date.now() + 86400000,
      });
      const messages = getConversationMessages(conversationId);
      expect(messages.some((m) => m.paymentRequestId === pr.id)).to.equal(true);

      const order = createOrderFromPaymentRequest(pr.id, buyer);
      expect(order.network).to.equal('base:84532');
      expect(getConversationMessages(conversationId).some((m) => m.content.includes(`[ORDER CREATED] Order #${order.id}`))).to.equal(true);
    });

    it('keeps Solana base58 addresses case-sensitive while lowercasing EVM', () => {
      const solBuyer = solanaKeypair().address;
      const solSeller = solanaKeypair().address;
      expect(normalizeWalletAddress('0xAbCdEf0000000000000000000000000000000001')).to.equal('0xabcdef0000000000000000000000000000000001');
      expect(normalizeWalletAddress(solBuyer)).to.equal(solBuyer);

      const conv = getOrCreateConversation(solBuyer, solSeller, `${serviceId}-sol`, 'Solana');
      expect(conv.buyerId).to.equal(solBuyer);
      const pr = createPaymentRequest({
        conversationId: conv.id, serviceId: `${serviceId}-sol`, buyerId: solBuyer, sellerId: solSeller,
        description: 'sol', scope: 'sol', agreedPrice: '0.1', currency: 'SOL',
        deadline: Date.now() + 3 * 86400000, revisionTerms: 'std',
        escrowContract: DEFAULT_SOLANA_SERVICE_ESCROW_PROGRAM_ID, network: 'solana:devnet',
        expiresAt: Date.now() + 86400000,
      });
      const order = createOrderFromPaymentRequest(pr.id, solBuyer);
      expect(order.buyerId).to.equal(solBuyer);
      expect(order.sellerId).to.equal(solSeller);
      expect(getOrderNetwork(order)).to.equal('solana:devnet');
    });

    it('guards submit / revision / transition state changes', () => {
      const pr = createPaymentRequest({
        conversationId, serviceId, buyerId: buyer, sellerId: seller, description: 'guard', scope: 'guard',
        agreedPrice: '0.02', currency: 'BNB', deadline: Date.now() + 3 * 86400000, revisionTerms: 'std',
        escrowContract: '0x0000000000000000000000000000000000000001', network: 'bnb:97', expiresAt: Date.now() + 86400000,
      });
      const order = createOrderFromPaymentRequest(pr.id, buyer);

      // Not funded yet: no submission, no revision
      expect(() => addOrderSubmission(order.id, seller, 'early work', [])).to.throw(OrderStateConflictError);
      expect(() => addOrderRevision(order.id, buyer, 'too early')).to.throw(OrderStateConflictError);
      // Approve-style transition from AwaitingPayment is rejected
      expect(() => transitionOrderStatus({ orderId: order.id, from: ['InProgress', 'InReview'], to: 'Completed' }))
        .to.throw(OrderStateConflictError);

      transitionOrderStatus({ orderId: order.id, from: ['AwaitingPayment'], to: 'InProgress', paymentStatus: 'Funded' });
      // Revision only from InReview
      expect(() => addOrderRevision(order.id, buyer, 'not submitted yet')).to.throw(OrderStateConflictError);
      addOrderSubmission(order.id, seller, 'delivered work', []);
      expect(getOrderById(order.id)?.status).to.equal('InReview');
      addOrderRevision(order.id, buyer, 'please fix');
      expect(getOrderById(order.id)?.status).to.equal('RevisionRequested');

      // Disputed / Completed orders cannot be resubmitted
      updateOrderStatus(order.id, 'Disputed', 'Disputed');
      expect(() => addOrderSubmission(order.id, seller, 'sneaky resubmit', [])).to.throw(OrderStateConflictError);
      updateOrderStatus(order.id, 'Completed', 'Released');
      expect(() => addOrderSubmission(order.id, seller, 'after completion', [])).to.throw(OrderStateConflictError);
    });
  });

  describe('Order network is server-authoritative', () => {
    const base = {
      id: 'ord-net-1', serviceId: 's', paymentRequestId: '', buyerId: '0x2222222222222222222222222222222222222222',
      sellerId: '0x1111111111111111111111111111111111111111', conversationId: 'c', serviceTitle: 't', scopeSnapshot: 's',
      priceSnapshot: '1', currency: 'BNB', deadline: Date.now(), status: 'AwaitingPayment', paymentStatus: 'NotPaid',
      createdAt: 0, updatedAt: 0,
    } as ServiceOrder;

    it('rejects a body network that differs from the stored order network', () => {
      const res = resolveOrderNetworkForRequest({ ...base, network: 'bnb:97' }, 'solana:devnet');
      expect(res.ok).to.equal(false);
      if (!res.ok) expect(res.status).to.equal(400);
    });

    it('accepts a matching or absent body network and maps legacy labels', () => {
      expect(resolveOrderNetworkForRequest({ ...base, network: 'base:84532' }, 'base:84532').ok).to.equal(true);
      const legacy = resolveOrderNetworkForRequest({ ...base, currency: 'ETH' }, undefined);
      expect(legacy.ok && legacy.network).to.equal('base:84532');
    });
  });

  describe('Deterministic metadata hash', () => {
    const fields = {
      id: 'srv-hash-1', seller: '0xAAAAaaaaAAAAaaaaAAAAaaaaAAAAaaaaAAAAaaaa', sellerType: 'human' as const,
      sellerName: 'S', title: 'Title here', description: 'Description long enough', category: 'AI Development',
      price: '0.5', currency: 'BNB', deliveryTime: '3 Days', sampleDeliverables: ['a'],
    };

    it('requires an explicit createdAt and produces identical hashes for identical inputs', () => {
      expect(() => buildCanonicalMetadata({ ...fields, createdAt: undefined as unknown as number })).to.throw();
      const h1 = hashCanonicalMetadata(buildCanonicalMetadata({ ...fields, createdAt: 1775550000000 }));
      const h2 = hashCanonicalMetadata(buildCanonicalMetadata({ ...fields, createdAt: 1775550000000 }));
      const h3 = hashCanonicalMetadata(buildCanonicalMetadata({ ...fields, createdAt: 1775550000001 }));
      expect(h1).to.equal(h2);
      expect(h1).to.not.equal(h3);
    });

    it('does not lowercase Solana sellers', () => {
      const sol = solanaKeypair().address;
      expect(buildCanonicalMetadata({ ...fields, seller: sol, createdAt: 1 }).seller).to.equal(sol);
    });
  });

  describe('Services session auth (reads / chat)', () => {
    it('accepts a valid EVM session repeatedly and via header', async () => {
      const account = privateKeyToAccount(generatePrivateKey());
      const timestamp = Date.now();
      const nonce = 'session-nonce-1';
      const signature = await account.signMessage({ message: createServiceSessionMessage({ address: account.address, timestamp, nonce }) });
      const auth = { address: account.address, signature, timestamp, nonce };

      const first = await verifyServiceSessionAuth(auth);
      const second = await verifyServiceSessionAuth(auth);
      expect(first.valid).to.equal(true);
      expect(second.valid).to.equal(true);
      expect(first.address).to.equal(account.address.toLowerCase());

      const headers = new Map([[SERVICE_AUTH_HEADER, JSON.stringify(auth)]]);
      const extracted = extractServiceAuth({ get: (n: string) => headers.get(n) ?? null });
      expect((await verifyServiceSessionAuth(extracted)).valid).to.equal(true);
    });

    it('rejects expired sessions and signatures for other actions', async () => {
      const account = privateKeyToAccount(generatePrivateKey());
      const old = Date.now() - SERVICE_SESSION_MAX_AGE_MS - 1000;
      const sigOld = await account.signMessage({ message: createServiceSessionMessage({ address: account.address, timestamp: old, nonce: 'nonce-old' }) });
      expect((await verifyServiceSessionAuth({ address: account.address, signature: sigOld, timestamp: old, nonce: 'nonce-old' })).valid).to.equal(false);

      const now = Date.now();
      const sigOther = await account.signMessage({ message: createServiceAuthMessage({ action: 'approve', orderId: 'x', address: account.address, timestamp: now, nonce: 'nonce-other' }) });
      expect((await verifyServiceSessionAuth({ address: account.address, signature: sigOther, timestamp: now, nonce: 'nonce-other' })).valid).to.equal(false);
    });

    it('accepts an Ed25519 Solana session', async () => {
      const kp = solanaKeypair();
      const timestamp = Date.now();
      const nonce = 'sol-session-1';
      const sig = ed25519.sign(Buffer.from(createServiceSessionMessage({ address: kp.address, timestamp, nonce }), 'utf8'), kp.secret);
      const res = await verifyServiceSessionAuth({ address: kp.address, signature: '0x' + Buffer.from(sig).toString('hex'), timestamp, nonce });
      expect(res.valid).to.equal(true);
      expect(res.address).to.equal(kp.address);
    });
  });

  describe('Solana escrow verification is fail-closed', () => {
    const programId = DEFAULT_SOLANA_SERVICE_ESCROW_PROGRAM_ID;
    const orderId = 'ord-1775550000000-abcde';
    const orderIdHex = toSolanaEscrowOrderIdHex(orderId);
    const escrowPda = findEscrowOrderPda(orderIdHex, programId).pda;
    const vaultPda = findVaultPda(orderIdHex, programId).pda;
    const buyer = solanaKeypair().address;
    const seller = solanaKeypair().address;
    const reviewer = solanaKeypair().address;
    const feeRecipient = solanaKeypair().address;
    const signature = randomSignature();

    function mockAdapter(opts: {
      status?: 'confirmed' | 'missing' | 'error' | 'rpc_down';
      accountKeys?: string[];
      escrow?: Partial<Parameters<typeof encodeEscrowAccount>[0]>;
      owner?: string;
      /** EscrowConfig PDA: undefined/null = not initialized (pre-upgrade). */
      config?: { reviewer: string; feeRecipient: string; owner?: string } | 'rpc_error' | null;
    } = {}) {
      const configPda = findEscrowConfigPda(programId).pda;
      const fetchFn = (async (_url: string, init: any) => {
        if (opts.status === 'rpc_down') throw new Error('fetch failed: network unreachable');
        const { method } = JSON.parse(init.body);
        let result: unknown;
        if (method === 'getSignatureStatuses') {
          result = {
            value: [opts.status === 'missing' ? null : {
              slot: 10, confirmations: 5, err: opts.status === 'error' ? { InstructionError: [0, 'Custom'] } : null,
              confirmationStatus: 'confirmed',
            }],
          };
        } else if (method === 'getTransaction') {
          const keys = opts.accountKeys || [buyer, escrowPda, vaultPda, SYSTEM_PROGRAM_ID, programId];
          result = {
            slot: 10,
            meta: { err: null },
            transaction: {
              message: {
                accountKeys: keys,
                header: { numRequiredSignatures: 1 },
                instructions: [{
                  programIdIndex: keys.indexOf(programId),
                  accounts: [1, 2, 0, 3],
                  data: encodeBase58(Buffer.concat([getAnchorDiscriminator('global', 'deposit'), Buffer.alloc(8)])),
                }],
              },
            },
          };
        } else if (method === 'getAccountInfo' && JSON.parse(init.body).params[0] === configPda) {
          if (opts.config === 'rpc_error') {
            return { ok: true, status: 200, statusText: 'OK', json: async () => ({ jsonrpc: '2.0', id: 1, error: { code: -32000, message: 'node is behind' } }) };
          }
          if (!opts.config) {
            result = { value: null };
          } else {
            const data = encodeEscrowConfig(opts.config);
            result = { value: { owner: opts.config.owner || programId, lamports: 1, executable: false, data: [data.toString('base64'), 'base64'] } };
          }
        } else if (method === 'getAccountInfo') {
          const data = encodeEscrowAccount({
            buyer, seller, reviewer, feeRecipient, orderIdHex, amount: 100_000_000n,
            deadline: 2_000_000_000, status: 1, ...opts.escrow,
          });
          result = { value: { owner: opts.owner || programId, lamports: 1, executable: false, data: [data.toString('base64'), 'base64'] } };
        }
        return { ok: true, status: 200, statusText: 'OK', json: async () => ({ jsonrpc: '2.0', id: 1, result }) };
      }) as unknown as typeof fetch;
      return new SolanaChainAdapter({ networkId: 'solana:devnet', fetchFn });
    }

    const expectation = {
      orderId, buyer, seller, allowedStatuses: ['Funded' as const, 'Delivered' as const],
      minAmountLamports: 100_000_000n, expectedReviewer: reviewer, expectedFeeRecipient: feeRecipient,
      minDeadlineSec: 1_900_000_000, requiredSigner: buyer, instruction: 'deposit',
    };

    function encodeEscrowConfig(c: { reviewer: string; feeRecipient: string }): Buffer {
      const fee = Buffer.alloc(2); fee.writeUInt16LE(500);
      return Buffer.concat([
        getAnchorDiscriminator('account', 'EscrowConfig'),
        Buffer.from(decodeBase58(solanaKeypair().address)), // admin
        Buffer.from(decodeBase58(c.reviewer)),
        Buffer.from(decodeBase58(c.feeRecipient)),
        fee,
        Buffer.from([255]),
      ]);
    }

    const { expectedReviewer: _r, expectedFeeRecipient: _f, ...baseExpectation } = expectation;

    it('requires the escrow to match the ON-CHAIN EscrowConfig once it exists (env ignored)', async () => {
      const envReviewer = solanaKeypair().address; // stale env value, must not matter
      const platform = { envReviewer, envFeeRecipient: solanaKeypair().address };
      const ok = await verifySolanaEscrowTransaction({
        signature, expectation: { ...baseExpectation, platform }, adapter: mockAdapter({ config: { reviewer, feeRecipient } }), programId,
      });
      expect(ok.ok).to.equal(true);
      if (ok.ok) {
        expect(ok.platform?.source).to.equal('onchain-config');
        expect(ok.platform?.reviewer).to.equal(reviewer);
      }

      const otherReviewer = await verifySolanaEscrowTransaction({
        signature, expectation: { ...baseExpectation, platform },
        adapter: mockAdapter({ config: { reviewer: solanaKeypair().address, feeRecipient } }), programId,
      });
      expect(otherReviewer.ok).to.equal(false);
      if (!otherReviewer.ok) expect(otherReviewer.error).to.match(/on-chain config reviewer/);

      const otherFee = await verifySolanaEscrowTransaction({
        signature, expectation: { ...baseExpectation, platform },
        adapter: mockAdapter({ config: { reviewer, feeRecipient: solanaKeypair().address } }), programId,
      });
      expect(otherFee.ok).to.equal(false);
    });

    it('falls back to the env reviewer / fee recipient only while the config account does not exist', async () => {
      const ok = await verifySolanaEscrowTransaction({
        signature, expectation: { ...baseExpectation, platform: { envReviewer: reviewer, envFeeRecipient: feeRecipient } },
        adapter: mockAdapter({ config: null }), programId,
      });
      expect(ok.ok).to.equal(true);
      if (ok.ok) expect(ok.platform?.source).to.equal('env');

      const wrongEnv = await verifySolanaEscrowTransaction({
        signature, expectation: { ...baseExpectation, platform: { envReviewer: solanaKeypair().address, envFeeRecipient: feeRecipient } },
        adapter: mockAdapter({ config: null }), programId,
      });
      expect(wrongEnv.ok).to.equal(false);

      const noEnv = await verifySolanaEscrowTransaction({
        signature, expectation: { ...baseExpectation, platform: { envReviewer: null, envFeeRecipient: feeRecipient } },
        adapter: mockAdapter({ config: null }), programId,
      });
      expect(noEnv.ok).to.equal(false);
      if (!noEnv.ok) expect(noEnv.status).to.equal(503);
    });

    it('fails closed when the config cannot be read or is not owned by the escrow program', async () => {
      const platform = { envReviewer: reviewer, envFeeRecipient: feeRecipient };
      const rpc = await verifySolanaEscrowTransaction({
        signature, expectation: { ...baseExpectation, platform }, adapter: mockAdapter({ config: 'rpc_error' }), programId,
      });
      expect(rpc.ok).to.equal(false);
      if (!rpc.ok) expect(rpc.status).to.equal(503);

      const spoofed = await resolveSolanaEscrowPlatformConfig({
        adapter: mockAdapter({ config: { reviewer, feeRecipient, owner: SYSTEM_PROGRAM_ID } }), programId, envReviewer: reviewer,
      });
      expect(spoofed.ok).to.equal(false);
    });

    it('accepts a confirmed deposit whose escrow account matches the order', async () => {
      const res = await verifySolanaEscrowTransaction({ signature, expectation, adapter: mockAdapter(), programId });
      expect(res.ok).to.equal(true);
    });

    it('rejects unknown / errored / RPC-unavailable signatures', async () => {
      const unknown = await verifySolanaEscrowTransaction({ signature, expectation, adapter: mockAdapter({ status: 'missing' }), programId });
      const errored = await verifySolanaEscrowTransaction({ signature, expectation, adapter: mockAdapter({ status: 'error' }), programId });
      const down = await verifySolanaEscrowTransaction({ signature, expectation, adapter: mockAdapter({ status: 'rpc_down' }), programId });
      expect(unknown.ok).to.equal(false);
      expect(errored.ok).to.equal(false);
      expect(down.ok).to.equal(false);
      if (!down.ok) expect(down.status).to.equal(503);
      const bad = await verifySolanaEscrowTransaction({ signature: 'not-a-signature', expectation, adapter: mockAdapter(), programId });
      expect(bad.ok).to.equal(false);
    });

    it('rejects escrow state that does not match the order', async () => {
      const cases = [
        mockAdapter({ escrow: { reviewer: solanaKeypair().address } }),
        mockAdapter({ escrow: { amount: 1n } }),
        mockAdapter({ escrow: { buyer: solanaKeypair().address } }),
        mockAdapter({ escrow: { status: 3 } }),
        mockAdapter({ escrow: { deadline: 1_000 } }),
        mockAdapter({ owner: SYSTEM_PROGRAM_ID }),
        mockAdapter({ accountKeys: [buyer, vaultPda, SYSTEM_PROGRAM_ID, programId] }),
      ];
      for (const adapter of cases) {
        const res = await verifySolanaEscrowTransaction({ signature, expectation, adapter, programId });
        expect(res.ok).to.equal(false);
      }
    });
  });
});
