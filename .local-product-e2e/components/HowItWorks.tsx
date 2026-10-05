'use client';

import React from 'react';

export default function HowItWorks() {
  const steps = [
    {
      number: '01',
      title: 'SET YOUR MAXIMUM',
      description: "Choose the most you're willing to pay. No bidding wars or impulse escalation.",
    },
    {
      number: '02',
      title: 'LOCK YOUR BID',
      description: 'Your maximum is cryptographically committed on BNB Chain Testnet and hidden from everyone.',
    },
    {
      number: '03',
      title: 'REVEAL & SETTLE',
      description: 'After the auction closes, the protocol transparently calculates the winner and true market price.',
    },
  ];

  return (
    <section className="py-24 bg-[#0A0A09] border-t border-white/5">
      <div className="max-w-7xl mx-auto px-6">
        <div className="max-w-2xl mb-16 space-y-3">
          <h2 className="text-xs font-semibold uppercase tracking-widest text-[#C9A45C]">
            The Protocol
          </h2>
          <h3 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-[#F5F2E8]">
            HOW IT WORKS
          </h3>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-12">
          {steps.map((step) => (
            <div key={step.number} className="flex flex-col space-y-4">
              <span className="text-5xl font-extrabold text-[#C9A45C]">
                {step.number}
              </span>
              <h4 className="text-xl font-bold tracking-tight text-[#F5F2E8]">
                {step.title}
              </h4>
              <p className="text-base text-[#A8A397] leading-relaxed">
                {step.description}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
