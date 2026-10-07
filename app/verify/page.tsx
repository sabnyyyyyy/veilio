'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { bnbChain } from '@/lib/chain';
import { VEIL_V3_CONTRACT_ADDRESS } from '@/lib/contract';

export default function VerifyPage() {
  const router = useRouter();
  const [auctionId, setAuctionId] = useState('');

  const handleVerify = (e: React.FormEvent) => {
    e.preventDefault();
    const id = auctionId.trim();
    if (!id) return;
    // Navigate to the dedicated verify detail page — data is read from chain there
    router.push(`/verify/${id}`);
  };

  return (
    <div className="min-h-screen py-20 bg-[#0A0A09]">
      <div className="max-w-3xl mx-auto px-6">

        {/* Header */}
        <div className="mb-12 text-center space-y-4">
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full border border-[#C9A45C]/20 bg-[#C9A45C]/5 text-xs font-bold uppercase tracking-widest text-[#C9A45C] mb-4">
            <span className="w-1.5 h-1.5 rounded-full bg-[#C9A45C] animate-pulse" />
            BNB Chain · ID 97
          </div>
          <h1 className="text-4xl sm:text-5xl font-extrabold tracking-tight text-[#F5F2E8] uppercase">
            Verify an Auction
          </h1>
          <p className="text-sm text-[#A8A397] max-w-lg mx-auto leading-6">
            Read auction status and completed settlement details directly from the active VEILIO contract on BNB Smart Chain Testnet.
          </p>
        </div>

        {/* Lookup Form */}
        <form onSubmit={handleVerify} className="p-8 rounded-2xl bg-[#151512] border border-white/10 space-y-6">
          <div className="space-y-2">
            <label htmlFor="auction-id-input" className="block text-xs uppercase font-bold tracking-wider text-[#A8A397]">
              Auction ID
            </label>
            <div className="flex gap-3">
              <input
                id="auction-id-input"
                type="text"
                required
                value={auctionId}
                onChange={(e) => setAuctionId(e.target.value)}
                placeholder="e.g. 1"
                className="flex-grow px-5 py-4 text-xl font-bold bg-[#0A0A09] border border-white/10 rounded-xl text-[#F5F2E8] focus:outline-none focus:border-[#C9A45C] transition-colors placeholder:text-[#A8A397]/40"
              />
              <button
                type="submit"
                className="px-8 py-4 text-sm font-bold uppercase tracking-wider rounded-xl bg-[#C9A45C] text-[#0A0A09] hover:bg-[#E6CC91] active:scale-[0.98] transition-all duration-200"
              >
                Verify
              </button>
            </div>
          </div>

          <p className="text-xs text-[#A8A397]">
            Enter an auction ID to inspect its on-chain record, winner, winning bid, and fee breakdown when settlement is complete.
          </p>
        </form>

        {/* Explainer */}
        <div className="mt-8 grid grid-cols-1 sm:grid-cols-3 gap-4">
          {[
            { label: 'Network', value: 'BNB Chain Testnet' },
            { label: 'Chain ID', value: '97' },
            { label: 'Active contract', value: `${VEIL_V3_CONTRACT_ADDRESS.substring(0, 6)}…${VEIL_V3_CONTRACT_ADDRESS.substring(38)}` },
          ].map(({ label, value }) => (
            <div key={label} className="p-5 rounded-2xl bg-[#151512] border border-white/10 text-center">
              <span className="block text-xs uppercase tracking-wider text-[#A8A397] mb-2">{label}</span>
              <span className="font-mono text-sm font-bold text-[#F5F2E8]">{value}</span>
            </div>
          ))}
        </div>

        {/* Contract link */}
        <div className="mt-6 text-center">
          <a
            href={`${bnbChain.blockExplorers.default.url}address/${VEIL_V3_CONTRACT_ADDRESS}`}
            target="_blank"
            rel="noreferrer"
            className="inline-block px-6 py-3 text-xs font-bold uppercase tracking-wider rounded-xl bg-white/[0.04] border border-white/10 text-[#A8A397] hover:text-[#F5F2E8] hover:bg-white/[0.08] transition-colors"
          >
            View Active Contract on BscScan →
          </a>
        </div>

      </div>
    </div>
  );
}
