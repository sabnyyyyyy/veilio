'use client';

import React from 'react';
import Link from 'next/link';
import { Bot, UserCheck, Clock3, ArrowUpRight, ShieldCheck, PackageCheck } from 'lucide-react';
import type { ServiceListing } from '@/lib/server/servicesDb';
import ChainLogo, { chainInfo } from '@/components/ChainLogo';

interface ServiceCardProps {
  service: ServiceListing;
}

export default function ServiceCard({ service }: ServiceCardProps) {
  const isAgent = service.sellerType === 'agent';
  const sellerDisplayName = service.sellerName || `${service.sellerId.slice(0, 6)}...${service.sellerId.slice(-4)}`;
  const sellerInitial = (service.sellerName || service.sellerId.slice(2, 4)).charAt(0).toUpperCase();
  const shortSeller = `${service.sellerId.slice(0, 6)}…${service.sellerId.slice(-4)}`;
  const deliverables = service.sampleDeliverables?.filter(Boolean) ?? [];

  return (
    <Link
      href={`/services/${service.id}`}
      className="group relative flex h-full flex-col overflow-hidden rounded-2xl border border-white/[0.09] bg-[#12120F] shadow-[0_12px_40px_rgba(0,0,0,0.18)] transition duration-300 hover:-translate-y-1 hover:border-[#C9A45C]/35 hover:shadow-[0_20px_55px_rgba(0,0,0,0.34)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#C9A45C]"
    >
      {/* Header band */}
      <div className="relative overflow-hidden border-b border-white/[0.06] bg-[radial-gradient(ellipse_at_15%_0%,rgba(201,164,92,0.14),transparent_60%),linear-gradient(145deg,#171912_0%,#10110F_70%)] px-4 pb-4 pt-3.5 sm:px-5">
        <div className="flex items-center justify-between gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-lg border border-white/[0.12] bg-[#0A0A09]/70 px-2.5 py-1 text-[9px] font-semibold uppercase tracking-[0.14em] text-[#E6CC91]">
            {service.category}
          </span>
          {service.onChainRegistered && (
            <span className="inline-flex items-center gap-1 rounded-full border border-[#C9A45C]/30 bg-[#0A0A09]/70 px-2.5 py-1 text-[9px] font-medium text-[#C9A45C]">
              <ShieldCheck size={11} aria-hidden="true" />
              On-chain verified
            </span>
          )}
        </div>

        <h3 className="mt-4 line-clamp-2 min-h-[44px] text-base font-semibold leading-snug text-[#F5F2E8] transition-colors group-hover:text-[#E6CC91]">
          {service.title}
        </h3>
      </div>

      <div className="flex flex-1 flex-col p-4 sm:p-5">
        <p className="line-clamp-3 min-h-[54px] text-xs leading-relaxed text-[#918D82]">{service.description}</p>

        {deliverables.length > 0 && (
          <ul className="mt-3 space-y-1">
            {deliverables.slice(0, 2).map((item) => (
              <li key={item} className="flex items-center gap-1.5 truncate text-[11px] text-[#C7C2B7]">
                <PackageCheck size={12} className="shrink-0 text-[#C9A45C]/80" aria-hidden="true" />
                <span className="truncate">{item}</span>
              </li>
            ))}
          </ul>
        )}

        {/* Key facts */}
        <div className="mt-4 grid grid-cols-2 gap-3 border-y border-white/[0.07] py-3">
          <div>
            <span className="block text-[9px] font-medium uppercase tracking-[0.16em] text-[#77746B]">Fixed price</span>
            <span className="mt-0.5 block text-sm font-semibold tabular-nums text-[#F5F2E8]">
              {service.price}{' '}
              <span className="inline-flex items-center gap-1 text-[11px] font-medium text-[#A8A397]">
                <ChainLogo network={service.network} size={12} />
                {service.currency}
              </span>
            </span>
          </div>
          <div className="text-right">
            <span className="block text-[9px] font-medium uppercase tracking-[0.16em] text-[#77746B]">Delivery</span>
            <span className="mt-0.5 inline-flex items-center justify-end gap-1.5 text-sm font-semibold text-[#F5F2E8]">
              <Clock3 size={13} className="text-[#A8A397]" aria-hidden="true" />
              {service.deliveryTime}
            </span>
          </div>
        </div>

        {/* Seller */}
        <div className="mt-3 flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[#C9A45C]/25 bg-[#C9A45C]/[0.08] text-xs font-bold text-[#E6CC91]">
              {sellerInitial}
            </div>
            <div className="min-w-0">
              <span className="block truncate text-xs font-medium text-[#D4D0C5]">{sellerDisplayName}</span>
              <span className="inline-flex items-center gap-1 text-[10px] text-[#89867D]">
                {isAgent ? <Bot size={11} aria-hidden="true" /> : <UserCheck size={11} aria-hidden="true" />}
                {isAgent ? 'AI agent' : 'Human expert'}
                <span className="text-white/20">·</span>
                <span className="font-mono">{shortSeller}</span>
              </span>
            </div>
          </div>
          <span className="shrink-0 text-[10px] text-[#89867D]">
            {service.ordersCompleted && service.ordersCompleted > 0 ? (
              <span className="font-semibold text-[#C9A45C]">{service.ordersCompleted} orders</span>
            ) : (
              'New seller'
            )}
          </span>
        </div>

        <div className="mt-auto flex items-center justify-between gap-3 border-t border-white/[0.05] pt-3.5">
          <span className="inline-flex items-center gap-1.5 text-[10px] text-[#89867D]">
            <ChainLogo network={service.network} size={13} />
            {chainInfo(service.network).name} · Escrow protected
          </span>
          <span className="inline-flex shrink-0 items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.12em] text-[#D5B267] transition-all group-hover:gap-2">
            View service
            <ArrowUpRight size={13} aria-hidden="true" />
          </span>
        </div>
      </div>
    </Link>
  );
}
