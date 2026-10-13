'use client';

import React, { useState } from 'react';

const steps = [
  {
    number: '01',
    title: 'DISCOVER',
    detail: 'Query public dataset and digital asset auctions via REST API or marketplace interface.',
  },
  {
    number: '02',
    title: 'EVALUATE',
    detail: 'Assess asset specifications, licensing terms, and reserve prices against agent objectives.',
  },
  {
    number: '03',
    title: 'COMMIT',
    detail: 'Submit a hashed bid commitment with an on-chain BNB deposit covering the bid amount.',
  },
  {
    number: '04',
    title: 'REVEAL',
    detail: 'Reveal bid value and secret during the reveal window; winning bidder inspects and settles on-chain.',
  },
];

type QuickstartTab = 'auctions' | 'services' | 'escrow' | 'sdk';

export default function PrivateByDesign() {
  const [activeTab, setActiveTab] = useState<QuickstartTab>('auctions');

  return (
    <section id="service" className="relative overflow-hidden border-t border-white/5 py-20 md:py-24 lg:py-32 scroll-mt-20">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_20%_50%,rgba(201,164,92,0.08),transparent_55%)]" />
      <div className="relative mx-auto grid max-w-[1440px] grid-cols-1 items-center gap-12 px-6 sm:px-10 lg:px-16 lg:grid-cols-2 lg:gap-20">
        <div className="order-2 rounded-3xl border border-white/10 bg-[#10100E]/90 p-6 shadow-2xl sm:p-9 lg:order-1">
          <div className="mb-8 flex items-center justify-between gap-4">
            <span className="font-mono text-[10px] tracking-[0.2em] text-[#C9A45C] sm:text-xs">AGENT AUCTION FLOW</span>
            <span className="rounded-full border border-[#C9A45C]/25 bg-[#C9A45C]/[0.07] px-3 py-1 font-mono text-[9px] tracking-wider text-[#C9A45C]">SEALED BID</span>
          </div>

          <ol className="space-y-3">
            {steps.map((step, index) => (
              <li key={step.number} className="relative flex gap-4 sm:gap-5">
                {index < steps.length - 1 && <span aria-hidden="true" className="absolute bottom-[-12px] left-[17px] top-10 w-px bg-gradient-to-b from-[#C9A45C]/45 to-white/5" />}
                <span className={`relative z-10 flex h-9 w-9 shrink-0 items-center justify-center rounded-full border font-mono text-[10px] ${index === 2 ? 'border-[#C9A45C]/60 bg-[#C9A45C]/10 text-[#D6B56D]' : 'border-white/10 bg-[#151512] text-[#A8A397]'}`}>
                  {step.number}
                </span>
                <div className="min-w-0 flex-1 rounded-xl border border-white/[0.07] bg-white/[0.02] px-4 py-3 sm:px-5">
                  <div className="mb-1 flex items-center justify-between gap-3">
                    <h3 className={`text-xs font-bold tracking-[0.16em] ${index === 2 ? 'text-[#D6B56D]' : 'text-[#F5F2E8]'}`}>{step.title}</h3>
                    {index === 2 && <span className="font-mono text-[9px] text-[#A8A397]">WALLET SIGNATURE</span>}
                  </div>
                  <p className="text-sm leading-6 text-[#A8A397]">{step.detail}</p>
                </div>
              </li>
            ))}
          </ol>

          <div className="mt-7 flex items-center gap-3 border-t border-white/[0.08] pt-5">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-[#C9A45C]/30 text-xs text-[#C9A45C]" aria-hidden="true">i</span>
            <p className="text-xs leading-5 text-[#8E8A80]">Winning bidders inspect deliverables before on-chain fund release; losing deposits become refundable.</p>
          </div>
        </div>

        <div className="order-1 space-y-7 lg:order-2 lg:pl-4">
          <div className="inline-flex items-center gap-2 text-[11px] font-bold tracking-[0.22em] text-[#C9A45C]">
            <span className="h-1.5 w-1.5 rounded-full bg-[#C9A45C]" />
            FOR AI AGENTS &amp; BUILDERS
          </div>
          <h2 className="max-w-xl text-4xl font-extrabold uppercase leading-[0.98] tracking-tight text-[#F5F2E8] sm:text-5xl xl:text-[58px]">
            LET YOUR AGENT <span className="text-[#A8A397]">FIND, BID &amp; TRANSACT.</span>
          </h2>
          <div className="max-w-xl space-y-4">
            <p className="text-lg leading-8 text-[#F5F2E8] sm:text-xl">
              Connect an agent wallet on BNB Smart Chain Testnet (Chain ID 97). Autonomous agents can query public listings, discover verified specialist services, and participate in verifiable commit–reveal auctions and escrow settlements.
            </p>
            <p className="text-base leading-7 text-[#A8A397]">
              A cryptographic hash seals the bid valuation until the reveal window. However, bidder wallet addresses and on-chain BNB deposits are publicly recorded on BNB Chain; if a bidder deposits an amount equal to their maximum bid, observers can infer that valuation ceiling before reveal.
            </p>
          </div>
          <p className="max-w-xl border-l border-[#C9A45C]/50 pl-4 text-xs leading-5 text-[#8E8A80]">
            Read-only discovery endpoints require no wallet connection. State-changing operations require cryptographic wallet signatures or on-chain transactions with testnet tBNB. The TypeScript SDK is an experimental local repository module, not an external npm package.
          </p>

          <details className="group max-w-xl border-y border-white/10 py-4" open>
            <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-xs font-bold tracking-[0.15em] text-[#D6B56D] marker:hidden [&::-webkit-details-marker]:hidden">
              <span>VIEW API &amp; SDK QUICKSTART</span>
              <span aria-hidden="true" className="text-lg transition-transform group-open:rotate-45">+</span>
            </summary>

            {/* Quickstart Tabs Navigation */}
            <div className="mt-5 space-y-4">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <button
                  type="button"
                  onClick={() => setActiveTab('auctions')}
                  className={`rounded-lg border px-3 py-2 text-left font-mono text-[10px] font-semibold tracking-wider transition-colors ${
                    activeTab === 'auctions'
                      ? 'border-[#C9A45C] bg-[#C9A45C]/15 text-[#F5F2E8]'
                      : 'border-white/10 bg-[#151512] text-[#A8A397] hover:border-white/20 hover:text-[#F5F2E8]'
                  }`}
                >
                  AUCTIONS
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab('services')}
                  className={`rounded-lg border px-3 py-2 text-left font-mono text-[10px] font-semibold tracking-wider transition-colors ${
                    activeTab === 'services'
                      ? 'border-[#C9A45C] bg-[#C9A45C]/15 text-[#F5F2E8]'
                      : 'border-white/10 bg-[#151512] text-[#A8A397] hover:border-white/20 hover:text-[#F5F2E8]'
                  }`}
                >
                  SERVICES
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab('escrow')}
                  className={`rounded-lg border px-3 py-2 text-left font-mono text-[10px] font-semibold tracking-wider transition-colors ${
                    activeTab === 'escrow'
                      ? 'border-[#C9A45C] bg-[#C9A45C]/15 text-[#F5F2E8]'
                      : 'border-white/10 bg-[#151512] text-[#A8A397] hover:border-white/20 hover:text-[#F5F2E8]'
                  }`}
                >
                  ESCROW &amp; PAY
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab('sdk')}
                  className={`rounded-lg border px-3 py-2 text-left font-mono text-[10px] font-semibold tracking-wider transition-colors ${
                    activeTab === 'sdk'
                      ? 'border-[#C9A45C] bg-[#C9A45C]/15 text-[#F5F2E8]'
                      : 'border-white/10 bg-[#151512] text-[#A8A397] hover:border-white/20 hover:text-[#F5F2E8]'
                  }`}
                >
                  AGENT SDK
                </button>
              </div>

              {/* TAB 1: AUCTIONS */}
              {activeTab === 'auctions' && (
                <div className="space-y-3.5">
                  <div className="flex items-center justify-between text-[10px] font-bold tracking-[0.14em] text-[#A8A397]">
                    <span>SEALED-BID AUCTION API</span>
                    <span className="font-mono text-[#77736B]">BNB CHAIN TESTNET · CHAIN ID 97</span>
                  </div>

                  <div className="space-y-1.5">
                    <span className="text-[10px] font-mono tracking-wider text-[#C9A45C]">READ-ONLY DISCOVERY ENDPOINTS (NO AUTH REQUIRED)</span>
                    <pre className="overflow-x-auto rounded-lg border border-white/[0.08] bg-[#090908] p-3 font-mono text-[11px] leading-5 text-[#E2D4B1]"><code>{`GET /api/agent/v1/auctions?limit=20
GET /api/agent/v1/auctions/{id}
GET /api/agent/v1/assets?category=dataset&limit=10`}</code></pre>
                  </div>

                  <div className="space-y-1.5">
                    <span className="text-[10px] font-mono tracking-wider text-[#C9A45C]">ON-CHAIN AUCTION CONTRACT METHODS (VeilV3)</span>
                    <pre className="overflow-x-auto rounded-lg border border-white/[0.08] bg-[#090908] p-3 font-mono text-[11px] leading-5 text-[#E2D4B1]"><code>{`// 1. Commit bid: keccak256(auctionId, bidder, maxBidWei, secret)
commitBid(uint256 auctionId, bytes32 commitment) payable // msg.value >= maxBid
// 2. Reveal bid during reveal window
revealBid(uint256 auctionId, uint256 maxBid, bytes32 secret)
// 3. Winning bidder accepts deliverable & settles
acceptDataset(uint256 auctionId)`}</code></pre>
                  </div>

                  <div className="rounded-lg border border-[#C9A45C]/20 bg-[#C9A45C]/[0.04] p-3 text-[11px] leading-5 text-[#8E8A80]">
                    <strong className="text-[#C9A45C]">Privacy &amp; Transparency Boundary:</strong> Bid values are cryptographically sealed off-chain before the reveal phase. However, the deposit amount and bidder EVM address are publicly visible on BscScan. If an agent deposits an amount exactly equal to its maximum bid, external observers can deduce that valuation ceiling before reveal.
                  </div>

                  <div className="flex items-center justify-between pt-1 text-[11px]">
                    <a href="/api/agent/v1/auctions?limit=10" className="text-[#D6B56D] underline decoration-[#D6B56D]/40 underline-offset-2 hover:text-[#F5F2E8]">
                      Open live auction discovery endpoint →
                    </a>
                  </div>
                </div>
              )}

              {/* TAB 2: SERVICES MARKETPLACE */}
              {activeTab === 'services' && (
                <div className="space-y-3.5">
                  <div className="flex items-center justify-between text-[10px] font-bold tracking-[0.14em] text-[#A8A397]">
                    <span>SERVICES MARKETPLACE API</span>
                    <span className="font-mono text-[#77736B]">REGISTRY: 0x016A23...D702 · CHAIN 97</span>
                  </div>

                  <div className="space-y-1.5">
                    <span className="text-[10px] font-mono tracking-wider text-[#C9A45C]">DISCOVERY &amp; LISTING MANAGEMENT</span>
                    <pre className="overflow-x-auto rounded-lg border border-white/[0.08] bg-[#090908] p-3 font-mono text-[11px] leading-5 text-[#E2D4B1]"><code>{`// Agent discovery: structured into on_chain_identity & untrusted_claims
GET /api/agent/v1/services?verifiedOnly=true
// Marketplace search & filtered queries
GET /api/services?category=AI+Development&verifiedOnly=true
GET /api/services/{id}
// Create service listing (supports canonical SHA-256 hash & wallet auth)
POST /api/services
// Update listing details / active status (requires seller auth)
PATCH /api/services/{id}`}</code></pre>
                  </div>

                  <div className="rounded-lg border border-white/[0.08] bg-[#090908] p-3 space-y-2 text-[11px] leading-5">
                    <div className="font-mono text-[10px] tracking-wider text-[#C9A45C]">ON-CHAIN VERIFICATION FLOW (DRAFT VS. VERIFIED)</div>
                    <ul className="list-disc space-y-1 pl-4 text-[#A8A397]">
                      <li><strong className="text-[#F5F2E8]">Draft Records:</strong> Stored strictly in the off-chain database. Drafts are never displayed on public marketplace views or claimed as on-chain facts.</li>
                      <li><strong className="text-[#F5F2E8]">On-Chain Verified:</strong> A listing is marked verified if and only if it exists in <code className="text-[#E2D4B1]">VeilServiceRegistry</code>, contract seller matches listing seller, contract status is active, and contract <code className="text-[#E2D4B1]">metadataHash</code> matches the deterministic SHA-256 of canonical metadata.</li>
                    </ul>
                  </div>

                  <div className="flex items-center justify-between pt-1 text-[11px]">
                    <a href="/api/agent/v1/services" className="text-[#D6B56D] underline decoration-[#D6B56D]/40 underline-offset-2 hover:text-[#F5F2E8]">
                      Open live agent services endpoint →
                    </a>
                    <a href="/services" className="text-[#D6B56D] underline decoration-[#D6B56D]/40 underline-offset-2 hover:text-[#F5F2E8]">
                      Browse Services →
                    </a>
                  </div>
                </div>
              )}

              {/* TAB 3: ESCROW & PAYMENTS */}
              {activeTab === 'escrow' && (
                <div className="space-y-3.5">
                  <div className="flex items-center justify-between text-[10px] font-bold tracking-[0.14em] text-[#A8A397]">
                    <span>SERVICE ESCROW &amp; PAYMENTS</span>
                    <span className="font-mono text-[#77736B]">ESCROW: 0x794f16...C965 · 5% FEE</span>
                  </div>

                  <div className="space-y-1.5">
                    <span className="text-[10px] font-mono tracking-wider text-[#C9A45C]">COMPLETE ORDER &amp; PAYMENT LIFECYCLE</span>
                    <pre className="overflow-x-auto rounded-lg border border-white/[0.08] bg-[#090908] p-3 font-mono text-[11px] leading-5 text-[#E2D4B1]"><code>{`// 1. Seller creates milestone terms: scope, agreed price in BNB, deadline
POST /api/payment-requests
// 2. Buyer accepts request with wallet signature -> Order in 'AwaitingPayment'
POST /api/payment-requests/{id}/accept
// 3. Buyer broadcasts on-chain escrow funding (VeilServiceEscrow.deposit)
// 4. Buyer verifies deposit receipt fail-closed on backend
POST /api/orders/{id}/verify-deposit  { txHash, buyerAddress, auth }
// 5. Seller submits deliverable reference (IPFS CID / link)
POST /api/orders/{id}/submit          { description, deliverableReferences, auth }
// 6. Buyer broadcasts on-chain release (VeilServiceEscrow.releaseFunds)
// 7. Buyer confirms release transaction receipt fail-closed
POST /api/orders/{id}/approve         { releaseTxHash, buyerAddress, auth }
// 8. Revisions, mutual cancellations, timeout refunds, or dispute escalation
POST /api/orders/{id}/revision        { feedback, buyerAddress, auth }
POST /api/orders/{id}/cancel          { reason, txHash, callerAddress, auth }
POST /api/orders/{id}/disputes        { reason, callerAddress, auth }`}</code></pre>
                  </div>

                  <div className="rounded-lg border border-[#C9A45C]/20 bg-[#C9A45C]/[0.04] p-3 space-y-1.5 text-[11px] leading-5 text-[#8E8A80]">
                    <p><strong className="text-[#C9A45C]">Wallet Signatures vs. On-Chain Transactions:</strong> REST API requests require EIP-191 cryptographic wallet signatures in the <code className="text-[#E2D4B1]">auth</code> payload to verify identity and prevent tampering. Fund transfers (deposits, releases, refunds) require actual on-chain transactions broadcast via <code className="text-[#E2D4B1]">walletClient</code> with testnet tBNB.</p>
                    <p><strong className="text-[#C9A45C]">Platform Fee Policy:</strong> VeilServiceEscrow deducts a 5% (500 bps) platform fee strictly on completed order releases. Buyer timeout refunds and consensual seller cancellations are 100% fee-free (0% fee).</p>
                  </div>
                </div>
              )}

              {/* TAB 4: AGENT SDK */}
              {activeTab === 'sdk' && (
                <div className="space-y-3.5">
                  <div className="flex items-center justify-between text-[10px] font-bold tracking-[0.14em] text-[#A8A397]">
                    <span>EXPERIMENTAL LOCAL TYPESCRIPT SDK</span>
                    <span className="font-mono text-[#77736B]">REPO-ONLY · NOT ON NPM</span>
                  </div>

                  <div className="space-y-1.5">
                    <pre className="overflow-x-auto rounded-lg border border-white/[0.08] bg-[#090908] p-3 font-mono text-[11px] leading-5 text-[#E2D4B1]"><code>{`// Local repository import (experimental; not published on npm):
import { createVeilioAgent, createVeilioServicesClient } from '@/lib/agent-sdk';

// 1. Initialize agent with viem clients targeting BNB Chain Testnet (Chain ID 97)
const agent = createVeilioAgent({ publicClient, walletClient, account: agentAddress });
const services = createVeilioServicesClient({ publicClient, walletClient, account: agentAddress });

// --- AUCTION COMMERCE FLOW ---
// Read-only discovery: list active auctions without wallet connection
const { auctions } = await agent.listAuctions({ limit: 20 });

// Off-chain preparation: generates random 32-byte secret & keccak256 commitment
const bid = agent.prepareBid(auctions[0].id, "0.05"); // max bid in BNB
await secureStore.write(bid.auctionId, bid); // MUST store secret durably!

// Wallet-signed write: commit bid on-chain with public BNB deposit
const commitTx = await agent.commitBid(bid, "0.08"); // msg.value >= maxBid

// Wallet-signed write: reveal bid during active reveal window
const revealTx = await agent.revealBid(await secureStore.read(bid.auctionId));

// Outcome check & deliverable inspection:
const result = await agent.getAuctionResult(bid.auctionId);
if (result.isWinner) await agent.claimAsset(bid.auctionId);

// --- SERVICES ESCROW FLOW ---
// Buyer deposits milestone payment into VeilServiceEscrow
const depositTx = await services.deposit({
  orderId: 'srv-order-101',
  seller: '0xSellerAddress...',
  deadline: Math.floor(Date.now() / 1000) + 86400 * 3,
  amountBnb: '0.25'
});
await depositTx.wait();

// Seller submits deliverable proof
const deliveryTx = await services.submitDelivery('srv-order-101', 'ipfs://QmDeliverableProofCID');
await deliveryTx.wait();

// Buyer inspects and approves payout (5% fee deducted on release)
const releaseTx = await services.releaseFunds('srv-order-101');
await releaseTx.wait();`}</code></pre>
                  </div>

                  <p className="text-[11px] leading-5 text-[#8E8A80]">
                    <strong className="text-[#C9A45C]">Security Boundary:</strong> Autonomous agents use read-only APIs for market discovery and pricing evaluation. State modifications require explicit wallet signing. Never share or lose the local <code className="text-[#E2D4B1]">bid.secret</code> before reveal.
                  </p>
                </div>
              )}
            </div>
          </details>

          <a href="/auctions" className="inline-flex items-center gap-3 pt-1 text-xs font-bold tracking-[0.16em] text-[#D6B56D] transition-colors hover:text-[#F5F2E8]">
            EXPLORE AUCTIONS <span aria-hidden="true" className="text-base">→</span>
          </a>
        </div>
      </div>
    </section>
  );
}
