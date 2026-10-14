'use client';

import React from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { ArrowRight, ChevronRight } from 'lucide-react';

export default function Hero() {
  const marqueeItems = [
    { name: 'BNB CHAIN', tag: 'Settlement L1', logo: '/logos/chains/bnb-chain.svg' },
    { name: 'SOLANA', tag: 'High-Speed Escrow', logo: '/logos/chains/solana.svg' },
    { name: 'BASE', tag: 'OP Stack L2', logo: '/logos/chains/base.svg' },
  ];
  // Only 3 chains: repeat the set so one half of the track is wider than the
  // viewport, then duplicate that half so translateX(-50%) loops seamlessly.
  const MARQUEE_SET_REPEAT = 4;
  const marqueeHalf = Array.from({ length: MARQUEE_SET_REPEAT }, () => marqueeItems).flat();
  const marqueeTrack = [...marqueeHalf, ...marqueeHalf];

  return (
    <section className="relative min-h-screen flex flex-col justify-between items-center overflow-hidden pt-28 pb-8 sm:pt-32 sm:pb-10">

      {/* Hero Content Container - Expanded Width */}
      <div className="relative z-10 w-full max-w-[1440px] mx-auto px-6 sm:px-10 lg:px-16 flex-1 flex flex-col justify-center items-center text-center my-auto">
        {/* Display Headline - Expanded Max-Width & Fluid Scale */}
        <h1 className="relative z-10 w-full max-w-6xl text-balance text-center text-[clamp(2.4rem,6.2vw,5.2rem)] font-extrabold uppercase leading-[0.98] tracking-tight text-white drop-shadow-[0_4px_30px_rgba(0,0,0,0.95)]">
          <span className="block">The on-chain exchange</span>
          <span className="block mt-2 bg-gradient-to-b from-white via-zinc-100 to-[#E2C17C] bg-clip-text text-transparent">
            for humans &amp; autonomous agents
          </span>
        </h1>

        {/* Subtitle - Expanded Width & Size */}
        <p className="relative z-10 mt-7 max-w-3xl text-center text-base sm:text-lg lg:text-xl leading-relaxed text-zinc-300 font-normal drop-shadow-[0_2px_12px_rgba(0,0,0,0.9)]">
          Coordinate trustless sealed-bid auctions, encrypted digital asset escrow, and verified AI service contracts across BNB Chain, Base, and Solana.
        </p>

        {/* Dual CTA Buttons */}
        <div className="mt-9 sm:mt-11 flex w-full flex-col items-center justify-center gap-4 sm:w-auto sm:flex-row sm:gap-6">
          {/* Glowing Border Star Button */}
          <Link
            href="/auctions"
            className="group relative inline-flex h-12 items-center justify-center gap-2 overflow-hidden rounded-full p-[1px] font-medium transition-transform duration-200 hover:scale-[1.02] active:scale-[0.98]"
          >
            {/* Rotating Conic Glow */}
            <span
              className="absolute inset-[-100%] animate-spin-slow bg-[conic-gradient(from_90deg_at_50%_50%,#E2C17C_0%,#FFFFFF_25%,rgba(226,193,124,0.2)_50%,#FFFFFF_75%,#E2C17C_100%)] opacity-85"
            />
            {/* Button Surface */}
            <span className="relative inline-flex h-full w-full items-center justify-center gap-2.5 rounded-full bg-[#050505] px-7 text-xs sm:text-[13px] font-bold uppercase tracking-[0.14em] text-white transition-colors group-hover:bg-[#0c0c0c]">
              <span>Explore Auctions</span>
              <ArrowRight size={14} className="text-[#E2C17C] transition-transform group-hover:translate-x-1" />
            </span>
          </Link>

          {/* Secondary White Pill Button */}
          <Link
            href="/services"
            className="group inline-flex h-12 items-center justify-center gap-2 rounded-full border border-white/20 bg-white/95 px-7 text-xs sm:text-[13px] font-bold uppercase tracking-[0.14em] text-black shadow-lg transition-all duration-200 hover:bg-white hover:border-white hover:shadow-[0_0_25px_rgba(255,255,255,0.25)] active:scale-[0.98]"
          >
            <span>Verified Services</span>
            <ChevronRight size={15} className="text-black/70 transition-transform group-hover:translate-x-0.5" />
          </Link>
        </div>
      </div>

      {/* Base Protocol & Ecosystem Marquee - Expanded */}
      <div className="relative z-10 w-full max-w-[1440px] mx-auto mt-8 sm:mt-10 px-6 sm:px-10">
        {/* Subtle Section Divider Line */}
        <div className="relative mx-auto mb-4 h-px w-full max-w-6xl bg-gradient-to-r from-transparent via-white/15 to-transparent" />

        {/* Marquee Ticker */}
        <div className="relative overflow-hidden [mask-image:linear-gradient(to_right,transparent,black_10%,black_90%,transparent)] [-webkit-mask-image:linear-gradient(to_right,transparent,black_10%,black_90%,transparent)] py-2">
          <div className="animate-marquee">
            {marqueeTrack.map((item, idx) => (
              <div
                key={`${item.name}-${idx}`}
                aria-hidden={idx >= marqueeItems.length ? true : undefined}
                className="flex items-center gap-3 whitespace-nowrap pr-12 sm:pr-16 opacity-70 hover:opacity-100 transition-opacity cursor-default"
              >
                <span className="h-1.5 w-1.5 rounded-full bg-[#E2C17C]/80" />
                <Image
                  src={item.logo}
                  alt=""
                  width={16}
                  height={16}
                  className="h-4 w-4 shrink-0"
                />
                <span className="text-xs sm:text-[13px] font-bold tracking-[0.18em] uppercase text-white font-mono">
                  {item.name}
                </span>
                <span className="text-[10px] sm:text-[11px] tracking-wider uppercase text-zinc-500 font-mono">
                  [{item.tag}]
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
