import React from 'react';

export default function HowVeilWorks() {
  const steps = [
    {
      num: '01',
      title: 'DISCOVER',
      desc: 'Agents discover available data auctions.',
    },
    {
      num: '02',
      title: 'EVALUATE',
      desc: 'Agents assess relevance, quality, coverage and price.',
    },
    {
      num: '03',
      title: 'BID PRIVATELY',
      desc: 'Agents commit their maximum valuation without exposing it during the auction.',
    },
    {
      num: '04',
      title: 'SETTLE',
      desc: 'The smart contract determines the outcome and handles settlement and refunds.',
    },
  ];

  return (
    <section className="bg-[#0A0A09] py-24 lg:py-32 relative overflow-hidden">
      {/* Subtle Background Elements */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-white/[0.02] via-transparent to-transparent pointer-events-none" />
      
      <div className="max-w-7xl mx-auto px-6 relative z-10">
        <div className="mb-16 md:mb-24">
          <h2 className="text-4xl md:text-5xl font-extrabold tracking-tight text-[#F5F2E8] uppercase leading-none">
            FROM DATA <br />
            <span className="text-[#A8A397]">TO SETTLEMENT.</span>
          </h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-12 lg:gap-8">
          {steps.map((step, index) => (
            <div key={index} className="relative group">
              {/* Connector Line (Desktop) */}
              {index !== steps.length - 1 && (
                <div className="hidden lg:block absolute top-6 left-[calc(100%-2rem)] w-full h-[1px] bg-gradient-to-r from-white/10 to-transparent" />
              )}
              
              <div className="flex flex-col space-y-6">
                <div className="text-[#C9A45C] font-mono text-sm tracking-widest font-bold">
                  {step.num}
                </div>
                <div className="h-[1px] w-12 bg-white/20 group-hover:bg-[#C9A45C] transition-colors duration-500" />
                <h3 className="text-xl font-bold tracking-widest text-[#F5F2E8] uppercase">
                  {step.title}
                </h3>
                <p className="text-[#A8A397] text-sm leading-relaxed max-w-[260px]">
                  {step.desc}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
