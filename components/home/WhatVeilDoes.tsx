import React from 'react';

export default function WhatVeilDoes() {
  return (
    <section id="action" className="py-24 lg:py-32 relative overflow-hidden border-b border-white/5 scroll-mt-20">
      <div className="max-w-[1440px] mx-auto px-6 sm:px-10 lg:px-16 relative z-10">
        
        {/* Narrative Intro */}
        <div className="mb-20">
          <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.25em] text-[#C9A45C] mb-6">
            <span className="w-1.5 h-1.5 rounded-full bg-[#C9A45C]"></span>
            HOW VEILIO WORKS
          </div>
          <h2 className="text-[40px] md:text-6xl lg:text-[68px] font-extrabold tracking-tighter text-[#F5F2E8] uppercase max-w-3xl leading-[0.95] mb-8">
            ONE MARKET. <br />
            <span className="text-[#A8A397]">TWO WAYS TO TRADE.</span>
          </h2>
          <p className="text-[17px] md:text-[19px] text-[#A8A397] font-normal leading-[1.6] max-w-[640px]">
            VEILIO connects sellers with human and AI buyers. Digital assets sell through sealed-bid auctions; services are paid through on-chain escrow — on BNB Chain, Base, and Solana.
          </p>
        </div>

        {/* Lifecycle Visualization */}
        <div className="relative mt-12 lg:mt-24">
          
          {/* Continuous Line (Desktop) */}
          <div className="hidden lg:block absolute top-[15px] left-0 right-0 h-[1px] bg-white/10 z-0">
            {/* Animated traveling signal */}
            <div className="absolute top-0 left-0 h-full w-[100px] bg-gradient-to-r from-transparent via-[#C9A45C] to-transparent opacity-50 animate-[travelRight_8s_ease-in-out_infinite]" />
          </div>

          {/* Continuous Line (Mobile/Tablet) */}
          <div className="lg:hidden absolute top-0 bottom-0 left-[15px] w-[1px] bg-white/10 z-0">
             {/* Animated traveling signal */}
             <div className="absolute top-0 left-0 w-full h-[100px] bg-gradient-to-b from-transparent via-[#C9A45C] to-transparent opacity-50 animate-[travelDown_8s_ease-in-out_infinite]" />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-4 gap-12 lg:gap-8 relative z-10">

            {/* Stage 01: LIST */}
            <div className="group flex lg:block items-start gap-6 lg:gap-0 cursor-default">
              <div className="flex-shrink-0 w-8 h-8 rounded-full bg-[#11110F] border border-white/10 flex items-center justify-center text-[11px] font-mono font-bold text-[#A8A397] group-hover:border-[#F5F2E8] group-hover:text-[#F5F2E8] transition-colors duration-300 lg:mb-8 shadow-[0_0_10px_rgba(0,0,0,0.5)]">
                01
              </div>
              <div>
                <h3 className="text-[20px] font-semibold tracking-wide uppercase text-[#A8A397] group-hover:text-[#F5F2E8] transition-colors duration-300 mb-4">
                  LIST
                </h3>
                <p className="text-[16px] text-[#78746A] group-hover:text-[#A8A397] leading-[1.6] transition-colors duration-300 max-w-[280px]">
                  Sellers list a digital asset for a sealed-bid auction, or publish a service with a fixed price and delivery terms.
                </p>
              </div>
            </div>

            {/* Stage 02: DISCOVER */}
            <div className="group flex lg:block items-start gap-6 lg:gap-0 cursor-default">
              <div className="flex-shrink-0 w-8 h-8 rounded-full bg-[#11110F] border border-white/10 flex items-center justify-center text-[11px] font-mono font-bold text-[#A8A397] group-hover:border-[#F5F2E8] group-hover:text-[#F5F2E8] transition-colors duration-300 lg:mb-8 shadow-[0_0_10px_rgba(0,0,0,0.5)]">
                02
              </div>
              <div>
                <h3 className="text-[20px] font-semibold tracking-wide uppercase text-[#A8A397] group-hover:text-[#F5F2E8] transition-colors duration-300 mb-4">
                  DISCOVER
                </h3>
                <p className="text-[16px] text-[#78746A] group-hover:text-[#A8A397] leading-[1.6] transition-colors duration-300 max-w-[280px]">
                  Humans and AI agents find datasets, models, licenses, NFTs, and services — in the app or through the API &amp; SDK.
                </p>
              </div>
            </div>

            {/* Stage 03: COMMIT */}
            <div className="group flex lg:block items-start gap-6 lg:gap-0 cursor-default">
              <div className="flex-shrink-0 w-8 h-8 rounded-full bg-[#11110F] border border-[#C9A45C]/30 flex items-center justify-center text-[11px] font-mono font-bold text-[#C9A45C] group-hover:bg-[#C9A45C]/10 group-hover:border-[#C9A45C] group-hover:shadow-[0_0_15px_rgba(201,164,92,0.2)] transition-all duration-300 lg:mb-8">
                03
              </div>
              <div>
                <h3 className="text-[20px] font-semibold tracking-wide uppercase text-[#C9A45C] group-hover:text-[#E6CC91] transition-colors duration-300 mb-4">
                  COMMIT
                </h3>
                <p className="text-[16px] text-[#A8A397] group-hover:text-[#E8E5DC] leading-[1.6] transition-colors duration-300 max-w-[280px]">
                  Auction bids are committed as hashes and revealed after the commit phase. Service payments are locked in on-chain escrow.
                </p>
              </div>
            </div>

            {/* Stage 04: SETTLE */}
            <div className="group flex lg:block items-start gap-6 lg:gap-0 cursor-default">
              <div className="flex-shrink-0 w-8 h-8 rounded-full bg-[#11110F] border border-white/10 flex items-center justify-center text-[11px] font-mono font-bold text-[#A8A397] group-hover:border-[#F5F2E8] group-hover:text-[#F5F2E8] transition-colors duration-300 lg:mb-8 shadow-[0_0_10px_rgba(0,0,0,0.5)]">
                04
              </div>
              <div>
                <h3 className="text-[20px] font-semibold tracking-wide uppercase text-[#A8A397] group-hover:text-[#F5F2E8] transition-colors duration-300 mb-4">
                  SETTLE
                </h3>
                <p className="text-[16px] text-[#78746A] group-hover:text-[#A8A397] leading-[1.6] transition-colors duration-300 max-w-[280px]">
                  Buyers inspect the delivery before funds are released. Disputes go to review, and refunds are paid out on-chain.
                </p>
              </div>
            </div>

          </div>
        </div>

      </div>

      {/* Global CSS animations for the traveling line */}
      <style dangerouslySetInnerHTML={{__html: `
        @keyframes travelRight {
          0% { transform: translateX(-100%); opacity: 0; }
          10% { opacity: 1; }
          90% { opacity: 1; }
          100% { transform: translateX(1300px); opacity: 0; }
        }
        @keyframes travelDown {
          0% { transform: translateY(-100%); opacity: 0; }
          10% { opacity: 1; }
          90% { opacity: 1; }
          100% { transform: translateY(800px); opacity: 0; }
        }
      `}} />
    </section>
  );
}
