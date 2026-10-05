import React from 'react';
import HowItWorks from '@/components/HowItWorks';
import BlockchainProof from '@/components/BlockchainProof';

export const metadata = {
  title: 'How It Works — VEILIO',
  description: 'Learn how sealed-bid auctions eliminate bid manipulation through cryptographic commitments.',
};

export default function HowItWorksPage() {
  return (
    <div className="bg-[#0A0A09]">
      <HowItWorks />
      <BlockchainProof />
    </div>
  );
}
