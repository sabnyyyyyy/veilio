import { expect } from 'chai';
import {
  VeilioSdkError,
  isVeilioSdkError,
  wrapAsVeilioError,
  withSafeReadRetry,
} from '../lib/agent-sdk';
import {
  formatLamportsToSol,
  parseSolToLamports,
  calculateSolanaServicePayouts,
} from '../lib/cross-chain/solanaServiceEscrow';
import {
  createPaymentRequest,
  createOrderFromPaymentRequest,
  getOrderById,
  getOrCreateConversation,
} from '../lib/server/servicesDb';

describe('VEILIO SDK, API, and Ecosystem Audit Verification Suite', () => {
  // ==========================================================================
  // 1. SDK Error System & Typing
  // ==========================================================================
  describe('VeilioSdkError System', () => {
    it('creates structured error with code, message, and retryable flag', () => {
      const err = new VeilioSdkError({
        code: 'CHAIN_MISMATCH',
        message: 'Connected wallet chain ID does not match target.',
        retryable: false,
        context: { targetChainId: 97, walletChainId: 1 },
      });

      expect(err).to.be.instanceOf(Error);
      expect(err).to.be.instanceOf(VeilioSdkError);
      expect(isVeilioSdkError(err)).to.be.true;
      expect(err.code).to.equal('CHAIN_MISMATCH');
      expect(err.message).to.equal('Connected wallet chain ID does not match target.');
      expect(err.retryable).to.be.false;
      expect(err.context).to.deep.equal({ targetChainId: 97, walletChainId: 1 });
    });

    it('serializes to JSON with all relevant debugging fields', () => {
      const err = new VeilioSdkError({
        code: 'INVALID_INPUT',
        message: 'Deposit amount must be greater than zero.',
        retryable: false,
      });

      const json = err.toJSON();
      expect(json.name).to.equal('VeilioSdkError');
      expect(json.code).to.equal('INVALID_INPUT');
      expect(json.message).to.equal('Deposit amount must be greater than zero.');
      expect(json.retryable).to.be.false;
    });

    it('wraps unknown errors into VeilioSdkError while preserving cause', () => {
      const nativeErr = new Error('RPC connection reset by peer');
      const wrapped = wrapAsVeilioError(nativeErr, 'RPC_ERROR', 'RPC request failed', true);

      expect(isVeilioSdkError(wrapped)).to.be.true;
      expect(wrapped.code).to.equal('RPC_ERROR');
      expect(wrapped.message).to.equal('RPC connection reset by peer');
      expect(wrapped.retryable).to.be.true;
      expect(wrapped.cause).to.equal(nativeErr);
    });

    it('idempotently returns already-wrapped VeilioSdkError', () => {
      const existing = new VeilioSdkError({
        code: 'WALLET_REQUIRED',
        message: 'Wallet client required',
      });
      const rewrapped = wrapAsVeilioError(existing);
      expect(rewrapped).to.equal(existing);
    });
  });

  // ==========================================================================
  // 2. Safe Read Retry Helper
  // ==========================================================================
  describe('Safe Read Retry with Exponential Backoff', () => {
    it('succeeds on first attempt without retrying', async () => {
      let calls = 0;
      const res = await withSafeReadRetry(async () => {
        calls++;
        return 'success';
      });
      expect(res).to.equal('success');
      expect(calls).to.equal(1);
    });

    it('retries on transient failure and recovers on subsequent attempt', async () => {
      let attempts = 0;
      const res = await withSafeReadRetry(
        async () => {
          attempts++;
          if (attempts < 2) {
            throw new Error('Transient 429 Too Many Requests');
          }
          return { blockNumber: 12345 };
        },
        { maxAttempts: 3, initialDelayMs: 10, backoffFactor: 1.5 }
      );

      expect(res).to.deep.equal({ blockNumber: 12345 });
      expect(attempts).to.equal(2);
    });

    it('stops and rethrows after reaching maxAttempts', async () => {
      let attempts = 0;
      try {
        await withSafeReadRetry(
          async () => {
            attempts++;
            throw new Error('Persistent RPC failure');
          },
          { maxAttempts: 3, initialDelayMs: 5, backoffFactor: 1.2 }
        );
        expect.fail('Should have thrown error');
      } catch (err: any) {
        expect(err.message).to.equal('Persistent RPC failure');
        expect(attempts).to.equal(3);
      }
    });
  });

  // ==========================================================================
  // 3. Lossless Solana Integer Conversions
  // ==========================================================================
  describe('Lossless Solana Lamports & SOL Conversion', () => {
    it('converts exact integers without floating-point inaccuracies', () => {
      expect(formatLamportsToSol(1_000_000_000n)).to.equal('1');
      expect(formatLamportsToSol(500_000_000n)).to.equal('0.5');
      expect(formatLamportsToSol(1n)).to.equal('0.000000001');
      expect(formatLamportsToSol(1234567890123456789n)).to.equal('1234567890.123456789');
    });

    it('parses SOL strings to bigint lamports without floating-point rounding', () => {
      expect(parseSolToLamports('1')).to.equal(1_000_000_000n);
      expect(parseSolToLamports('0.5')).to.equal(500_000_000n);
      expect(parseSolToLamports('0.000000001')).to.equal(1n);
      expect(parseSolToLamports('1234567890.123456789')).to.equal(1234567890123456789n);
    });

    it('rejects invalid or oversized SOL amount strings', () => {
      expect(() => parseSolToLamports('abc')).to.throw(/Invalid SOL amount string/);
      expect(() => parseSolToLamports('0.12345678901')).to.throw(/more than 9 decimal places/);
    });

    it('strictly preserves 500 bps platform fee and 100% fee-free buyer refund in payouts', () => {
      const payouts = calculateSolanaServicePayouts(100_000_000_000n, 50, 500); // 100 SOL, 50% split, 5% fee
      expect(payouts.buyerRefundLamports).to.equal(50_000_000_000n); // 50 SOL (fee-free)
      expect(payouts.sellerGrossLamports).to.equal(50_000_000_000n); // 50 SOL
      expect(payouts.platformFeeLamports).to.equal(2_500_000_000n);  // 2.5 SOL (5% of 50 SOL)
      expect(payouts.sellerNetPayoutLamports).to.equal(47_500_000_000n); // 47.5 SOL
    });
  });

  // ==========================================================================
  // 4. Order Metadata Retrieval
  // ==========================================================================
  describe('Order Metadata Inspection', () => {
    it('returns null for nonexistent order', () => {
      const nonexistent = getOrderById('nonexistent-id');
      expect(nonexistent).to.be.null;
    });

    it('retrieves public order metadata and preserves correct status', () => {
      const buyer = '0x1111111111111111111111111111111111111111';
      const seller = '0x2222222222222222222222222222222222222222';
      const conv = getOrCreateConversation(buyer, seller, 'srv-audit-1', 'Audit service deliverable');
      const pr = createPaymentRequest({
        conversationId: conv.id,
        serviceId: 'srv-audit-1',
        buyerId: buyer,
        sellerId: seller,
        description: 'Audit service deliverable',
        scope: 'Audit scope',
        agreedPrice: '0.5',
        currency: 'BNB',
        deadline: Math.floor(Date.now() / 1000) + 86400,
        revisionTerms: '1 revision',
        escrowContract: '0x0000000000000000000000000000000000000000',
        network: 'bnb:97',
        expiresAt: Date.now() + 86400 * 1000, // milliseconds, same unit as app/api/payment-requests
      });

      const order = createOrderFromPaymentRequest(pr.id, buyer);

      const found = getOrderById(order.id);
      expect(found).to.not.be.null;
      expect(found!.id).to.equal(order.id);
      expect(found!.priceSnapshot).to.equal('0.5');
      expect(found!.currency).to.equal('BNB');
      expect(found!.status).to.equal('AwaitingPayment');
      expect(found!.buyerId.toLowerCase()).to.equal(buyer.toLowerCase());
    });
  });
});
