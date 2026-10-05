'use client';

import React from 'react';
import Link from 'next/link';

export default function BlockchainProof() {
  return (
    <div className="bg-[#0A0A09]">
      {/* WHY BLINDBID SECTION */}
      <section className="py-24 border-t border-white/5">
        <div className="max-w-7xl mx-auto px-6">
          <div className="max-w-3xl space-y-6">
            <h2 className="text-xs font-semibold uppercase tracking-widest text-[#C9A45C]">
              Why VEILIO
            </h2>
            <h3 className="text-4xl sm:text-5xl lg:text-6xl font-extrabold tracking-tight text-[#F5F2E8] uppercase leading-[1.05]">
              DON'T BID AGAINST THE SCREEN.
            </h3>
            <p className="text-lg text-[#A8A397] leading-relaxed max-w-2xl">
              Traditional visible auctions encourage people to react to every new bid. 
              VEILIO lets participants commit to their maximum independently, removing manipulation and snipers.
            </p>
          </div>
        </div>
      </section>

      {/* WHY ON-CHAIN SECTION */}
      <section className="py-20 border-t border-white/5 bg-[#0e100d]">
        <div className="max-w-7xl mx-auto px-6">
          <div className="mb-12">
            <h3 className="text-xs font-semibold uppercase tracking-widest text-[#A8A397]">
              WHY ON-CHAIN
            </h3>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <div className="p-8 rounded-2xl bg-[#151512] border border-white/10 space-y-4">
              <h4 className="text-xl font-bold uppercase text-[#F5F2E8] tracking-tight">
                IMMUTABLE
              </h4>
              <p className="text-sm text-[#A8A397] leading-relaxed">
                Commitments cannot be silently changed, backdated, or tampered with once stored on BNB Chain.
              </p>
            </div>

            <div className="p-8 rounded-2xl bg-[#151512] border border-white/10 space-y-4">
              <h4 className="text-xl font-bold uppercase text-[#F5F2E8] tracking-tight">
                TRANSPARENT
              </h4>
              <p className="text-sm text-[#A8A397] leading-relaxed">
                Settlement follows smart-contract rules automatically without intermediaries or bias.
              </p>
            </div>

            <div className="p-8 rounded-2xl bg-[#151512] border border-white/10 space-y-4">
              <h4 className="text-xl font-bold uppercase text-[#F5F2E8] tracking-tight">
                VERIFIABLE
              </h4>
              <p className="text-sm text-[#A8A397] leading-relaxed">
                Anyone can independently verify the final result and cryptographic proof at any time.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* FINAL CTA SECTION */}
      <section className="py-28 border-t border-white/5 text-center">
        <div className="max-w-3xl mx-auto px-6 space-y-8">
          <h3 className="text-3xl sm:text-5xl font-extrabold tracking-tight text-[#F5F2E8] uppercase">
            READY TO PLACE A BLIND BID?
          </h3>
          <div className="pt-2">
            <Link
              href="/auctions"
              className="inline-block px-10 py-5 text-sm font-semibold uppercase tracking-wider rounded-xl bg-[#C9A45C] text-[#0A0A09] hover:bg-[#E6CC91] active:scale-[0.98] transition-all duration-200 shadow-xl shadow-[#C9A45C]/10"
            >
              Explore auctions
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
