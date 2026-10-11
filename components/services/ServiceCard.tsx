'use client';

import React from 'react';
import Link from 'next/link';
import { Bot, UserCheck, Clock, ArrowRight, ShieldCheck, AlertCircle } from 'lucide-react';
import type { ServiceListing } from '@/lib/server/servicesDb';

interface ServiceCardProps {
  service: ServiceListing;
}

export default function ServiceCard({ service }: ServiceCardProps) {
  const isAgent = service.sellerType === 'agent';
  const sellerDisplayName = service.sellerName || `${service.sellerId.slice(0, 6)}...${service.sellerId.slice(-4)}`;
  const sellerInitial = (service.sellerName || service.sellerId.slice(2, 4)).charAt(0).toUpperCase();

  return (
    <div className="group rounded-xl bg-[#121210] hover:bg-[#151513] border border-white/[0.08] hover:border-[#C9A45C]/40 p-5 flex flex-col justify-between transition-all duration-200 hover:shadow-xl hover:shadow-black/50">
      <div className="space-y-3">
        {/* Top Badges */}
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-1.5 flex-wrap">
            {isAgent ? (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-cyan-500/10 text-cyan-300 border border-cyan-500/20 rounded-md text-[11px] font-semibold tracking-wide">
                <Bot className="w-3.5 h-3.5 text-cyan-400" />
                <span>AI Agent</span>
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-emerald-500/10 text-emerald-300 border border-emerald-500/20 rounded-md text-[11px] font-semibold tracking-wide">
                <UserCheck className="w-3.5 h-3.5 text-emerald-400" />
                <span>Human Expert</span>
              </span>
            )}

            {service.onChainRegistered && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-[#C9A45C]/10 text-[#C9A45C] border border-[#C9A45C]/30 rounded-md text-[10px] font-mono font-medium">
                <ShieldCheck className="w-3 h-3 text-[#C9A45C]" />
                <span>On-Chain Verified</span>
              </span>
            )}

          </div>

          <span className="text-[10px] font-mono uppercase tracking-wider text-[#8E8A80] bg-white/[0.03] px-2.5 py-1 rounded-md border border-white/[0.06]">
            {service.category}
          </span>
        </div>


        {/* Title */}
        <Link href={`/services/${service.id}`} className="block group-hover:text-[#E6CC91] transition-colors">
          <h3 className="text-[15px] font-bold text-[#F5F2E8] leading-snug line-clamp-2 min-h-[44px]">
            {service.title}
          </h3>
        </Link>

        {/* Description */}
        <p className="text-xs text-[#8E8A80] leading-relaxed line-clamp-2 min-h-[34px]">
          {service.description}
        </p>

        {/* Seller Info & Reputation */}
        <div className="pt-3 border-t border-white/[0.06] flex items-center justify-between text-xs">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-5 h-5 rounded-full bg-white/[0.08] border border-white/[0.1] flex items-center justify-center text-[10px] font-bold text-[#D4D0C5] shrink-0">
              {sellerInitial}
            </div>
            <span className="truncate max-w-[120px] text-[#D4D0C5] text-xs font-medium">
              {sellerDisplayName}
            </span>
            {service.onChainRegistered && (
              <span title="On-Chain Verified Registry" className="shrink-0 text-[#C9A45C]">
                <ShieldCheck className="w-3.5 h-3.5" />
              </span>
            )}
          </div>

          <div className="flex items-center gap-1 text-[#D8B46C] text-xs font-semibold shrink-0">
            {service.ordersCompleted && service.ordersCompleted > 0 ? (
              <span className="text-[11px] font-medium text-[#C9A45C]">
                {service.ordersCompleted} orders
              </span>
            ) : (
              <span className="text-[10px] text-[#706D63] font-normal uppercase tracking-wider">
                New Seller
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Bottom Footer: Delivery Time, Price, & Action */}
      <div className="pt-4 mt-4 border-t border-white/[0.06] flex items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-1.5 text-[11px] text-[#8E8A80] font-mono">
            <Clock className="w-3 h-3 text-[#C9A45C]/80" />
            <span>{service.deliveryTime}</span>
          </div>
          <div className="text-[15px] font-extrabold text-[#F5F2E8] tracking-tight">
            {service.price} <span className="text-xs text-[#C9A45C] font-mono font-semibold">{service.currency}</span>
          </div>
        </div>

        <Link
          href={`/services/${service.id}`}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white/[0.04] group-hover:bg-[#C9A45C] text-[#D4D0C5] group-hover:text-[#0A0A09] text-xs font-semibold uppercase tracking-wider rounded-lg transition-all border border-white/[0.08] group-hover:border-[#C9A45C] shrink-0"
        >
          <span>View Service</span>
          <ArrowRight className="w-3 h-3" />
        </Link>
      </div>
    </div>
  );
}
