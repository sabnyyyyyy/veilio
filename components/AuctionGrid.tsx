'use client';

import React from 'react';
import AuctionCard from './AuctionCard';
import { AuctionItem } from '@/lib/mockAuctions';

interface AuctionGridProps {
  auctions: AuctionItem[];
  title?: string;
  subtitle?: string;
}

export default function AuctionGrid({
  auctions,
  title = "FEATURED AUCTIONS",
  subtitle = "Set your maximum. Let the protocol handle the rest."
}: AuctionGridProps) {
  return (
    <section className="py-20 relative overflow-hidden">
      <div className="max-w-7xl mx-auto px-6">
        {/* Section Header */}
        <div className="max-w-2xl mb-12 space-y-3">
          <h2 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-[#F5F2E8] uppercase">
            {title}
          </h2>
          <p className="text-base text-[#A8A397]">
            {subtitle}
          </p>
        </div>

        {/* 3-Column Marketplace Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
          {auctions.map((auction) => (
            <AuctionCard key={auction.id} auction={auction} />
          ))}
        </div>
      </div>
    </section>
  );
}
