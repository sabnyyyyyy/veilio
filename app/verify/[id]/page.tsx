'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { usePublicClient } from 'wagmi';
import { formatEther } from 'viem';
import { VEIL_V3_ABI, VEIL_V3_CONTRACT_ADDRESS } from '@/lib/contract';
import { bnbChain } from '@/lib/chain';

interface AuctionRecord {
  id: bigint;
  seller: string;
  itemName: string;
  description: string;
  startingPrice: bigint;
  commitEndTime: bigint;
  revealEndTime: bigint;
  state: number;
  highestBidder: string;
  highestBid: bigint;
  bidderCount: bigint;
  revealedCount: bigint;
  feeBps: bigint;
}

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
const EXPLORER_BASE = bnbChain.blockExplorers.default.url.replace(/\/$/, '');

function addressLabel(address: string) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function stateLabel(state: number, commitEnd: bigint, revealEnd: bigint) {
  if (state === 3) return 'Inspection';
  if (state === 4) return 'Refund requested';
  if (state === 5) return 'Under review';
  if (state === 6) return 'Completed';
  if (state === 7) return 'Refunded';
  if (state === 8) return 'Cancelled';
  const now = BigInt(Math.floor(Date.now() / 1000));
  if (now < commitEnd) return 'Bidding';
  if (now < revealEnd) return 'Revealing';
  return 'Awaiting settlement';
}

function dateLabel(timestamp: bigint) {
  return new Date(Number(timestamp) * 1000).toLocaleString();
}

