import React from 'react';
import Image from 'next/image';
import { BadgeCheck, Coins, Eye, Lock, PackageCheck, ScanSearch, ShieldCheck, Trophy, type LucideIcon } from 'lucide-react';

const tracks: { label: string; steps: { label: string; icon: LucideIcon }[] }[] = [
  {
    label: 'AUCTIONS',
    steps: [
      { label: 'BIDS SEALED', icon: Lock },
      { label: 'BIDS REVEALED', icon: Eye },
      { label: 'WINNER DETERMINED', icon: Trophy },
      { label: 'ASSET INSPECTED', icon: ScanSearch },
      { label: 'FUNDS RELEASED', icon: Coins },
    ],
  },
  {
    label: 'SERVICES',
    steps: [
      { label: 'PAYMENT ESCROWED', icon: ShieldCheck },
      { label: 'WORK DELIVERED', icon: PackageCheck },
      { label: 'BUYER APPROVES', icon: BadgeCheck },
      { label: 'FUNDS RELEASED', icon: Coins },
    ],
  },
];

const networks = [
  { name: 'BNB CHAIN TESTNET', id: 'CHAIN 97', logo: '/logos/chains/bnb-chain.svg' },
  { name: 'BASE SEPOLIA', id: 'CHAIN 84532', logo: '/logos/chains/base.svg' },
  { name: 'SOLANA', id: 'DEVNET', logo: '/logos/chains/solana.svg' },
];

export default function OnChainSettlement() {
  return (
    <section className="py-24 lg:py-32 border-t border-white/5 relative overflow-hidden">
      {/* Decorative blurred circle */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-[#C9A45C]/5 rounded-full blur-[120px] pointer-events-none"></div>

      <div className="max-w-7xl mx-auto px-6 relative z-10">
        <div className="flex flex-col items-center text-center space-y-16 max-w-4xl mx-auto">

          <div className="space-y-6">
            <h2 className="text-4xl md:text-5xl lg:text-6xl font-extrabold tracking-tight text-[#F5F2E8] uppercase leading-[1.1]">
              EVERY DEAL <br />
              <span className="text-[#A8A397]">SETTLES ON-CHAIN.</span>
            </h2>
            <p className="mx-auto max-w-xl text-base md:text-lg leading-relaxed text-[#A8A397]">
              Funds move only when the contract says so. Losing bidders and unfulfilled orders are refunded on-chain.
            </p>
          </div>

          <div className="w-full max-w-3xl grid grid-cols-2 md:grid-cols-1 gap-8 md:gap-14">
            {tracks.map((track) => (
              <div key={track.label} className="flex flex-col items-center md:items-stretch gap-6">
                <span className="font-mono text-[10px] tracking-[0.25em] text-[#C9A45C] md:text-left">{track.label}</span>
                <div className="flex flex-col md:flex-row justify-between items-center md:items-start gap-0">
                  {track.steps.map((step, idx) => {
                    const Icon = step.icon;
                    const isFinal = idx === track.steps.length - 1;
                    return (
                      <React.Fragment key={step.label}>
                        <div className="group flex flex-col items-center">
                          <div
                            className={`mb-3 flex h-11 w-11 items-center justify-center rounded-full border transition-all duration-300 group-hover:border-[#C9A45C] group-hover:shadow-[0_0_18px_rgba(201,164,92,0.35)] ${
                              isFinal
                                ? 'border-[#C9A45C]/70 bg-[#C9A45C]/15 text-[#E6CC91] shadow-[0_0_14px_rgba(201,164,92,0.25)]'
                                : 'border-[#C9A45C]/30 bg-[#151512] text-[#C9A45C]'
                            }`}
                          >
                            <Icon size={18} strokeWidth={1.75} aria-hidden="true" />
                          </div>
                          <span className="text-[10px] font-bold tracking-[0.15em] text-[#F5F2E8] uppercase w-24 text-center">
                            {step.label}
                          </span>
                        </div>
                        {!isFinal && (
                          <div className="hidden md:block flex-grow h-[1px] mt-[22px] bg-gradient-to-r from-[#C9A45C]/50 to-[#C9A45C]/10 mx-1"></div>
                        )}
                        {!isFinal && (
                          <div className="block md:hidden w-[1px] h-6 bg-gradient-to-b from-[#C9A45C]/50 to-[#C9A45C]/10 my-2"></div>
                        )}
                      </React.Fragment>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>

          <div className="pt-8 flex flex-col items-center gap-3">
            <span className="text-[#A8A397] text-xs font-mono tracking-widest uppercase">LIVE ON</span>
            <div className="flex flex-wrap justify-center gap-3">
              {networks.map((network) => (
                <div key={network.name} className="flex items-center gap-2.5 px-4 py-2 bg-[#151512] border border-white/10 rounded-md">
                  <Image src={network.logo} alt="" width={16} height={16} className="h-4 w-4 shrink-0" />
                  <span className="text-[#F5F2E8] text-xs font-mono font-bold tracking-widest">{network.name}</span>
                  <span className="text-[#C9A45C] text-xs font-mono">{network.id}</span>
                </div>
              ))}
            </div>
          </div>

        </div>
      </div>
    </section>
  );
}
