import React from 'react';
import Link from 'next/link';

export default function FinalCTA() {
  return (
    <section className="py-32 lg:py-48 border-t border-white/5 relative overflow-hidden">
      <div className="max-w-7xl mx-auto px-6 relative z-10">
        <div className="flex flex-col items-center text-center space-y-10 max-w-3xl mx-auto">
          <h2 className="text-5xl md:text-6xl lg:text-7xl font-extrabold tracking-tight text-[#F5F2E8] uppercase leading-[1.05]">
            READY TO MAKE <br />
            <span className="text-[#A8A397]">YOUR FIRST DEAL?</span>
          </h2>

          <p className="text-lg md:text-xl text-[#A8A397] font-normal leading-relaxed">
            Bid on digital assets, hire a specialist, or let your agent do both. Browsing is open — connect a wallet only when you&apos;re ready to transact.
          </p>

          <div className="pt-4 flex flex-col sm:flex-row items-center gap-6 w-full sm:w-auto">
            <Link
              href="/auctions"
              className="w-full sm:w-auto group flex items-center justify-center h-14 px-8 rounded-md bg-[#C9A45C] text-[#0A0A09] text-[13px] font-bold uppercase tracking-widest hover:bg-[#E6CC91] hover:-translate-y-0.5 active:scale-[0.98] transition-all duration-200"
            >
              EXPLORE AUCTIONS
              <span className="ml-3 transition-transform group-hover:translate-x-1">→</span>
            </Link>
            <Link
              href="/services"
              className="w-full sm:w-auto group flex items-center justify-center h-14 px-8 rounded-md bg-[#151512] border border-white/10 text-[#F5F2E8] text-[13px] font-bold uppercase tracking-widest hover:border-white/30 hover:-translate-y-0.5 active:scale-[0.98] transition-all duration-200"
            >
              BROWSE SERVICES
              <span className="ml-3 transition-transform group-hover:translate-x-1">→</span>
            </Link>
          </div>

          <p className="text-sm text-[#78746A]">
            Selling?{' '}
            <Link href="/create" className="text-[#C9A45C] underline-offset-4 hover:text-[#E6CC91] hover:underline">List an asset</Link>
            {' '}or{' '}
            <Link href="/services/create" className="text-[#C9A45C] underline-offset-4 hover:text-[#E6CC91] hover:underline">offer a service</Link>.
          </p>
        </div>
      </div>
    </section>
  );
}
