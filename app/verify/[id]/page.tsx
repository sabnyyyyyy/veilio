'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { usePublicClient } from 'wagmi';
import { formatEther } from 'viem';
import { VEIL_V3_ABI, VEIL_V3_CONTRACT_ADDRESS } from '@/lib/contract';
import { bnbChain } from '@/lib/chain';
import { computeParticipantReputation, getDeliveryStateDetails, type DeliveryState } from '@/lib/reputation';
import {
  ShieldCheck,
  CheckCircle2,
  Clock,
  ExternalLink,
  Award,
  Lock,
  Unlock,
  Layers,
  ArrowRight,
  FileCheck,
} from 'lucide-react';

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
  finalTxHash: string;
}

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
const EXPLORER_BASE = bnbChain.blockExplorers.default.url.replace(/\/$/, '');

function addressLabel(address: string) {
  if (!address || address === ZERO_ADDRESS) return 'None';
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function stateLabel(state: number, commitEnd: bigint, revealEnd: bigint) {
  if (state === 3) return 'Inspection Window';
  if (state === 4) return 'Refund Requested';
  if (state === 5) return 'Under Review';
  if (state === 6) return 'Completed';
  if (state === 7) return 'Refunded';
  if (state === 8) return 'Cancelled';
  const now = BigInt(Math.floor(Date.now() / 1000));
  if (now < commitEnd) return 'Bidding Phase';
  if (now < revealEnd) return 'Reveal Phase';
  return 'Awaiting Settlement';
}

function dateLabel(timestamp: bigint) {
  return new Date(Number(timestamp) * 1000).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    timeZoneName: 'short',
  });
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
          id: BigInt(String(values[0])),
          seller: String(values[1]),
          itemName: String(values[2]),
          description: String(values[3]),
          startingPrice: BigInt(String(values[5])),
          commitEndTime: BigInt(String(values[6])),
          revealEndTime: BigInt(String(values[7])),
          state: Number(state),
          highestBidder: String(values[11]),
          highestBid: BigInt(String(values[12])),
          bidderCount: BigInt(String(values[13])),
          revealedCount: BigInt(String(values[14])),
          finalTxHash: String(values[15]),
          feeBps: BigInt(String(feeBps)),
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
    <div className="min-h-screen bg-[#0A0A09] px-6 py-16">
      <div className="mx-auto max-w-4xl">
        <Link href="/verify" className="mb-6 inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-[#A8A397] hover:text-[#C9A45C] transition">
          ← Back to verifier lookup
        </Link>
        <div className="rounded-2xl border border-white/10 bg-[#151512] p-6 sm:p-10 shadow-2xl">{content}</div>
      </div>
    </div>
  );

  if (loading) {
    return card(
      <div className="py-20 text-center space-y-4">
        <div className="w-10 h-10 border-2 border-[#C9A45C] border-t-transparent rounded-full animate-spin mx-auto" />
        <p className="text-sm font-mono text-[#A8A397] uppercase tracking-widest">
          Reading immutable auction state from BNB Chain…
        </p>
      </div>
    );
  }

  if (error || !auction) {
    return card(
      <div className="space-y-6 text-center py-12">
        <div className="w-12 h-12 rounded-full bg-red-500/10 border border-red-500/20 text-red-400 mx-auto flex items-center justify-center font-bold text-xl">
          !
        </div>
        <div>
          <h1 className="text-xl font-bold text-[#F5F2E8]">Could Not Verify Auction Record</h1>
          <p className="text-sm text-[#A8A397] mt-2 max-w-md mx-auto">{error || 'Auction record not found on BNB Smart Chain.'}</p>
        </div>
        <div className="p-4 rounded-xl bg-[#0A0A09] border border-white/10 text-xs font-mono text-[#77746B] break-all max-w-lg mx-auto">
          Active contract: {VEIL_V3_CONTRACT_ADDRESS}
        </div>
      </div>
    );
  }

  const phase = stateLabel(auction.state, auction.commitEndTime, auction.revealEndTime);
  const isCompleted = auction.state === 6;
  const isRefunded = auction.state === 7;
  const isInspection = auction.state === 3;
  const hasWinner = auction.highestBidder.toLowerCase() !== ZERO_ADDRESS;
  const platformFee = isCompleted ? (auction.highestBid * auction.feeBps) / 10_000n : 0n;
  const sellerProceeds = isCompleted ? auction.highestBid - platformFee : 0n;

  // Determine Delivery State
  let deliveryState: DeliveryState = 'pending';
  if (isCompleted) deliveryState = 'delivered';
  else if (isInspection) deliveryState = 'ready_for_delivery';
  else if (auction.state === 4 || auction.state === 5) deliveryState = 'disputed';
  else if (auction.state === 7) deliveryState = 'expired';

  const deliveryDetails = getDeliveryStateDetails(deliveryState);
  const sellerReputation = computeParticipantReputation(auction.seller, { role: 'seller' });
  const winnerReputation = hasWinner ? computeParticipantReputation(auction.highestBidder, { role: 'buyer' }) : null;

  const nowSec = BigInt(Math.floor(Date.now() / 1000));
  const commitEnded = nowSec >= auction.commitEndTime;
  const revealEnded = nowSec >= auction.revealEndTime;

  return card(
    <div className="space-y-8">
      {/* Certificate Header */}
      <div className="border-b border-white/10 pb-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3.5">
            <div className="w-12 h-12 rounded-xl bg-[#C9A45C]/10 border border-[#C9A45C]/30 flex items-center justify-center text-[#C9A45C]">
              <ShieldCheck size={28} />
            </div>
            <div>
              <div className="inline-flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-[#C9A45C]">
                Proof of Auction Certificate
              </div>
              <h1 className="text-xl sm:text-2xl font-extrabold text-[#F5F2E8] uppercase tracking-tight">
                {auction.itemName}
              </h1>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span className={`px-3 py-1.5 rounded-full border text-xs font-semibold uppercase tracking-wider ${
              isCompleted
                ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                : 'border-[#C9A45C]/30 bg-[#C9A45C]/10 text-[#E6CC91]'
            }`}>
              {phase}
            </span>
          </div>
        </div>
      </div>

      {/* Mechanism & Proof Badges */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="p-4 rounded-xl border border-white/10 bg-[#0A0A09] space-y-1">
          <span className="text-[10px] font-bold uppercase tracking-widest text-[#A8A397] block">Auction ID</span>
          <span className="font-mono text-base font-extrabold text-[#F5F2E8]">#{auction.id}</span>
        </div>

        <div className="p-4 rounded-xl border border-white/10 bg-[#0A0A09] space-y-1 sm:col-span-2">
          <span className="text-[10px] font-bold uppercase tracking-widest text-[#A8A397] block">Auction Mechanism</span>
          <span className="text-xs font-semibold text-[#E6CC91] flex items-center gap-1.5">
            <Lock size={12} /> First-Price Sealed-Bid (Keccak256 Commit-Reveal)
          </span>
        </div>
      </div>

      {/* Auction Lifecycle Stages */}
      <section className="space-y-3">
        <h2 className="text-xs font-bold uppercase tracking-wider text-[#A8A397]">
          Lifecycle Timeline &amp; State Verification
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {/* Commit Stage */}
          <div className={`p-4 rounded-xl border ${commitEnded ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-[#C9A45C]/30 bg-[#C9A45C]/5'}`}>
            <div className="flex items-center justify-between text-xs font-bold uppercase tracking-wider mb-2">
              <span className="text-[#F5F2E8]">1. Commit Phase</span>
              {commitEnded ? <CheckCircle2 size={14} className="text-emerald-400" /> : <Clock size={14} className="text-[#C9A45C]" />}
            </div>
            <div className="text-[11px] text-[#A8A397] space-y-1">
              <div>Ended: <span className="text-[#F5F2E8] font-mono">{dateLabel(auction.commitEndTime)}</span></div>
              <div>Bidders locked: <span className="text-[#F5F2E8] font-mono">{auction.bidderCount.toString()}</span></div>
            </div>
          </div>

          {/* Reveal Stage */}
          <div className={`p-4 rounded-xl border ${revealEnded ? 'border-emerald-500/30 bg-emerald-500/5' : commitEnded ? 'border-[#C9A45C]/30 bg-[#C9A45C]/5' : 'border-white/10 bg-[#0A0A09]'}`}>
            <div className="flex items-center justify-between text-xs font-bold uppercase tracking-wider mb-2">
              <span className="text-[#F5F2E8]">2. Reveal Phase</span>
              {revealEnded ? <CheckCircle2 size={14} className="text-emerald-400" /> : <Clock size={14} className="text-[#A8A397]" />}
            </div>
            <div className="text-[11px] text-[#A8A397] space-y-1">
              <div>Ended: <span className="text-[#F5F2E8] font-mono">{dateLabel(auction.revealEndTime)}</span></div>
              <div>Revealed: <span className="text-[#F5F2E8] font-mono">{auction.revealedCount.toString()} / {auction.bidderCount.toString()}</span></div>
            </div>
          </div>

          {/* Settlement Stage */}
          <div className={`p-4 rounded-xl border ${isCompleted ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-white/10 bg-[#0A0A09]'}`}>
            <div className="flex items-center justify-between text-xs font-bold uppercase tracking-wider mb-2">
              <span className="text-[#F5F2E8]">3. Settlement</span>
              {isCompleted ? <CheckCircle2 size={14} className="text-emerald-400" /> : <Clock size={14} className="text-[#A8A397]" />}
            </div>
            <div className="text-[11px] text-[#A8A397] space-y-1">
              <div>Status: <span className="text-[#F5F2E8] font-semibold">{phase}</span></div>
              <div>Rules: <span className="text-[#F5F2E8]">Exact First-Price</span></div>
            </div>
          </div>
        </div>
      </section>

      {/* Asset Delivery Status */}
      <section className="p-5 rounded-xl border border-white/10 bg-[#0A0A09] space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-xs font-bold uppercase tracking-wider text-[#A8A397]">
            Asset Delivery &amp; Access Control
          </span>
          <span className={`px-2.5 py-0.5 rounded-full border text-[11px] font-semibold ${deliveryDetails.tone}`}>
            {deliveryDetails.label}
          </span>
        </div>
        <p className="text-xs text-[#A8A397]">
          {deliveryDetails.description}
        </p>
      </section>

      {/* Verified Settlement Breakdown */}
      <section className="space-y-3">
        <h2 className="text-xs font-bold uppercase tracking-wider text-[#A8A397]">
          Cryptographic &amp; Financial Accounting
        </h2>
        <div className="divide-y divide-white/[0.07] rounded-xl border border-white/10 bg-[#0A0A09] px-5 py-2 text-sm">
          <div className="flex justify-between py-3">
            <span className="text-[#A8A397]">Seller Address</span>
            <div className="text-right">
              <span className="font-mono text-[#F5F2E8]">{addressLabel(auction.seller)}</span>
              <span className="ml-2 text-[10px] text-emerald-400 font-semibold">
                ({sellerReputation.hasHistory ? `${sellerReputation.deliverySuccessRate}% Delivery Rate` : sellerReputation.statusLabel})
              </span>
            </div>
          </div>

          <div className="flex justify-between py-3">
            <span className="text-[#A8A397]">Starting Reserve Floor</span>
            <span className="font-mono font-medium text-[#F5F2E8]">{formatEther(auction.startingPrice)} BNB</span>
          </div>

          <div className="flex justify-between py-3">
            <span className="text-[#A8A397]">Verified Winner</span>
            <span className="font-mono text-[#F5F2E8]">{addressLabel(auction.highestBidder)}</span>
          </div>

          <div className="flex justify-between py-3">
            <span className="text-[#A8A397]">Winning Bid (First-Price)</span>
            <span className="font-mono font-bold text-[#E6CC91]">
              {hasWinner ? `${formatEther(auction.highestBid)} BNB` : 'No valid revealed bid'}
            </span>
          </div>

          {isCompleted && (
            <>
              <div className="flex justify-between py-3">
                <span className="text-[#A8A397]">VEILIO Protocol Fee ({Number(auction.feeBps) / 100}%)</span>
                <span className="font-mono text-[#F5F2E8]">{formatEther(platformFee)} BNB</span>
              </div>

              <div className="flex justify-between py-3">
                <span className="text-[#A8A397]">Seller Proceeds (On-Chain Credit)</span>
                <span className="font-mono font-bold text-emerald-400">{formatEther(sellerProceeds)} BNB</span>
              </div>
            </>
          )}
        </div>
      </section>

      {/* Network Verification & Explorer */}
      <section className="pt-2 border-t border-white/10">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 text-xs text-[#A8A397]">
          <div>
            <span>Verified on BNB Smart Chain Testnet (Chain ID 97)</span>
            <p className="font-mono text-[11px] text-[#77746B] mt-0.5 break-all">Contract: {VEIL_V3_CONTRACT_ADDRESS}</p>
          </div>

          <a
            href={`${EXPLORER_BASE}/address/${VEIL_V3_CONTRACT_ADDRESS}`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl border border-white/10 bg-white/[0.04] text-[#E6CC91] hover:bg-white/[0.08] hover:text-white transition uppercase font-semibold text-[11px] tracking-wider"
          >
            <span>View on BscScan</span>
            <ExternalLink size={13} />
          </a>
        </div>
      </section>
    </div>
  );
}
