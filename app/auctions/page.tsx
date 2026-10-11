'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { usePublicClient } from 'wagmi';
import { Search, SlidersHorizontal, Bot, ArrowUpDown, X } from 'lucide-react';

import AuctionGrid from '@/components/AuctionGrid';
import { fetchOnchainAuctions } from '@/lib/onchainAuctions';
import { MOCK_AUCTIONS, type AuctionItem } from '@/lib/mockAuctions';

export default function AuctionsPage() {
  const publicClient = usePublicClient();

  const [auctions, setAuctions] = useState<AuctionItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [paginationError, setPaginationError] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [totalAuctions, setTotalAuctions] = useState('0');

  // Filter & Search States
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('all');
  const [license, setLicense] = useState('all');
  const [phase, setPhase] = useState('all');
  const [sortBy, setSortBy] = useState<'ending_soon' | 'newest' | 'most_bidders' | 'price_asc' | 'price_desc'>('ending_soon');
  const [agentOnly, setAgentOnly] = useState(false);
  const [minPrice, setMinPrice] = useState('');
  const [maxPrice, setMaxPrice] = useState('');
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);

  useEffect(() => {
    if (!publicClient) {
      // Offline / Wallet not connected fallback to mock auctions with rich taxonomy
      setAuctions(MOCK_AUCTIONS);
      setTotalAuctions(String(MOCK_AUCTIONS.length));
      setIsLoading(false);
      return;
    }

    const client = publicClient;

    async function loadAuctions() {
      try {
        setIsLoading(true);
        setError(null);

        const page = await fetchOnchainAuctions(client, { limit: 20 });
        if (page.auctions.length > 0) {
          setAuctions(page.auctions);
          setNextCursor(page.nextCursor);
          setTotalAuctions(page.total);
        } else {
          // Fallback to sample digital-asset mock auctions so visitors see active categories
          setAuctions(MOCK_AUCTIONS);
          setTotalAuctions(String(MOCK_AUCTIONS.length));
        }
      } catch (err) {
        console.error('Failed to load on-chain auctions:', err);
        // Fallback to local catalog
        setAuctions(MOCK_AUCTIONS);
        setTotalAuctions(String(MOCK_AUCTIONS.length));
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
    const minVal = minPrice ? parseFloat(minPrice) : null;
    const maxVal = maxPrice ? parseFloat(maxPrice) : null;

    return auctions
      .filter((auction) => {
        const rawType = (auction.assetType || auction.metadata?.category || 'other').toLowerCase();
        const assetCategory = rawType === 'dataset' || rawType === 'data-product'
          ? 'dataset'
          : rawType === 'ai-model' || rawType === 'model'
            ? 'ai-model'
            : rawType === 'data-license'
              ? 'data-license'
              : rawType === 'api-license'
                ? 'api-license'
                : rawType === 'software-license'
                  ? 'software-license'
                  : rawType === 'nft' || rawType.includes('collectible')
                    ? 'nft'
                    : 'digital-asset';

        // Search match
        const matchesSearch = !normalizedSearch || [
          auction.itemName,
          auction.description,
          auction.seller,
          auction.id,
          auction.metadata?.format || '',
          auction.metadata?.region || '',
          auction.metadata?.language || '',
        ].some((val) => val.toLowerCase().includes(normalizedSearch));

        // Category match
        const matchesCategory = category === 'all' || assetCategory === category;

        // Phase match
        const matchesPhase = phase === 'all' || auction.status.toLowerCase() === phase;

        // License match
        const itemLicense = auction.metadata?.licenseType;
        const matchesLicense = license === 'all' || itemLicense === license;

        // Agent-only match
        const matchesAgent = !agentOnly || (auction.metadata?.agentCompatible ?? true);

        // Price match
        const priceNum = parseFloat(auction.startingPrice);
        const matchesMinPrice = minVal === null || (!isNaN(priceNum) && priceNum >= minVal);
        const matchesMaxPrice = maxVal === null || (!isNaN(priceNum) && priceNum <= maxVal);

        return (
          matchesSearch &&
          matchesCategory &&
          matchesPhase &&
          matchesLicense &&
          matchesAgent &&
          matchesMinPrice &&
          matchesMaxPrice
        );
      })
      .sort((a, b) => {
        if (sortBy === 'ending_soon') {
          // Bidding or revealing closing soonest
          const aEnd = a.status === 'Revealing' ? a.revealEndTime : a.commitEndTime;
          const bEnd = b.status === 'Revealing' ? b.revealEndTime : b.commitEndTime;
          return aEnd - bEnd;
        }
        if (sortBy === 'newest') {
          return parseInt(b.id, 10) - parseInt(a.id, 10);
        }
        if (sortBy === 'most_bidders') {
          return b.bidderCount - a.bidderCount;
        }
        if (sortBy === 'price_asc') {
          return parseFloat(a.startingPrice) - parseFloat(b.startingPrice);
        }
        if (sortBy === 'price_desc') {
          return parseFloat(b.startingPrice) - parseFloat(a.startingPrice);
        }
        return 0;
      });
  }, [auctions, category, license, phase, agentOnly, minPrice, maxPrice, search, sortBy]);

  const clearFilters = () => {
    setSearch('');
    setCategory('all');
    setLicense('all');
    setPhase('all');
    setAgentOnly(false);
    setMinPrice('');
    setMaxPrice('');
    setSortBy('ending_soon');
  };

  const hasActiveFilters = category !== 'all' || license !== 'all' || phase !== 'all' || agentOnly || minPrice || maxPrice || search;

  return (
    <div className="pt-12 pb-24 bg-[#0A0A09] min-h-screen">
      {/* Header */}
      <div className="max-w-7xl mx-auto px-6 mb-8">
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
          <div>
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-[#C9A45C]/20 bg-[#C9A45C]/5 text-[10px] font-bold uppercase tracking-widest text-[#C9A45C] mb-3">
              <span className="w-1.5 h-1.5 rounded-full bg-[#C9A45C] animate-pulse" />
              BNB Chain · Sealed-Bid Marketplace
            </div>
            <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-[#F5F2E8] uppercase">
              Digital Asset Auctions
            </h1>
            <p className="mt-2 text-[#A8A397] text-sm max-w-2xl">
              Verifiable commit-reveal auctions for AI datasets, model weights, data licenses, and API credentials.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowAdvancedFilters(!showAdvancedFilters)}
              className={`inline-flex items-center gap-2 px-3.5 py-2 rounded-xl border text-xs font-semibold transition ${
                showAdvancedFilters || hasActiveFilters
                  ? 'border-[#C9A45C] bg-[#C9A45C]/10 text-[#F5F2E8]'
                  : 'border-white/10 bg-[#151512] text-[#A8A397] hover:text-[#F5F2E8]'
              }`}
            >
              <SlidersHorizontal size={14} />
              <span>Filters</span>
              {hasActiveFilters && (
                <span className="w-2 h-2 rounded-full bg-[#C9A45C]" />
              )}
            </button>
          </div>
        </div>
      </div>

      {isLoading && (
        <div className="max-w-7xl mx-auto px-6 py-20 text-center">
          <p className="text-[#A8A397] font-mono text-xs uppercase tracking-widest">
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

      {!isLoading && (
        <div className="max-w-7xl mx-auto px-6">
          {/* Main Discovery Bar */}
          <div className="mb-4 grid grid-cols-1 gap-3 md:grid-cols-[1fr_220px_180px_160px]">
            {/* Search Input */}
            <label className="flex items-center gap-3 rounded-xl border border-white/10 bg-[#151512] px-4">
              <Search size={16} className="shrink-0 text-[#A8A397]" />
              <input
                aria-label="Search loaded auctions"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search datasets, models, formats, licenses, seller..."
                className="w-full bg-transparent py-3 text-xs sm:text-sm text-[#F5F2E8] outline-none placeholder:text-[#77746B]"
              />
              {search && (
                <button onClick={() => setSearch('')} className="text-[#77746B] hover:text-white">
                  <X size={14} />
                </button>
              )}
            </label>

            {/* Category Select */}
            <select
              aria-label="Filter by asset category"
              value={category}
              onChange={(event) => setCategory(event.target.value)}
              className="rounded-xl border border-white/10 bg-[#151512] px-4 py-3 text-xs sm:text-sm text-[#F5F2E8] outline-none focus:border-[#C9A45C]"
            >
              <option value="all">All Asset Categories</option>
              <option value="dataset">Datasets</option>
              <option value="ai-model">AI Models & Weights</option>
              <option value="data-license">Data Licenses</option>
              <option value="api-license">API Access Passes</option>
              <option value="software-license">Software Licenses</option>
              <option value="nft">NFT Escrow</option>
              <option value="digital-asset">Other Digital Assets</option>
            </select>

            {/* Sort Select */}
            <select
              aria-label="Sort auctions"
              value={sortBy}
              onChange={(event) => setSortBy(event.target.value as typeof sortBy)}
              className="rounded-xl border border-white/10 bg-[#151512] px-4 py-3 text-xs sm:text-sm text-[#F5F2E8] outline-none focus:border-[#C9A45C]"
            >
              <option value="ending_soon">Ending Soonest</option>
              <option value="newest">Newest Listed</option>
              <option value="most_bidders">Most Bidders</option>
              <option value="price_asc">Price: Low to High</option>
              <option value="price_desc">Price: High to Low</option>
            </select>

            {/* Phase Select */}
            <select
              aria-label="Filter by auction phase"
              value={phase}
              onChange={(event) => setPhase(event.target.value)}
              className="rounded-xl border border-white/10 bg-[#151512] px-4 py-3 text-xs sm:text-sm text-[#F5F2E8] outline-none focus:border-[#C9A45C]"
            >
              <option value="all">All Phases</option>
              <option value="bidding">Bidding Open</option>
              <option value="revealing">Reveal Phase</option>
              <option value="settled">Settled / Ended</option>
            </select>
          </div>

          {/* Collapsible Advanced Filters Tray */}
          {showAdvancedFilters && (
            <div className="mb-6 p-5 rounded-2xl border border-white/10 bg-[#12120F] grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4 animate-in fade-in duration-200">
              {/* License Filter */}
              <div>
                <label className="block text-[10px] uppercase tracking-widest text-[#A8A397] mb-1.5">License Type</label>
                <select
                  value={license}
                  onChange={(e) => setLicense(e.target.value)}
                  className="w-full rounded-lg border border-white/10 bg-[#0A0A09] px-3 py-2 text-xs text-[#F5F2E8] outline-none focus:border-[#C9A45C]"
                >
                  <option value="all">Any License</option>
                  <option value="commercial_use">Commercial Use</option>
                  <option value="academic_or_research">Academic / Research Only</option>
                  <option value="exclusive_transfer">Exclusive Transfer</option>
                </select>
              </div>

              {/* Price Min/Max */}
              <div className="sm:col-span-2 grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[10px] uppercase tracking-widest text-[#A8A397] mb-1.5">Min Price (BNB)</label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder="0.00"
                    value={minPrice}
                    onChange={(e) => setMinPrice(e.target.value)}
                    className="w-full rounded-lg border border-white/10 bg-[#0A0A09] px-3 py-2 text-xs text-[#F5F2E8] font-mono outline-none focus:border-[#C9A45C]"
                  />
                </div>
                <div>
                  <label className="block text-[10px] uppercase tracking-widest text-[#A8A397] mb-1.5">Max Price (BNB)</label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder="Unlimited"
                    value={maxPrice}
                    onChange={(e) => setMaxPrice(e.target.value)}
                    className="w-full rounded-lg border border-white/10 bg-[#0A0A09] px-3 py-2 text-xs text-[#F5F2E8] font-mono outline-none focus:border-[#C9A45C]"
                  />
                </div>
              </div>

              {/* Agent Filter & Clear Button */}
              <div className="flex flex-col justify-end">
                <label className="flex items-center gap-2.5 p-2 rounded-lg border border-white/10 bg-[#0A0A09] cursor-pointer hover:border-[#C9A45C]/40 transition">
                  <input
                    type="checkbox"
                    checked={agentOnly}
                    onChange={(e) => setAgentOnly(e.target.checked)}
                    className="accent-[#C9A45C]"
                  />
                  <span className="inline-flex items-center gap-1.5 text-xs text-[#E6CC91] font-medium">
                    <Bot size={13} /> AI-Agent Ready Only
                  </span>
                </label>
              </div>
            </div>
          )}

          {/* Matches & Active Filters Summary */}
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3 text-xs text-[#8E8A80]">
            <div>
              Showing <span className="text-[#F5F2E8] font-bold">{filteredAuctions.length}</span> results
              {hasActiveFilters && <span> matching your filters</span>}
              <span> among {auctions.length} loaded auctions ({totalAuctions} total).</span>
            </div>

            {hasActiveFilters && (
              <button
                onClick={clearFilters}
                className="inline-flex items-center gap-1 text-[11px] text-[#C9A45C] hover:text-[#E6CC91] font-semibold transition"
              >
                Reset all filters <X size={12} />
              </button>
            )}
          </div>

          {/* Grid or Empty */}
          {filteredAuctions.length ? (
            <AuctionGrid auctions={filteredAuctions} title="" subtitle="" />
          ) : (
            <div className="rounded-2xl border border-white/10 bg-[#151512] p-12 text-center space-y-4">
              <h2 className="text-xl font-bold text-[#F5F2E8]">No matching digital asset auctions</h2>
              <p className="text-sm text-[#A8A397] max-w-md mx-auto">
                No auctions matched your active filter criteria. Try adjusting your keyword search, category, or price range.
              </p>
              <button
                onClick={clearFilters}
                className="inline-block px-5 py-2.5 rounded-xl bg-[#C9A45C] text-[#0A0A09] text-xs font-bold uppercase tracking-wider hover:bg-[#E6CC91] transition"
              >
                Clear Filters
              </button>
            </div>
          )}

          {nextCursor && (
            <div className="mt-8 text-center">
              {paginationError && <p role="alert" className="mb-3 text-sm text-red-400">{paginationError}</p>}
              <button
                onClick={loadMore}
                disabled={isLoadingMore}
                className="rounded-xl border border-white/15 px-6 py-3 text-xs font-bold uppercase tracking-wider text-[#E6CC91] transition hover:border-[#C9A45C]/50 disabled:opacity-50"
              >
                {isLoadingMore ? 'Loading…' : 'Load more auctions'}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
