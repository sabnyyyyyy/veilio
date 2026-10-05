'use client';

import React, { useEffect, useState } from 'react';
import { usePublicClient } from 'wagmi';

import AuctionGrid from '@/components/AuctionGrid';
import { fetchOnchainAuctions } from '@/lib/onchainAuctions';
import type { AuctionItem } from '@/lib/mockAuctions';

export default function AuctionsPage() {
  const publicClient = usePublicClient();

  const [auctions, setAuctions] = useState<AuctionItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!publicClient) {
      setIsLoading(false);
      return;
    }

    const client = publicClient;

    async function loadAuctions() {
      try {
        setIsLoading(true);
        setError(null);

        const data = await fetchOnchainAuctions(client);

        setAuctions(data);
      } catch (err) {
        console.error('Failed to load auctions:', err);
        setError('Failed to load auctions from BNB Chain.');
      } finally {
        setIsLoading(false);
      }
    }

    loadAuctions();
  }, [publicClient]);

  return (
    <div className="pt-12 pb-24 bg-[#0A0A09] min-h-screen">
      <div className="max-w-7xl mx-auto px-6 mb-8">
        <h1 className="text-4xl font-extrabold tracking-tight text-[#F5F2E8] uppercase">
          LIVE AUCTIONS
        </h1>

        <p className="mt-2 text-[#A8A397] text-base">
          Browse active sealed-bid listings. All bids remain private until auction settlement.
        </p>
      </div>

      {isLoading && (
        <div className="max-w-7xl mx-auto px-6 py-20 text-center">
          <p className="text-[#A8A397]">
            Loading auctions from BNB Chain...
          </p>
        </div>
      )}

      {!isLoading && error && (
        <div className="max-w-7xl mx-auto px-6">
          <div className="rounded-2xl border border-red-500/20 bg-red-500/5 p-6">
            <p className="text-red-400">{error}</p>
          </div>
        </div>
      )}

      {!isLoading && !error && auctions.length === 0 && (
        <div className="max-w-7xl mx-auto px-6">
          <div className="rounded-2xl border border-white/10 bg-[#151512] p-12 text-center">
            <h2 className="text-xl font-bold text-[#F5F2E8]">
              No auctions yet
            </h2>

            <p className="mt-2 text-[#A8A397]">
              Create the first auction on BNB Chain.
            </p>
          </div>
        </div>
      )}

      {!isLoading && !error && auctions.length > 0 && (
        <AuctionGrid
          auctions={auctions}
          title=""
          subtitle=""
        />
      )}
    </div>
  );
}