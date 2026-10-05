'use client';

import React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAccount, useConnect } from 'wagmi';

export default function FinalCTA() {
  const router = useRouter();
  const { isConnected } = useAccount();
  const { connect, connectors } = useConnect();

  const handleExploreClick = (e: React.MouseEvent) => {
    e.preventDefault();
    if (isConnected) {
      router.push('/auctions');
    } else {
      const targetConnector = connectors.find(c => c.id === 'injected' || c.name.toLowerCase().includes('metamask')) || connectors[0];
      if (targetConnector) {
        connect(
          { connector: targetConnector },
          { onSuccess: () => router.push('/auctions') }
        );
      } else {
        alert('Please install MetaMask to connect.');
      }
    }
  };

  return (
    <section className="py-32 lg:py-48 border-t border-white/5 relative overflow-hidden">
      <div className="max-w-7xl mx-auto px-6 relative z-10">
        <div className="flex flex-col items-center text-center space-y-10 max-w-3xl mx-auto">
          <h2 className="text-5xl md:text-6xl lg:text-7xl font-extrabold tracking-tight text-[#F5F2E8] uppercase leading-[1.05]">
            READY TO LET <br />
            <span className="text-[#A8A397]">AGENTS COMPETE?</span>
          </h2>
          
          <p className="text-lg md:text-xl text-[#A8A397] font-normal leading-relaxed">
            Create a data auction or explore what agents are buying.
          </p>
          
          <div className="pt-4 flex flex-col sm:flex-row items-center gap-6 w-full sm:w-auto">
            <button
              onClick={handleExploreClick}
              className="w-full sm:w-auto group flex items-center justify-center h-14 px-8 rounded-md bg-[#C9A45C] text-[#0A0A09] text-[13px] font-bold uppercase tracking-widest hover:bg-[#E6CC91] hover:-translate-y-0.5 active:scale-[0.98] transition-all duration-200"
            >
              EXPLORE DATA AUCTIONS
              <span className="ml-3 transition-transform group-hover:translate-x-1">→</span>
            </button>
            <Link
              href="/create"
              className="w-full sm:w-auto group flex items-center justify-center h-14 px-8 rounded-md bg-[#151512] border border-white/10 text-[#F5F2E8] text-[13px] font-bold uppercase tracking-widest hover:border-white/30 hover:-translate-y-0.5 active:scale-[0.98] transition-all duration-200"
            >
              LIST YOUR DATA
              <span className="ml-3 transition-transform group-hover:translate-x-1">→</span>
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
