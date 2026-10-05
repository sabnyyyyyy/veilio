'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { formatEther } from 'viem';
import { useAccount, usePublicClient } from 'wagmi';
import WalletButton from '@/components/WalletButton';
import { fetchUserAuctions, UserAuctionItem } from '@/lib/userAuctions';
import { VEIL_V3_ABI, VEIL_V3_CONTRACT_ADDRESS } from '@/lib/contract';

interface AnalyticsListing extends UserAuctionItem {
  views: number; dailyViews: Record<string, number>; reveals: number; winner: string; winningPrice: string; state: number; escrowStatus: string;
}

const stateNames = ['Created', 'Bidding', 'Revealing', 'Inspection', 'Refund requested', 'Under review', 'Completed', 'Refunded', 'Cancelled'];

export default function SellerAnalyticsPage() {
  const { address, isConnected } = useAccount();
  const publicClient = usePublicClient();
  const [rows, setRows] = useState<AnalyticsListing[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!address || !publicClient) { setLoading(false); return; }
      setLoading(true); setError('');
      try {
        const auctions = await fetchUserAuctions(publicClient, address);
        const enriched = await Promise.all(auctions.map(async (auction) => {
          const [raw, viewRes] = await Promise.all([
            publicClient.readContract({ address: VEIL_V3_CONTRACT_ADDRESS, abi: VEIL_V3_ABI, functionName: 'auctions', args: [BigInt(auction.id)] }) as Promise<readonly unknown[]>,
            fetch(`/api/analytics/views?auctionId=${encodeURIComponent(auction.id)}`).then(r => r.json()).catch(() => null),
          ]);
          const state = Number(raw[10] || 0);
          return { ...auction, views: Number(viewRes?.stats?.totalViews || 0), dailyViews: viewRes?.stats?.daily || {}, reveals: Number(raw[14] || 0), winner: String(raw[11] || ''), winningPrice: formatEther((raw[12] as bigint) || BigInt(0)), state, escrowStatus: stateNames[state] || 'Unknown' };
        }));
        if (!cancelled) setRows(enriched);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load seller analytics.');
      } finally { if (!cancelled) setLoading(false); }
    }
    void load();
    return () => { cancelled = true; };
  }, [address, publicClient]);

  const totals = useMemo(() => ({
    views: rows.reduce((sum, row) => sum + row.views, 0),
    bidders: rows.reduce((sum, row) => sum + row.bidderCount, 0),
    reveals: rows.reduce((sum, row) => sum + row.reveals, 0),
    active: rows.filter(row => row.state === 0 || row.state === 1 || row.state === 2).length,
    completed: rows.filter(row => row.state === 6).length,
    earned: rows.filter(row => row.state === 6).reduce((sum, row) => sum + Number(row.winningPrice) * 0.9, 0),
  }), [rows]);
  const dailyTrend = useMemo(() => Array.from({ length: 7 }, (_, offset) => {
    const date = new Date(); date.setUTCDate(date.getUTCDate() - (6 - offset));
    const key = date.toISOString().slice(0, 10);
    return { key, label: key.slice(5), count: rows.reduce((sum, row) => sum + (row.dailyViews[key] || 0), 0) };
  }), [rows]);

  if (!isConnected || !address) return <div className="min-h-screen bg-[#0A0A09] flex flex-col items-center justify-center gap-4"><h1 className="text-2xl font-bold">Connect seller wallet</h1><WalletButton /></div>;

  return <div className="min-h-screen bg-[#0A0A09] pt-28 pb-20 px-6"><div className="max-w-7xl mx-auto space-y-8">
    <div className="flex flex-wrap justify-between items-end gap-4"><div><p className="text-xs uppercase tracking-widest text-[#C9A45C]">Seller workspace</p><h1 className="text-4xl font-bold mt-2">Analytics</h1><p className="text-sm text-[#A8A397] mt-2">Listing attention and auction outcomes from this wallet.</p></div><Link href="/my-auctions" className="px-4 py-3 border border-white/10 text-xs uppercase tracking-wider">Manage auctions</Link></div>
    {loading ? <p className="text-[#A8A397]">Loading blockchain and view analytics…</p> : error ? <div className="p-4 border border-rose-500/30 text-rose-300">{error}</div> : <>
      <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">{[['Unique listing viewers', totals.views], ['Auction participants', totals.bidders], ['Revealed bids', totals.reveals], ['Active auctions', totals.active], ['Completed sales', totals.completed], ['Seller proceeds*', `${totals.earned.toFixed(4)} BNB`]].map(([label, value]) => <div key={String(label)} className="p-5 bg-[#151512] border border-white/10"><div className="text-[10px] uppercase tracking-wider text-[#A8A397]">{label}</div><div className="text-xl font-bold mt-2 text-[#E6CC91]">{value}</div></div>)}</div>
      <div className="p-6 bg-[#151512] border border-white/10"><h2 className="text-xs uppercase tracking-widest text-[#A8A397] mb-5">New unique viewers · last 7 days</h2><div className="grid grid-cols-7 gap-3 items-end h-28">{dailyTrend.map(day=><div key={day.key} className="h-full flex flex-col justify-end items-center gap-2"><div className="text-[10px] text-[#E6CC91]">{day.count || ''}</div><div className="w-full max-w-12 bg-[#C9A45C]/80 rounded-t" style={{ height: `${Math.max(day.count ? 12 : 2, day.count / Math.max(...dailyTrend.map(d => d.count), 1) * 70)}%` }} /><div className="text-[10px] text-[#A8A397]">{day.label}</div></div>)}</div></div>
      <p className="text-[11px] text-[#A8A397]">*Estimated at 90% of completed winning prices. Pending withdrawals and refunds are not included.</p>
      {rows.length === 0 ? <div className="p-10 bg-[#151512] border border-white/10 text-center text-[#A8A397]">No auctions created by this wallet yet.</div> : <div className="overflow-x-auto border border-white/10"><table className="w-full text-sm"><thead className="bg-[#151512] text-left text-[10px] uppercase tracking-wider text-[#A8A397]"><tr>{['Listing', 'Views', 'Participants', 'Reveals', 'Winning price', 'Escrow / settlement', ''].map(x=><th key={x} className="px-4 py-4">{x}</th>)}</tr></thead><tbody>{rows.map(row=><tr key={row.id} className="border-t border-white/10"><td className="px-4 py-4"><div className="font-semibold">{row.itemName}</div><div className="text-xs text-[#A8A397]">Auction #{row.id}</div></td><td className="px-4 py-4">{row.views}</td><td className="px-4 py-4">{row.bidderCount}</td><td className="px-4 py-4">{row.reveals}</td><td className="px-4 py-4">{row.state === 6 ? `${row.winningPrice} BNB` : '—'}</td><td className="px-4 py-4">{row.escrowStatus}</td><td className="px-4 py-4"><Link className="text-[#E6CC91]" href={`/auctions/${row.id}`}>Open →</Link></td></tr>)}</tbody></table></div>}
    </>}
  </div></div>;
}
