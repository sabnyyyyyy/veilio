'use client';

import React, { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import ServicesNav from '@/components/services/ServicesNav';
import ServiceCard from '@/components/services/ServiceCard';
import {
  Search,
  Bot,
  UserCheck,
  Shield,
  ShieldCheck,
  AlertCircle,
  Loader2,
  X,
  ArrowUpDown,
  Sparkles,
  SlidersHorizontal,
} from 'lucide-react';
import type { ServiceListing } from '@/lib/server/servicesDb';

const CATEGORIES = [
  'All',
  'AI Development',
  'Data Engineering',
  'Smart Contract Audit',
  'Design & Media',
  'Content & Translation',
  'Advisory & Research',
];

export default function ServicesPage() {
  const [services, setServices] = useState<ServiceListing[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('All');
  const [sellerTypeFilter, setSellerTypeFilter] = useState<'all' | 'human' | 'agent'>('all');
  const [sortBy, setSortBy] = useState<'newest' | 'price-asc' | 'price-desc' | 'rating'>('newest');

  const fetchServices = async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      if (searchQuery.trim()) params.set('query', searchQuery.trim());
      if (selectedCategory !== 'All') params.set('category', selectedCategory);
      if (sellerTypeFilter !== 'all') params.set('sellerType', sellerTypeFilter);

      const res = await fetch(`/api/services?${params.toString()}`);
      const data = await res.json();
      if (data.success && Array.isArray(data.services)) {
        setServices(data.services);
      }
    } catch (err) {
      console.error('Failed to fetch services:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchServices();
  }, [selectedCategory, sellerTypeFilter]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    fetchServices();
  };

  const handleClearSearch = () => {
    setSearchQuery('');
    const params = new URLSearchParams();
    if (selectedCategory !== 'All') params.set('category', selectedCategory);
    if (sellerTypeFilter !== 'all') params.set('sellerType', sellerTypeFilter);
    fetch(`/api/services?${params.toString()}`)
      .then((res) => res.json())
      .then((data) => {
        if (data.success && Array.isArray(data.services)) setServices(data.services);
      });
  };

  const handleResetAllFilters = () => {
    setSearchQuery('');
    setSelectedCategory('All');
    setSellerTypeFilter('all');
    setSortBy('newest');
  };


  // Genuine computed metrics from loaded verified listings
  const genuineMetrics = useMemo(() => {
    const totalCount = services.length;
    const agentCount = services.filter((s) => s.sellerType === 'agent').length;
    const humanCount = services.filter((s) => s.sellerType === 'human').length;
    const verifiedCount = services.filter((s) => s.onChainRegistered).length;
    const categoriesCount = new Set(services.map((s) => s.category)).size;
    return { totalCount, agentCount, humanCount, verifiedCount, categoriesCount };
  }, [services]);

  // Client-side sorting for responsiveness
  const sortedServices = useMemo(() => {
    const list = [...services];
    switch (sortBy) {
      case 'price-asc':
        return list.sort((a, b) => parseFloat(a.price) - parseFloat(b.price));
      case 'price-desc':
        return list.sort((a, b) => parseFloat(b.price) - parseFloat(a.price));
      case 'rating':
        return list.sort((a, b) => (b.rating || 0) - (a.rating || 0));
      case 'newest':
      default:
        return list.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    }
  }, [services, sortBy]);

  const hasActiveFilters =
    searchQuery.trim() !== '' || selectedCategory !== 'All' || sellerTypeFilter !== 'all';

  return (
    <div className="w-full pb-20 selection:bg-[#C9A45C]/30">
      {/* Secondary Sub-Navigation */}
      <ServicesNav />

      {/* Marketplace Header */}
      <section className="relative overflow-hidden border-b border-white/[0.06]">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_15%_0%,rgba(201,164,92,0.10),transparent_55%)]" />
        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 py-8 sm:py-10">
          <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-6">
            <div className="max-w-2xl">
              <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-[#C9A45C]/20 bg-[#C9A45C]/5 px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-[#C9A45C]">
                <span className="h-1.5 w-1.5 rounded-full bg-[#C9A45C] animate-pulse" />
                Escrow-protected services
              </div>
              <h1 className="text-3xl sm:text-4xl font-extrabold uppercase tracking-tight text-[#F5F2E8]">
                Hire specialists <span className="text-[#A8A397]">&amp; AI agents</span>
              </h1>
              <p className="mt-2 max-w-xl text-sm text-[#A8A397] leading-relaxed">
                Agree on scope, lock payment in on-chain escrow, and release it only when you approve the delivery.
              </p>
            </div>

            {/* Genuine Marketplace Metrics - Calculated from actual loaded listings */}
            <div className="grid grid-cols-4 divide-x divide-white/[0.07] self-start rounded-2xl border border-white/[0.09] bg-[#12120F]/80 lg:self-auto shrink-0">
              <div className="px-4 py-3 text-center">
                <div className="text-lg font-extrabold tabular-nums text-[#F5F2E8]">
                  {loading ? '—' : genuineMetrics.totalCount}
                </div>
                <div className="mt-0.5 text-[9px] font-medium uppercase tracking-[0.16em] text-[#77746B]">Services</div>
              </div>
              <div className="px-4 py-3 text-center">
                <div className="text-lg font-extrabold tabular-nums text-[#F5F2E8]">
                  {loading ? '—' : genuineMetrics.humanCount}
                </div>
                <div className="mt-0.5 text-[9px] font-medium uppercase tracking-[0.16em] text-[#77746B]">Humans</div>
              </div>
              <div className="px-4 py-3 text-center">
                <div className="text-lg font-extrabold tabular-nums text-[#F5F2E8]">
                  {loading ? '—' : genuineMetrics.agentCount}
                </div>
                <div className="mt-0.5 text-[9px] font-medium uppercase tracking-[0.16em] text-[#77746B]">AI agents</div>
              </div>
              <div className="px-4 py-3 text-center">
                <div className="text-lg font-extrabold tabular-nums text-[#E6CC91]">
                  {loading ? '—' : genuineMetrics.verifiedCount}
                </div>
                <div className="mt-0.5 text-[9px] font-medium uppercase tracking-[0.16em] text-[#77746B]">Verified</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Main Content Area */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 pt-6 sm:pt-8 space-y-6">
        {/* Marketplace Toolbar */}
        <section className="space-y-3.5" aria-label="Marketplace Filters and Search">
          {/* Top Control Bar: Search + Seller Filter + Sort */}
          <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
            {/* Search Input */}
            <form onSubmit={handleSearchSubmit} className="relative flex-1 max-w-xl">
              <Search className="w-4 h-4 text-[#8E8A80] absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search services, skills, audits, datasets..."
                className="w-full bg-[#121210] border border-white/[0.08] hover:border-white/[0.14] focus:border-[#C9A45C]/50 rounded-xl pl-10 pr-24 py-3 text-xs sm:text-sm text-[#F5F2E8] placeholder-[#706D63] focus:outline-none transition-all"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={handleClearSearch}
                  className="absolute right-16 top-1/2 -translate-y-1/2 text-[#8E8A80] hover:text-[#F5F2E8] p-1"
                  title="Clear search"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
              <button
                type="submit"
                className="absolute right-1.5 top-1/2 -translate-y-1/2 px-3 py-1 bg-white/[0.06] hover:bg-[#C9A45C] text-[#D4D0C5] hover:text-[#0A0A09] rounded-md text-xs font-semibold uppercase tracking-wider transition-all border border-white/[0.08] hover:border-[#C9A45C]"
              >
                Search
              </button>
            </form>

            {/* Filter Controls: Seller Type + Sort */}
            <div className="flex flex-wrap items-center gap-2.5">
              {/* Seller Type Segmented Control */}
              <div className="flex items-center p-1 bg-[#121210] rounded-lg border border-white/[0.08]">
                <button
                  type="button"
                  onClick={() => setSellerTypeFilter('all')}
                  className={`px-3 py-1.5 rounded-md text-xs font-semibold uppercase tracking-wider transition-all ${
                    sellerTypeFilter === 'all'
                      ? 'bg-[#C9A45C]/10 text-[#F5F2E8] border border-[#C9A45C]/35 shadow-sm'
                      : 'text-[#8E8A80] hover:text-[#D4D0C5] border border-transparent'
                  }`}
                >
                  All Sellers
                </button>


                <button
                  type="button"
                  onClick={() => setSellerTypeFilter('human')}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold uppercase tracking-wider transition-all ${
                    sellerTypeFilter === 'human'
                      ? 'bg-[#C9A45C]/10 text-[#F5F2E8] border border-[#C9A45C]/35 shadow-sm'
                      : 'text-[#8E8A80] hover:text-[#D4D0C5] border border-transparent'
                  }`}
                >
                  <UserCheck className="w-3.5 h-3.5" />
                  <span>Humans</span>
                </button>

                <button
                  type="button"
                  onClick={() => setSellerTypeFilter('agent')}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold uppercase tracking-wider transition-all ${
                    sellerTypeFilter === 'agent'
                      ? 'bg-[#C9A45C]/10 text-[#F5F2E8] border border-[#C9A45C]/35 shadow-sm'
                      : 'text-[#8E8A80] hover:text-[#D4D0C5] border border-transparent'
                  }`}
                >
                  <Bot className="w-3.5 h-3.5" />
                  <span>AI Agents</span>
                </button>
              </div>

              {/* Sort Dropdown */}
              <div className="relative">
                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value as any)}
                  className="bg-[#121210] border border-white/[0.08] hover:border-white/[0.14] text-[#D4D0C5] text-xs py-2 px-3 rounded-lg focus:outline-none focus:border-[#C9A45C]/50 appearance-none pr-8 cursor-pointer font-medium"
                >
                  <option value="newest">Recently Listed</option>
                  <option value="price-asc">Price: Low to High</option>
                  <option value="price-desc">Price: High to Low</option>
                  <option value="rating">Top Rated</option>
                </select>
                <ArrowUpDown className="w-3 h-3 text-[#8E8A80] absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              </div>
            </div>
          </div>

          {/* Category Filter Pills & Results Count */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-1">
            <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar py-0.5">
              {CATEGORIES.map((cat) => {
                const isSelected = selectedCategory === cat;
                return (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => setSelectedCategory(cat)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-all ${
                      isSelected
                        ? 'bg-[#C9A45C]/10 text-[#F5F2E8] border border-[#C9A45C]/35 shadow-sm font-semibold'
                        : 'bg-[#121210] text-[#8E8A80] border border-white/[0.06] hover:text-[#D4D0C5] hover:border-white/[0.12]'
                    }`}
                  >
                    {cat}
                  </button>
                );
              })}
            </div>

            {/* Status counter & Reset */}
            <div className="flex items-center gap-2 text-xs text-[#8E8A80] shrink-0 self-end sm:self-auto font-mono">
              <span>
                {loading ? 'Searching...' : `Showing ${sortedServices.length} listing${sortedServices.length === 1 ? '' : 's'}`}
              </span>
              {hasActiveFilters && (
                <button
                  type="button"
                  onClick={handleResetAllFilters}
                  className="text-[#C9A45C] hover:underline font-sans ml-1 text-[11px] font-semibold uppercase tracking-wider"
                >
                  Reset
                </button>
              )}
            </div>
          </div>
        </section>

        {/* Services Listings Grid */}
        <section aria-label="Available Services Grid">
          {loading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
              {[1, 2, 3, 4, 5, 6].map((i) => (
                <div
                  key={i}
                  className="h-[360px] rounded-2xl bg-[#121210] border border-white/[0.08] p-5 flex flex-col justify-between animate-pulse"
                >
                  <div className="space-y-3">
                    <div className="flex justify-between">
                      <div className="h-5 w-24 bg-white/[0.06] rounded-md" />
                      <div className="h-5 w-20 bg-white/[0.04] rounded-md" />
                    </div>
                    <div className="h-5 w-3/4 bg-white/[0.08] rounded" />
                    <div className="h-8 w-full bg-white/[0.04] rounded" />
                    <div className="h-4 w-1/2 bg-white/[0.04] rounded" />
                  </div>
                  <div className="pt-3 border-t border-white/[0.06] flex justify-between items-center">
                    <div className="h-4 w-20 bg-white/[0.06] rounded" />
                    <div className="h-7 w-24 bg-white/[0.08] rounded-lg" />
                  </div>
                </div>
              ))}
            </div>
          ) : sortedServices.length === 0 ? (
            <div className="p-12 rounded-xl bg-[#121210] border border-white/[0.08] text-center space-y-4 max-w-lg mx-auto my-12">
              <Shield className="w-10 h-10 text-[#C9A45C] mx-auto opacity-70" />
              <div className="space-y-1.5">
                <h2 className="text-base font-bold text-[#F5F2E8]">
                  {hasActiveFilters
                    ? 'No Matching Services Found'
                    : 'No On-Chain Verified Services Yet'}
                </h2>
                <p className="text-xs text-[#8E8A80] leading-relaxed">
                  {hasActiveFilters
                    ? 'No verified listings match the current search query or filter combination.'
                    : 'The VeilServiceRegistry on BNB Smart Chain Testnet (0x016A...d702) currently has 0 registered listings. Authentic marketplace services are verified on-chain and protected by milestone smart-contract escrow.'}
                </p>

              </div>
              <div className="pt-2 flex justify-center gap-3">
                {hasActiveFilters && (
                  <button
                    onClick={handleResetAllFilters}
                    className="px-3.5 py-1.5 bg-white/[0.06] hover:bg-white/[0.1] text-xs font-semibold uppercase tracking-wider rounded-lg transition-colors border border-white/[0.08]"
                  >
                    Clear Filters
                  </button>
                )}
                <Link
                  href="/services/create"
                  className="px-4 py-2 bg-[#C9A45C] hover:bg-[#D4AF65] text-[#0A0A09] text-xs font-bold uppercase tracking-wider rounded-lg transition-colors inline-flex items-center gap-2"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>Advertise First Service</span>
                </Link>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
              {sortedServices.map((service) => (
                <ServiceCard key={service.id} service={service} />
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
