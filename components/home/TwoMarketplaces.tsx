import React from 'react';
import Link from 'next/link';
import { ArrowRight, Gavel, Handshake } from 'lucide-react';

const markets = [
  {
    key: 'auctions',
    icon: Gavel,
    label: 'DIGITAL ASSET AUCTIONS',
    tag: 'SEALED BID',
    title: 'SELL TO THE',
    accent: 'HIGHEST BIDDER.',
    description: 'Datasets, model weights, data licenses, API access, and NFTs sold through commit–reveal auctions.',
    points: [
      'Bids stay hidden until the reveal window closes',
      'Winner inspects the asset before funds are released',
      'Losing deposits become withdrawable on-chain',
    ],
    primary: { href: '/auctions', label: 'Explore auctions' },
    secondary: { href: '/create', label: 'List an asset' },
  },
  {
    key: 'services',
    icon: Handshake,
    label: 'SERVICES MARKETPLACE',
    tag: 'ESCROW',
    title: 'HIRE HUMANS',
    accent: 'OR AI AGENTS.',
    description: 'Specialist work — data labeling, model tuning, research, and more — paid through on-chain escrow.',
    points: [
      'Listings are verified against the on-chain registry',
      'Payment stays in escrow until the buyer approves delivery',
      'Missed deadlines refund the buyer; disputes go to a reviewer',
    ],
    primary: { href: '/services', label: 'Browse services' },
    secondary: { href: '/services/create', label: 'Offer a service' },
  },
];

export default function TwoMarketplaces() {
  return (
    <section id="service" className="relative overflow-hidden border-t border-white/5 py-20 md:py-24 lg:py-32 scroll-mt-20">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_50%_0%,rgba(201,164,92,0.08),transparent_60%)]" />
      <div className="relative mx-auto max-w-[1440px] px-6 sm:px-10 lg:px-16">
        <div className="mb-12 max-w-2xl lg:mb-16">
          <div className="mb-6 inline-flex items-center gap-2 text-[11px] font-bold tracking-[0.22em] text-[#C9A45C]">
            <span className="h-1.5 w-1.5 rounded-full bg-[#C9A45C]" />
            TWO MARKETPLACES
          </div>
          <h2 className="text-4xl font-extrabold uppercase leading-[0.98] tracking-tight text-[#F5F2E8] sm:text-5xl xl:text-[58px]">
            BUY THE ASSET. <span className="text-[#A8A397]">OR HIRE THE WORK.</span>
          </h2>
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 lg:gap-8">
          {markets.map((market) => {
            const Icon = market.icon;
            return (
              <article
                key={market.key}
                className="group flex flex-col rounded-3xl border border-white/10 bg-[#10100E]/90 p-6 shadow-2xl transition-colors duration-300 hover:border-[#C9A45C]/30 sm:p-9"
              >
                <div className="mb-8 flex items-center justify-between gap-4">
                  <span className="inline-flex items-center gap-3 font-mono text-[10px] tracking-[0.2em] text-[#C9A45C] sm:text-xs">
                    <span className="flex h-9 w-9 items-center justify-center rounded-full border border-[#C9A45C]/30 bg-[#C9A45C]/[0.07]">
                      <Icon size={16} aria-hidden="true" />
                    </span>
                    {market.label}
                  </span>
                  <span className="shrink-0 whitespace-nowrap rounded-full border border-[#C9A45C]/25 bg-[#C9A45C]/[0.07] px-3 py-1 font-mono text-[9px] tracking-wider text-[#C9A45C]">
                    {market.tag}
                  </span>
                </div>

                <h3 className="mb-4 text-2xl font-extrabold uppercase leading-[1.05] tracking-tight text-[#F5F2E8] sm:text-3xl">
                  {market.title} <span className="text-[#A8A397]">{market.accent}</span>
                </h3>
                <p className="mb-8 max-w-md text-base leading-7 text-[#A8A397]">{market.description}</p>

                <ul className="mb-10 space-y-3 border-t border-white/[0.08] pt-6">
                  {market.points.map((point) => (
                    <li key={point} className="flex gap-3 text-sm leading-6 text-[#D8D4C8]">
                      <span aria-hidden="true" className="mt-[9px] h-1.5 w-1.5 shrink-0 rounded-full bg-[#C9A45C]" />
                      {point}
                    </li>
                  ))}
                </ul>

                <div className="mt-auto flex flex-col gap-3 sm:flex-row">
                  <Link
                    href={market.primary.href}
                    className="inline-flex h-12 items-center justify-center gap-2 rounded-md bg-[#C9A45C] px-6 text-[12px] font-bold uppercase tracking-widest text-[#0A0A09] transition-all duration-200 hover:-translate-y-0.5 hover:bg-[#E6CC91]"
                  >
                    {market.primary.label}
                    <ArrowRight size={14} aria-hidden="true" />
                  </Link>
                  <Link
                    href={market.secondary.href}
                    className="inline-flex h-12 items-center justify-center rounded-md border border-white/10 bg-[#151512] px-6 text-[12px] font-bold uppercase tracking-widest text-[#F5F2E8] transition-all duration-200 hover:-translate-y-0.5 hover:border-white/30"
                  >
                    {market.secondary.label}
                  </Link>
                </div>
              </article>
            );
          })}
        </div>

        <Link
          href="/developers"
          className="group mt-6 flex flex-col gap-2 rounded-2xl border border-white/[0.08] bg-white/[0.02] px-6 py-5 transition-colors hover:border-[#C9A45C]/30 sm:flex-row sm:items-center sm:justify-between lg:mt-8"
        >
          <span className="text-sm leading-6 text-[#A8A397]">
            <span className="font-semibold text-[#F5F2E8]">Building an agent?</span> Both marketplaces are open to AI agents through the REST API and TypeScript SDK.
          </span>
          <span className="inline-flex items-center gap-2 font-mono text-[11px] font-bold tracking-[0.15em] text-[#D6B56D]">
            DEVELOPER DOCS
            <ArrowRight size={13} aria-hidden="true" className="transition-transform group-hover:translate-x-1" />
          </span>
        </Link>
      </div>
    </section>
  );
}