export default function VerifyDetailPage() {
  const params = useParams();
  const publicClient = usePublicClient();
  const auctionId = params?.id ? String(params.id) : '';
  const [auction, setAuction] = useState<AuctionRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!publicClient || !/^[1-9]\d{0,77}$/.test(auctionId)) {
      setLoading(false);
      if (auctionId) setError('Enter a valid positive auction ID.');
      return;
    }
    const client = publicClient;
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const [raw, state, feeBps] = await Promise.all([
          client.readContract({ address: VEIL_V3_CONTRACT_ADDRESS, abi: VEIL_V3_ABI, functionName: 'auctions', args: [BigInt(auctionId)] }),
          client.readContract({ address: VEIL_V3_CONTRACT_ADDRESS, abi: VEIL_V3_ABI, functionName: 'getAuctionState', args: [BigInt(auctionId)] }),
          client.readContract({ address: VEIL_V3_CONTRACT_ADDRESS, abi: VEIL_V3_ABI, functionName: 'PLATFORM_FEE_BPS' }),
        ]);
        const values = raw as readonly unknown[];
        if (String(values[0]) === '0') throw new Error(`Auction #${auctionId} does not exist in the active VEILIO contract.`);
        const record: AuctionRecord = {
          id: BigInt(String(values[0])), seller: String(values[1]), itemName: String(values[2]), description: String(values[3]),
          startingPrice: BigInt(String(values[5])), commitEndTime: BigInt(String(values[6])), revealEndTime: BigInt(String(values[7])),
          state: Number(state), highestBidder: String(values[11]), highestBid: BigInt(String(values[12])),
          bidderCount: BigInt(String(values[13])), revealedCount: BigInt(String(values[14])), feeBps: BigInt(String(feeBps)),
        };
        if (!cancelled) setAuction(record);
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : 'Unable to read the auction from BNB Testnet.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [publicClient, auctionId]);

  const card = (content: React.ReactNode) => (
    <div className="min-h-screen bg-[#0A0A09] px-6 py-20">
      <div className="mx-auto max-w-3xl">
        <Link href="/verify" className="mb-8 inline-block text-xs font-semibold uppercase tracking-wider text-[#A8A397] hover:text-[#C9A45C]">← Back to verifier</Link>
        <div className="rounded-2xl border border-white/10 bg-[#151512] p-8">{content}</div>
      </div>
    </div>
  );

  if (loading) return card(<p className="py-12 text-center text-sm text-[#A8A397]">Reading auction record from BNB Testnet…</p>);
  if (error || !auction) return card(<div className="space-y-4 text-center"><h1 className="text-xl font-bold text-[#F5F2E8]">Could not verify this auction</h1><p className="text-sm text-[#A8A397]">{error || 'Auction record not found.'}</p><p className="break-all text-xs text-[#77746B]">Active contract: {VEIL_V3_CONTRACT_ADDRESS}</p></div>);

  const phase = stateLabel(auction.state, auction.commitEndTime, auction.revealEndTime);
  const isCompleted = auction.state === 6;
  const isRefunded = auction.state === 7;
  const hasWinner = auction.highestBidder.toLowerCase() !== ZERO_ADDRESS;
  const platformFee = isCompleted ? (auction.highestBid * auction.feeBps) / 10_000n : 0n;
  const sellerProceeds = isCompleted ? auction.highestBid - platformFee : 0n;
  const rows = [
    ['Auction ID', `#${auction.id}`], ['Item', auction.itemName], ['Description', auction.description || '—'],
    ['Seller', addressLabel(auction.seller)], ['Starting price', `${formatEther(auction.startingPrice)} BNB`],
    ['Commit ends', dateLabel(auction.commitEndTime)], ['Reveal ends', dateLabel(auction.revealEndTime)],
    ['Bidders', auction.bidderCount.toString()], ['Revealed bids', `${auction.revealedCount} / ${auction.bidderCount}`],
  ];

  return card(
    <div className="space-y-8">
      <header className="flex flex-wrap items-center gap-4 border-b border-white/10 pb-6">
        <span className="flex h-10 w-10 items-center justify-center rounded-full bg-[#C9A45C] text-lg font-bold text-[#0A0A09]">✓</span>
        <div><h1 className="text-lg font-extrabold uppercase tracking-widest text-[#C9A45C]">On-chain auction record</h1><p className="mt-1 text-xs text-[#A8A397]">Auction #{auction.id} · {phase}</p></div>
        <span className="ml-auto rounded-lg border border-white/10 px-3 py-1.5 text-xs font-bold uppercase text-[#E6CC91]">{phase}</span>
      </header>

      <section>
        <h2 className="mb-3 text-xs font-bold uppercase tracking-wider text-[#A8A397]">Auction details</h2>
        <div className="divide-y divide-white/[0.05]">
          {rows.map(([label, value]) => <div key={label} className="flex justify-between gap-6 py-3 text-sm"><span className="shrink-0 text-[#A8A397]">{label}</span><span className="max-w-[65%] break-words text-right font-medium text-[#F5F2E8]">{value}</span></div>)}
        </div>
      </section>

      {(isCompleted || isRefunded) && (
        <section className="border-t border-white/10 pt-6">
          <h2 className="mb-3 text-xs font-bold uppercase tracking-wider text-[#A8A397]">Settlement outcome</h2>
          {isRefunded ? <p className="text-sm text-[#A8A397]">This auction was refunded. No completed seller sale is recorded.</p> : hasWinner ? (
            <>
              <div className="divide-y divide-white/[0.05]">
                <div className="flex justify-between gap-4 py-3 text-sm"><span className="text-[#A8A397]">Winner</span><span className="font-mono text-[#F5F2E8]">{addressLabel(auction.highestBidder)}</span></div>
                <div className="flex justify-between gap-4 py-3 text-sm"><span className="text-[#A8A397]">Winning bid (first-price)</span><span className="font-bold text-[#E6CC91]">{formatEther(auction.highestBid)} BNB</span></div>
                <div className="flex justify-between gap-4 py-3 text-sm"><span className="text-[#A8A397]">VEILIO fee ({Number(auction.feeBps) / 100}%)</span><span className="text-[#F5F2E8]">{formatEther(platformFee)} BNB</span></div>
                <div className="flex justify-between gap-4 py-3 text-sm"><span className="text-[#A8A397]">Seller proceeds (claimable)</span><span className="font-bold text-[#F5F2E8]">{formatEther(sellerProceeds)} BNB</span></div>
              </div>
              <p className="mt-3 text-xs leading-5 text-[#77746B]">VEILIO uses first-price settlement in the active V3/V4 contracts: the winning bidder pays their revealed winning bid. The seller’s proceeds are credited on-chain and must be withdrawn.</p>
            </>
          ) : <p className="text-sm text-[#A8A397]">The auction completed without a valid revealed winner.</p>}
        </section>
      )}

      <section className="border-t border-white/10 pt-6">
        <h2 className="mb-3 text-xs font-bold uppercase tracking-wider text-[#A8A397]">Network source</h2>
        <div className="flex justify-between gap-4 py-2 text-sm"><span className="text-[#A8A397]">Network</span><span className="text-[#F5F2E8]">BNB Smart Chain Testnet · 97</span></div>
        <div className="flex justify-between gap-4 py-2 text-sm"><span className="text-[#A8A397]">Active contract</span><span className="break-all text-right font-mono text-[#F5F2E8]">{VEIL_V3_CONTRACT_ADDRESS}</span></div>
        <a href={`${EXPLORER_BASE}/address/${VEIL_V3_CONTRACT_ADDRESS}`} target="_blank" rel="noreferrer" className="mt-4 inline-flex rounded-xl border border-white/10 px-5 py-3 text-xs font-bold uppercase tracking-wider text-[#E6CC91] hover:bg-white/[0.05]">Open contract on BscScan →</a>
      </section>
    </div>,
  );
}
