import React from 'react';

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

export default function PrivateByDesign() {
  return (
    <section className="relative overflow-hidden border-t border-white/5 py-20 md:py-24 lg:py-32">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_20%_50%,rgba(201,164,92,0.08),transparent_55%)]" />
      <div className="relative mx-auto grid max-w-7xl grid-cols-1 items-center gap-12 px-6 lg:grid-cols-2 lg:gap-20">
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
            FOR AI AGENTS
          </div>
          <h2 className="max-w-xl text-4xl font-extrabold uppercase leading-[0.98] tracking-tight text-[#F5F2E8] sm:text-5xl xl:text-[58px]">
            LET YOUR AGENT <span className="text-[#A8A397]">FIND AND BID.</span>
          </h2>
          <div className="max-w-xl space-y-4">
            <p className="text-lg leading-8 text-[#F5F2E8] sm:text-xl">
              Connect an agent wallet on BNB Smart Chain Testnet (Chain ID 97). Autonomous agents can query public listings, evaluate data assets, and participate in verifiable commit–reveal auctions.
            </p>
            <p className="text-base leading-7 text-[#A8A397]">
              A cryptographic hash seals the bid valuation until the reveal window. However, bidder wallet addresses and on-chain BNB deposits are publicly recorded on BNB Chain; if a bidder deposits an amount equal to their maximum bid, observers can infer that valuation ceiling before reveal.
            </p>
          </div>
          <p className="max-w-xl border-l border-[#C9A45C]/50 pl-4 text-xs leading-5 text-[#8E8A80]">
            Read-only discovery endpoints require no wallet connection. The experimental TypeScript SDK in this repository provides typed client helpers for wallet-signed transactions; it is not published as an external npm package.
          </p>
          <details className="group max-w-xl border-y border-white/10 py-4">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-xs font-bold tracking-[0.15em] text-[#D6B56D] marker:hidden [&::-webkit-details-marker]:hidden">
              VIEW API &amp; SDK QUICKSTART
              <span aria-hidden="true" className="text-lg transition-transform group-open:rotate-45">+</span>
            </summary>
            <div className="mt-5 space-y-4">
              <div>
                <div className="mb-2 flex items-center justify-between text-[10px] font-bold tracking-[0.14em] text-[#A8A397]">
                  <span>READ AUCTIONS | REST API</span><span className="font-mono text-[#77736B]">BNB CHAIN TESTNET | CHAIN 97</span>
                </div>
                <pre className="overflow-x-auto rounded-lg border border-white/[0.08] bg-[#090908] p-3 font-mono text-[11px] leading-5 text-[#E2D4B1]"><code>GET https://veilio.fun/api/agent/v1/auctions?limit=20{'\n'}GET https://veilio.fun/api/agent/v1/auctions/&#123;id&#125;</code></pre>
              </div>
              <div>
                <div className="mb-2 text-[10px] font-bold tracking-[0.14em] text-[#A8A397]">EXPERIMENTAL LOCAL TYPESCRIPT SDK · REPO-ONLY (NOT ON NPM)</div>
                <pre className="overflow-x-auto rounded-lg border border-white/[0.08] bg-[#090908] p-3 font-mono text-[11px] leading-5 text-[#E2D4B1]"><code>{`// Local import from repository (experimental; not published on npm):
import { createVeilioAgent } from '@/lib/agent-sdk';

// Initialize with viem clients targeting BNB Chain Testnet (Chain ID 97)
const agent = createVeilioAgent({ publicClient, walletClient, account: agentAddress });

// 1. Read-only discovery (REST or RPC):
const { auctions } = await agent.listAuctions({ limit: 20 });

// 2. Off-chain preparation (generates random secret & keccak256 commitment):
const bid = agent.prepareBid(auctionId, "0.05"); // max bid in BNB
await secureStore.write(bid.auctionId, bid); // save secret securely (required for reveal)

// 3. Wallet-signed write: commit bid on-chain with deposit covering max bid
const commitTx = await agent.commitBid(bid, "0.08"); // BNB deposit sent with tx

// 4. Wallet-signed write: reveal bid during active reveal window
const revealTx = await agent.revealBid(await secureStore.read(bid.auctionId));`}</code></pre>
              </div>
              <p className="text-[11px] leading-5 text-[#8E8A80]">
                <strong className="text-[#C9A45C]">Privacy &amp; Security Note:</strong> Sealed-bid privacy relies on keeping the local <code>bid.secret</code> confidential until the reveal phase. On-chain deposits and bidder addresses are visible on BscScan. If <code>depositAmount</code> equals the maximum bid, observers can infer valuation bounds before reveal. The local SDK is experimental and not published to npm. Store <code>bid.secret</code> in durable, encrypted storage—lost secrets prevent bid reveals. <a href="/api/agent/v1/auctions?limit=10" className="text-[#D6B56D] underline decoration-[#D6B56D]/40 underline-offset-2 hover:text-[#F5F2E8]">Open live auction endpoint</a>.
              </p>
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
