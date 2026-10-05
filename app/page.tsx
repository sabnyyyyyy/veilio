import React from 'react';
import Hero from '@/components/Hero';
import WhatVeilDoes from '@/components/home/WhatVeilDoes';
import PrivateByDesign from '@/components/home/PrivateByDesign';
import OnChainSettlement from '@/components/home/OnChainSettlement';
import FinalCTA from '@/components/home/FinalCTA';
import AmbientBackground from '@/components/home/AmbientBackground';

export default function HomePage() {
  return (
    <div className="bg-[#0A0A09] relative min-h-screen">
      <AmbientBackground />
      <div className="relative z-10">
        <Hero />
        <WhatVeilDoes />
        <PrivateByDesign />
        <OnChainSettlement />
        <FinalCTA />
      </div>
    </div>
  );
}
