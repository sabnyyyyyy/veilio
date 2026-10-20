import assert from 'node:assert/strict';
import { createVeilioAgentTools } from '../dist/index.js';

const calls = [];
const saved = new Map();
let approveWrites = true;
let nextRef = 1;
const operations = Object.fromEntries([
  'listAuctions', 'getAuction', 'listServices', 'startServiceConversation', 'sendServiceMessage',
  'prepareBid', 'commitBid', 'revealBid', 'settleAuction', 'getAuctionResult', 'claimAuctionAsset', 'disputeAuctionAsset', 'withdrawAuctionRefund',
  'getServiceOrder', 'fundServiceOrder', 'submitServiceDelivery', 'releaseServiceFunds',
  'refundServiceOrder', 'disputeServiceOrder',
].map((name) => [name, async (input) => {
  calls.push({ name, input });
  if (name === 'prepareBid') return { bid: { auctionId: input.auctionId, secret: 'secret-only-in-vault' }, commitment: 'commitment-public' };
  return { ok: true, name };
}]));

const toolset = createVeilioAgentTools({
  network: 'base-sepolia',
  walletAddress: '0xBuyer',
  operations,
  bidVault: {
    async save(input) { const ref = `bid-${nextRef++}`; saved.set(ref, input); return ref; },
    async load(input) { const entry = saved.get(input.bidRef); return entry?.wallet === input.wallet && entry?.network === input.network && entry?.auctionId === input.auctionId ? entry.bid : null; },
    async remove(input) { saved.delete(input.bidRef); },
  },
  async confirmWrite(request) { calls.push({ name: 'confirmWrite', input: request }); return approveWrites; },
});

assert.ok(toolset.tools.length >= 15, 'expected bidder and buyer tools to be registered');
assert.equal(toolset.openAIFunctions.length, toolset.tools.length);
assert.equal(toolset.openAIFunctions[0].type, 'function');

await toolset.execute('veilio_list_auctions', { network: 'base-sepolia', limit: 5 });
assert.equal(calls.at(-1).input.network, 'base-sepolia');

const prepared = await toolset.execute('veilio_prepare_bid', { auctionId: '17', maxBid: '0.25' });
assert.equal(prepared.bidRef, 'bid-1');
assert.equal(prepared.commitment, 'commitment-public');
assert.equal(JSON.stringify(prepared).includes('secret-only-in-vault'), false, 'bid secret must not be returned to the model');

await toolset.execute('veilio_commit_bid', { auctionId: '17', bidRef: prepared.bidRef, deposit: '0.3' });
assert.deepEqual(calls.find((call) => call.name === 'commitBid').input.bid, { auctionId: '17', secret: 'secret-only-in-vault' });
assert.ok(calls.some((call) => call.name === 'confirmWrite' && call.input.action === 'commit_bid'));
await toolset.execute('veilio_get_auction_result', { auctionId: '17' });
assert.equal(calls.at(-1).name, 'getAuctionResult');

approveWrites = false;
const beforeDenied = calls.filter((call) => call.name === 'sendServiceMessage').length;
const denied = await toolset.execute('veilio_send_service_message', { conversationId: 'conv-1', content: 'hello' });
assert.equal(denied.status, 'approval_denied');
assert.equal(calls.filter((call) => call.name === 'sendServiceMessage').length, beforeDenied, 'denied writes must not execute');

await assert.rejects(toolset.execute('veilio_list_services', { network: 'bnb-testnet' }), /configured for base-sepolia/);
await assert.rejects(toolset.execute('veilio_fund_service_order', { orderId: 'order-1', seller: 'seller', amount: '1', deadline: Math.floor(Date.now() / 1000) - 10 }), /future Unix timestamp/);
await assert.rejects(toolset.execute('not_a_veilio_tool', {}), /Unknown VEILIO tool/);

console.log(`veilio-agent-tools smoke tests passed (${toolset.tools.length} tools).`);
