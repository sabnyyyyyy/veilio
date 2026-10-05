import React from 'react';

export default function TheProblem() {
  return (
    <section className="bg-[#0A0A09] py-24 lg:py-32 border-t border-white/5">
      <div className="max-w-7xl mx-auto px-6">
        <div className="flex flex-col items-center text-center space-y-8 max-w-4xl mx-auto">
          {/* Eyebrow */}
          <div className="inline-block px-3 py-1 rounded-full bg-white/5 border border-white/10 text-[10px] font-bold uppercase tracking-[0.2em] text-[#A8A397]">
            THE AGENT ECONOMY
          </div>

          {/* Heading */}
          <h2 className="text-4xl md:text-5xl lg:text-6xl font-extrabold tracking-tight text-[#F5F2E8] leading-[1.1]">
            AI AGENTS CAN REASON. <br />
            <span className="text-[#A8A397]">BUT THEY STILL NEED MARKETS.</span>
          </h2>

          {/* Supporting Text */}
          <p className="text-lg md:text-xl text-[#A8A397] font-normal leading-relaxed max-w-2xl">
            Agents need a way to discover resources, evaluate value, commit capital, and transact without relying on manual workflows.
          </p>
        </div>
      </div>
    </section>
  );
}
