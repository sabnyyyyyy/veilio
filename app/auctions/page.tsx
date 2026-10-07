'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { usePublicClient } from 'wagmi';
import { Search } from 'lucide-react';

import AuctionGrid from '@/components/AuctionGrid';
import { fetchOnchainAuctions } from '@/lib/onchainAuctions';
import type { AuctionItem } from '@/lib/mockAuctions';

export default function AuctionsPage() {
  const publicClient = usePublicClient();

  const [auctions, setAuctions] = useState<AuctionItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [paginationError, setPaginationError] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [totalAuctions, setTotalAuctions] = useState('0');
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('all');
  const [phase, setPhase] = useState('all');

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

        const page = await fetchOnchainAuctions(client, { limit: 20 });
        setAuctions(page.auctions);
        setNextCursor(page.nextCursor);
        setTotalAuctions(page.total);
      } catch (err) {
        console.error('Failed to load auctions:', err);
        setError('Failed to load auctions from BNB Chain.');
      } finally {
        setIsLoading(false);
      }
    }

    loadAuctions();
  }, [publicClient]);

  async function loadMore() {
    if (!publicClient || !nextCursor || isLoadingMore) return;
    setIsLoadingMore(true);
    setPaginationError(null);
    try {
      const page = await fetchOnchainAuctions(publicClient, { cursor: nextCursor, limit: 20 });
      setAuctions((current) => [...current, ...page.auctions]);
      setNextCursor(page.nextCursor);
    } catch (err) {
      console.error('Failed to load more auctions:', err);
      setPaginationError('Could not load the next auction page. Please retry.');
    } finally {
      setIsLoadingMore(false);
    }
  }

  const filteredAuctions = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();
    return auctions.filter((auction) => {
      const assetType = (auction.assetType || 'other').toLowerCase();
      const assetCategory = assetType === 'dataset' || assetType === 'data-product'
        ? 'dataset'
        : assetType === 'ai-model' || assetType === 'model'
          ? 'ai-model'
          : assetType.includes('license') || assetType.includes('licence')
            ? 'license'
            : assetType === 'nft' || assetType.includes('collectible')
              ? 'nft'
              : 'other';
      const matchesSearch = !normalizedSearch || [auction.itemName, auction.description, auction.seller, auction.id]
        .some((value) => value.toLowerCase().includes(normalizedSearch));
      const matchesCategory = category === 'all' || assetCategory === category;
      const matchesPhase = phase === 'all' || auction.status.toLowerCase() === phase;
      return matchesSearch && matchesCategory && matchesPhase;
    });
  }, [auctions, category, phase, search]);

  return (
    <div className="pt-12 pb-24 bg-[#0A0A09] min-h-screen">
      <div className="max-w-7xl mx-auto px-6 mb-8">
        <h1 className="text-4xl font-extrabold tracking-tight text-[#F5F2E8] uppercase">
          LIVE AUCTIONS
        </h1>

        <p className="mt-2 text-[#A8A397] text-base">
          Find datasets, AI models, licenses, NFTs, and other digital assets. Bid commitments, deposits, and auction outcomes are recorded on BNB Chain.
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
        <div className="max-w-7xl mx-auto px-6">
          <div className="mb-6 grid grid-cols-1 gap-3 md:grid-cols-[minmax(220px,1fr)_220px_190px]">
            <label className="flex items-center gap-3 rounded-xl border border-white/10 bg-[#151512] px-4">
              <Search size={17} className="shrink-0 text-[#A8A397]" />
              <input aria-label="Search loaded auctions" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search title, description, seller, or ID" className="w-full bg-transparent py-3 text-sm text-[#F5F2E8] outline-none placeholder:text-[#77746B]" />
            </label>
            <select aria-label="Filter by asset category" value={category} onChange={(event) => setCategory(event.target.value)} className="rounded-xl border border-white/10 bg-[#151512] px-4 py-3 text-sm text-[#F5F2E8] outline-none focus:border-[#C9A45C]">
              <option value="all">All asset categories</option>
              <option value="dataset">Datasets &amp; data products</option>
              <option value="ai-model">AI models</option>
              <option value="license">Licenses</option>
              <option value="nft">NFTs &amp; collectibles</option>
              <option value="other">Other digital assets</option>
            </select>
            <select aria-label="Filter by auction phase" value={phase} onChange={(event) => setPhase(event.target.value)} className="rounded-xl border border-white/10 bg-[#151512] px-4 py-3 text-sm text-[#F5F2E8] outline-none focus:border-[#C9A45C]">
              <option value="all">All phases</option>
              <option value="bidding">Bidding open</option>
              <option value="revealing">Reveal phase</option>
              <option value="settled">Ended / settled</option>
            </select>
          </div>
          <p className="mb-2 text-xs text-[#8E8A80]">Showing {filteredAuctions.length} matches among {auctions.length} loaded auctions ({totalAuctions} total). Search and filters apply to loaded pages.</p>
          {filteredAuctions.length ? (
            <AuctionGrid auctions={filteredAuctions} title="" subtitle="" />
          ) : (
            <div className="rounded-2xl border border-white/10 bg-[#151512] p-10 text-center">
              <h2 className="text-lg font-bold text-[#F5F2E8]">No matching auctions</h2>
              <p className="mt-2 text-sm text-[#A8A397]">Try another search or category filter.</p>
            </div>
          )}
          {nextCursor && (
            <div className="mt-8 text-center">
              {paginationError && <p role="alert" className="mb-3 text-sm text-red-400">{paginationError}</p>}
              <button onClick={loadMore} disabled={isLoadingMore} className="rounded-xl border border-white/15 px-6 py-3 text-xs font-bold uppercase tracking-wider text-[#E6CC91] transition hover:border-[#C9A45C]/50 disabled:opacity-50">
                {isLoadingMore ? 'Loading…' : 'Load more auctions'}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
