import React from 'react';

function FlowConnector({ delay = '0s' }: { delay?: string }) {
  return (
    <div aria-hidden="true" className="flex items-center justify-center py-1 md:px-1 md:py-0">
      <svg viewBox="0 0 76 24" className="hidden h-6 w-full overflow-visible md:block">
        <path d="M2 12h68m-7-6 7 6-7 6" fill="none" stroke="#C9A45C" strokeOpacity=".44" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        <circle className="hero-flow-motion" r="3.5" fill="#F5F2E8" filter="drop-shadow(0 0 5px #C9A45C)">
          <animateMotion path="M2 12H68" dur="2.7s" begin={delay} repeatCount="indefinite" />
        </circle>
      </svg>
      <svg viewBox="0 0 24 38" className="h-9 w-6 md:hidden">
        <path d="M12 2v30m-6-7 6 7 6-7" fill="none" stroke="#C9A45C" strokeOpacity=".5" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        <circle className="hero-flow-motion" r="3" fill="#F5F2E8" filter="drop-shadow(0 0 4px #C9A45C)">
          <animateMotion path="M12 2V30" dur="2.7s" begin={delay} repeatCount="indefinite" />
        </circle>
      </svg>
    </div>
  );
}

function AssetIcon() {
  return (
    <svg viewBox="0 0 48 48" className="h-9 w-9" fill="none" aria-hidden="true">
      <path d="m24 5 17 10v19L24 43 7 34V15L24 5Z" stroke="currentColor" strokeWidth="1.5" />
      <path d="m7.5 15.5 16.5 9 16.5-9M24 25v18M16 10l17 10" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg viewBox="0 0 48 48" className="h-9 w-9" fill="none" aria-hidden="true">
      <rect x="9" y="21" width="30" height="22" rx="5" stroke="currentColor" strokeWidth="1.7" />
      <path d="M16 21v-7a8 8 0 0 1 16 0v7" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <circle cx="24" cy="31" r="2.5" fill="currentColor" />
      <path d="M24 33.5V37" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

function DeliveryIcon() {
  return (
    <svg viewBox="0 0 48 48" className="h-9 w-9" fill="none" aria-hidden="true">
      <path d="M24 5 40 14v20l-16 9L8 34V14l16-9Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="m16 24 5.5 5.5L33 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function StageCard({
  number,
  label,
  title,
  description,
  icon,
  featured = false,
}: {
  number: string;
  label: string;
  title: string;
  description: string;
  icon: React.ReactNode;
  featured?: boolean;
}) {
  return (
    <div className={`relative flex min-h-[188px] flex-col items-center rounded-2xl border px-5 py-5 text-center shadow-[0_18px_50px_rgba(0,0,0,0.22)] sm:min-h-[205px] sm:px-6 sm:py-6 ${featured ? 'border-[#C9A45C]/40 bg-[linear-gradient(145deg,rgba(201,164,92,0.12),rgba(17,17,15,0.94)_56%)]' : 'border-white/[0.1] bg-[linear-gradient(145deg,rgba(255,255,255,0.045),rgba(14,14,12,0.96)_55%)]'}`}>
      <div className="mb-3 flex w-full items-center justify-between text-[9px] font-bold uppercase tracking-[0.17em] text-[#817D73]">
        <span>{number}</span>
        <span className={featured ? 'text-[#C9A45C]' : ''}>{label}</span>
      </div>
      <div className={`mb-3 flex h-14 w-14 items-center justify-center rounded-xl border ${featured ? 'border-[#C9A45C]/30 bg-[#C9A45C]/[0.08] text-[#E2C17C]' : 'border-white/[0.09] bg-white/[0.025] text-[#C9A45C]'}`}>
        {icon}
      </div>
      <h3 className="text-[14px] font-bold uppercase tracking-[0.12em] text-[#F5F2E8] sm:text-[15px]">{title}</h3>
      <p className="mt-2 max-w-[220px] text-[11px] leading-[1.55] text-[#9D998E] sm:text-[12px]">{description}</p>
    </div>
  );
}

export default function HeroVisual() {
  return (
    <div className="relative mx-auto w-full max-w-[900px]" aria-label="VEILIO auction process: asset escrow, private bids, verified delivery">
      <div aria-hidden="true" className="pointer-events-none absolute inset-x-[12%] top-[16%] h-[70%] rounded-full bg-[#C9A45C]/[0.045] blur-[100px]" />
      <div className="relative grid grid-cols-1 items-center gap-0 md:grid-cols-[1fr_64px_1fr_64px_1fr]">
        <StageCard
          number="01"
          label="Seller"
          title="Asset secured"
          description="NFTs, datasets, licenses and more enter escrow."
          icon={<AssetIcon />}
        />
        <FlowConnector delay="0s" />
        <StageCard
          number="02"
          label="Private auction"
          title="Bids stay sealed"
          description="People and AI agents compete without exposing bids."
          icon={<LockIcon />}
          featured
        />
        <FlowConnector delay="1.2s" />
        <StageCard
          number="03"
          label="On-chain"
          title="Winner receives asset"
          description="Delivery is verified as settlement completes."
          icon={<DeliveryIcon />}
        />
      </div>
    </div>
  );
}
