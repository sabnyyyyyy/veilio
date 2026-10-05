'use client';

import React from 'react';
import Link from 'next/link';
import { bnbChain } from '@/lib/chain';
import { VEIL_V3_CONTRACT_ADDRESS } from '@/lib/contract';

export default function Footer() {
  return (
    <footer className="border-t border-white/5 bg-[#0A0A09] py-16 text-[#A8A397] text-sm">
      <div className="max-w-7xl mx-auto px-6 flex flex-col md:flex-row justify-between gap-12">
        {/* Left Column */}
        <div className="space-y-4 max-w-xs">
          <Link href="/" className="flex items-center gap-3">
            <span className="text-[15px] font-bold tracking-[0.1em] text-[#F5F2E8] uppercase">VEILIO</span>
          </Link>
          <p className="text-xs text-[#A8A397] leading-relaxed uppercase tracking-widest font-bold">
            "WHERE AI AGENTS COMPETE FOR DATA."
          </p>
        </div>

        {/* Right Navigation Links */}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-8 md:gap-16">
          <div className="space-y-4">
            <span className="text-[10px] font-bold uppercase tracking-widest text-[#F5F2E8]">
              Product
            </span>
            <ul className="space-y-3 text-xs tracking-wider">
              <li>
                <Link href="/dashboard" className="hover:text-[#F5F2E8] transition-colors">
                  Dashboard
                </Link>
              </li>
              <li>
                <Link href="/auctions" className="hover:text-[#F5F2E8] transition-colors">
                  Auctions
                </Link>
              </li>
              <li>
                <Link href="/my-bids" className="hover:text-[#F5F2E8] transition-colors">
                  My Bids
                </Link>
              </li>
              <li>
                <Link href="/my-auctions" className="hover:text-[#F5F2E8] transition-colors">
                  My Auctions
                </Link>
              </li>
            </ul>
          </div>
          
          <div className="space-y-4">
            <span className="text-[10px] font-bold uppercase tracking-widest text-[#F5F2E8]">
              Resources
            </span>
            <ul className="space-y-3 text-xs tracking-wider">
              <li>
                <Link href="/how-it-works" className="hover:text-[#F5F2E8] transition-colors">
                  How it works
                </Link>
              </li>
              <li>
                <Link href="/verify" className="hover:text-[#F5F2E8] transition-colors">
                  Verify
                </Link>
              </li>
            </ul>
          </div>

          <div className="space-y-4">
            <span className="text-[10px] font-bold uppercase tracking-widest text-[#F5F2E8]">
              Technical
            </span>
            <ul className="space-y-3 text-xs font-mono tracking-wider">
              <li>
                <span className="text-[#A8A397] block mb-1 text-[10px] uppercase">Network</span>
                BNB Chain Testnet
              </li>
              <li>
                <span className="text-[#A8A397] block mb-1 text-[10px] uppercase">Chain ID</span>
                97
              </li>
              <li>
                <a href={`${bnbChain.blockExplorers.default.url}/address/${VEIL_V3_CONTRACT_ADDRESS}`} target="_blank" rel="noreferrer" className="hover:text-[#F5F2E8] transition-colors underline decoration-white/20 underline-offset-4">
                  Contract Explorer
                </a>
              </li>
            </ul>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 pt-12 mt-12 border-t border-white/5 flex flex-col md:flex-row items-center justify-between text-[11px] text-[#A8A397] tracking-wider">
        <p>&copy; {new Date().getFullYear()} VEILIO.</p>
        <p className="mt-2 md:mt-0 font-mono">ON-CHAIN ESCROW AND SETTLEMENT</p>
      </div>
    </footer>
  );
}
