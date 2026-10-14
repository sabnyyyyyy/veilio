import { expect } from 'chai';
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts';
import {
  sanitizeChatText,
  impersonatesSystemNotice,
  MAX_CHAT_MESSAGE_LENGTH,
} from '../lib/server/chatSafety';
import {
  addServiceMessage,
  createPaymentRequest,
  getConversationMessages,
  getOrCreateConversation,
} from '../lib/server/servicesDb';
import { createServiceAuthMessage, LEGACY_SERVICE_AUTH_PURPOSE, generateAuthNonce } from '../lib/serviceAuth';
import { verifyServiceAuth } from '../lib/server/serviceAuth';

describe('Chat safety', () => {
  describe('sanitizeChatText', () => {
    it('strips bidi overrides, zero-width and control characters', () => {
      expect(sanitizeChatText('Pay 1‮01 BNB​\u0007')).to.equal('Pay 101 BNB');
    });

    it('trims and caps the length', () => {
      expect(sanitizeChatText('  hi  ')).to.equal('hi');
      expect(sanitizeChatText('x'.repeat(MAX_CHAT_MESSAGE_LENGTH + 50))).to.have.length(MAX_CHAT_MESSAGE_LENGTH);
    });
  });

  describe('impersonatesSystemNotice', () => {
    it('flags text shaped like a VEILIO notice', () => {
      expect(impersonatesSystemNotice('[ESCROW FUNDED ON BNB CHAIN TESTNET] Buyer deposited 1 BNB')).to.equal(true);
      expect(impersonatesSystemNotice('  [PRICE REDUCED] refunded')).to.equal(true);
      expect(impersonatesSystemNotice('[DISPUTE RESOLVED & SETTLED] done')).to.equal(true);
    });

    it('allows ordinary messages', () => {
      expect(impersonatesSystemNotice('Hi, can you deliver [CSV] and parquet?')).to.equal(false);
      expect(impersonatesSystemNotice('[sic] lowercase brackets are fine')).to.equal(false);
      expect(impersonatesSystemNotice('Price ok')).to.equal(false);
    });
  });

  describe('system flag on service messages', () => {
    const buyer = privateKeyToAccount(generatePrivateKey()).address;
    const seller = privateKeyToAccount(generatePrivateKey()).address;

    it('marks user-typed messages as non-system and server notices as system', () => {
      const conv = getOrCreateConversation(buyer, seller, `srv-chat-safety-${Date.now()}`, 'Chat safety');
      const typed = addServiceMessage({ conversationId: conv.id, senderId: buyer, senderType: 'human', content: 'hello' });
      expect(typed.system).to.equal(false);

      createPaymentRequest({
        conversationId: conv.id,
        serviceId: conv.serviceId,
        buyerId: buyer,
        sellerId: seller,
        description: 'Agreed work',
        scope: 'Agreed work',
        agreedPrice: '0.01',
        currency: 'BNB',
        deadline: Date.now() + 3 * 24 * 3600 * 1000,
        revisionTerms: '1 revision',
        escrowContract: '0x0000000000000000000000000000000000000001',
        network: 'bnb:97',
        expiresAt: Date.now() + 2 * 24 * 3600 * 1000,
      } as any);

      const notice = getConversationMessages(conv.id).find((m) => m.content.startsWith('[PAYMENT REQUEST]'));
      expect(notice?.system).to.equal(true);
    });
  });

  describe('auth message wording', () => {
    it('accepts the current and the legacy purpose line, rejects edits', async () => {
      const account = privateKeyToAccount(generatePrivateKey());
      const sign = async (purpose?: string, tamper = false) => {
        const input = { action: 'cancel', orderId: 'ord-chat-safety', address: account.address, timestamp: Date.now(), nonce: generateAuthNonce() };
        let message = createServiceAuthMessage(input, purpose);
        if (tamper) message = message.replace('costs no gas', 'costs gas');
        const signature = await account.signMessage({ message });
        return verifyServiceAuth({
          action: 'cancel',
          orderId: 'ord-chat-safety',
          expectedAddress: account.address,
          auth: { address: account.address, signature, timestamp: input.timestamp, nonce: input.nonce },
        });
      };

      expect((await sign()).valid).to.equal(true);
      expect((await sign(LEGACY_SERVICE_AUTH_PURPOSE)).valid).to.equal(true);
      expect((await sign(undefined, true)).valid).to.equal(false);
    });
  });
});
