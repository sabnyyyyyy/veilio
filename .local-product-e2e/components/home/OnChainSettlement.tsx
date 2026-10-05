import React from 'react';

export default function OnChainSettlement() {
  const steps = [
    'BID FUNDS LOCKED',
    'AUCTION CLOSES',
    'WINNER DETERMINED',
    'LOSERS REFUNDED',
    'SETTLEMENT VERIFIED'
  ];

  return (
    <section className="py-24 lg:py-32 border-t border-white/5 relative overflow-hidden">
      {/* Decorative blurred circle */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-[#C9A45C]/5 rounded-full blur-[120px] pointer-events-none"></div>

      <div className="max-w-7xl mx-auto px-6 relative z-10">
        <div className="flex flex-col items-center text-center space-y-16 max-w-4xl mx-auto">
          
          <h2 className="text-4xl md:text-5xl lg:text-6xl font-extrabold tracking-tight text-[#F5F2E8] uppercase leading-[1.1]">
            THE MARKET <br />
            <span className="text-[#A8A397]">SETTLES ITSELF.</span>
          </h2>

          <div className="w-full max-w-3xl flex flex-col md:flex-row justify-between items-center gap-6 md:gap-0">
            {steps.map((step, idx) => (
              <React.Fragment key={idx}>
                <div className="flex flex-col items-center">
                   <div className="w-2 h-2 bg-[#C9A45C] rounded-full shadow-[0_0_10px_rgba(201,164,92,0.5)] mb-4"></div>
                   <span className="text-[10px] font-bold tracking-[0.15em] text-[#F5F2E8] uppercase w-24 text-center">
                     {step}
                   </span>
                </div>
                {idx !== steps.length - 1 && (
                  <div className="hidden md:block flex-grow h-[1px] bg-gradient-to-r from-[#C9A45C]/50 to-[#C9A45C]/10 mx-2"></div>
                )}
                {idx !== steps.length - 1 && (
                  <div className="block md:hidden w-[1px] h-8 bg-gradient-to-b from-[#C9A45C]/50 to-[#C9A45C]/10 my-2"></div>
                )}
              </React.Fragment>
            ))}
          </div>

          <div className="pt-8 flex flex-col items-center gap-2">
            <span className="text-[#A8A397] text-xs font-mono tracking-widest uppercase">POWERED BY</span>
            <div className="px-4 py-2 bg-[#151512] border border-white/10 rounded-md">
              <span className="text-[#F5F2E8] text-xs font-mono font-bold tracking-widest">BNB CHAIN TESTNET </span>
              <span className="text-[#C9A45C] text-xs font-mono ml-2">CHAIN 97</span>
            </div>
          </div>
          
        </div>
      </div>
    </section>
  );
}
