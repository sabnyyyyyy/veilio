import React from 'react';
import Hero from '@/components/Hero';
import SmokeBackground from '@/components/home/SmokeBackground';
import WhatVeilDoes from '@/components/home/WhatVeilDoes';
import TwoMarketplaces from '@/components/home/TwoMarketplaces';
import OnChainSettlement from '@/components/home/OnChainSettlement';
import FinalCTA from '@/components/home/FinalCTA';

export default function HomePage() {
  return (
    <div className="bg-black text-white relative min-h-screen overflow-x-hidden selection:bg-[#E2C17C] selection:text-black">
      {/* Fixed smoke backdrop: stays put while the sections scroll over it */}
      <SmokeBackground />
      <Hero />
      <WhatVeilDoes />
      <TwoMarketplaces />
      <OnChainSettlement />
      <FinalCTA />
    </div>
  );
}
