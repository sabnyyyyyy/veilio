'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { usePublicClient } from 'wagmi';
import { formatEther } from 'viem';

import { VEIL_V2_ABI, VEIL_V2_CONTRACT_ADDRESS } from '@/lib/contract';
import { bnbChain } from '@/lib/chain';

// ── Types ──────────────────────────────────────────────────────────────────

interface AuctionData {
  id: bigint;
  seller: string;
  itemName: string;
  description: string;
  imageURI: string;
  startingPrice: bigint;
  commitEndTime: bigint;
  revealEndTime: bigint;
  state: number;
  highestBidder: string;
  highestBid: bigint;
  secondHighestBid: bigint;
  bidderCount: bigint;
  revealedCount: bigint;
  finalTxHash: string;
}

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
const EXPLORER_BASE = bnbChain.blockExplorers.default.url;

// Map on-chain AuctionState enum (0=Active,1=RevealPhase,2=?,3=Settled) to labels
function phaseLabel(state: number, commitEndMs: number, revealEndMs: number): string {
  if (state === 3) return 'Settled';
  const now = Date.now();
  if (now < commitEndMs) return 'Bidding';
  if (now < revealEndMs) return 'Revealing';
  return 'Awaiting Settlement';
}

function shortAddr(addr: string): string {
  return `${addr.substring(0, 6)}…${addr.substring(38)}`;
}

function formatTs(unixSec: bigint): string {
  return new Date(Number(unixSec) * 1000).toLocaleString();
}

// ── Component ──────────────────────────────────────────────────────────────

export default function VerifyDetailPage() {
  const params = useParams();
  const publicClient = usePublicClient();

  const auctionId = params?.id ? String(params.id) : '';

  const [auction, setAuction] = useState<AuctionData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!publicClient || !auctionId) return;

    async function load() {
      try {
        setLoading(true);
        setError(null);

        const raw = await publicClient!.readContract({
          address: VEIL_V2_CONTRACT_ADDRESS,
          abi: VEIL_V2_ABI,
          functionName: 'auctions',
          args: [BigInt(auctionId)],
        });

        const values = raw as readonly [
          bigint, string, string, string, string,
          bigint, bigint, bigint, number, string,
          bigint, bigint, bigint, bigint, string
        ];

        const [
          id, seller, itemName, description, imageURI,
          startingPrice, commitEndTime, revealEndTime,
          state, highestBidder, highestBid, secondHighestBid,
          bidderCount, revealedCount, finalTxHash,
        ] = values;

        if (Number(id) === 0) {
          throw new Error(`Auction #${auctionId} does not exist on BNB Chain.`);
        }

        setAuction({
          id, seller, itemName, description, imageURI,
          startingPrice, commitEndTime, revealEndTime,
          state, highestBidder, highestBid, secondHighestBid,
          bidderCount, revealedCount, finalTxHash,
        });
      } catch (err) {
        console.error('[Verify] Load error:', err);
        setError(
          err instanceof Error ? err.message : 'Unable to verify auction on BNB Chain.'
        );
      } finally {
        setLoading(false);
      }
    }

    load();
  }, [publicClient, auctionId]);

  // ── Loading ────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="min-h-screen py-20 bg-[#0A0A09]">
        <div className="max-w-3xl mx-auto px-6">
          <div className="mb-8">
            <Link href="/verify" className="text-xs font-semibold uppercase tracking-wider text-[#A8A397] hover:text-[#C9A45C] transition-colors">
              ← Back to verifier
            </Link>
          </div>
          <div className="p-8 rounded-2xl bg-[#151512] border border-white/10 flex flex-col items-center gap-4 py-16">
            <div className="w-6 h-6 rounded-full border-2 border-[#C9A45C] border-t-transparent animate-spin" />
            <p className="text-sm text-[#A8A397]">Verifying auction on BNB Chain…</p>
          </div>
        </div>
      </div>
    );
  }

  // ── Error / not found ──────────────────────────────────────────────────
  if (error || !auction) {
    return (
      <div className="min-h-screen py-20 bg-[#0A0A09]">
        <div className="max-w-3xl mx-auto px-6">
          <div className="mb-8">
            <Link href="/verify" className="text-xs font-semibold uppercase tracking-wider text-[#A8A397] hover:text-[#C9A45C] transition-colors">
              ← Back to verifier
            </Link>
          </div>
          <div className="p-8 rounded-2xl bg-[#151512] border border-rose-500/20 text-center py-16 space-y-4">
            <div className="w-10 h-10 rounded-full border-2 border-rose-500 text-rose-500 flex items-center justify-center font-bold text-lg mx-auto">✕</div>
            <h2 className="text-xl font-bold text-[#F5F2E8]">Auction not found</h2>
            <p className="text-sm text-[#A8A397] max-w-sm mx-auto">
              {error || `Auction #${auctionId} does not exist on BNB Chain.`}
            </p>
            <p className="text-xs text-[#A8A397] opacity-60">
              Contract: {VEIL_V2_CONTRACT_ADDRESS}
            </p>
          </div>
        </div>
      </div>
    );
  }

  // ── Phase & settlement data ──────────────────────────────────────────────
  const commitEndMs = Number(auction.commitEndTime) * 1000;
  const revealEndMs = Number(auction.revealEndTime) * 1000;
  const phase = phaseLabel(auction.state, commitEndMs, revealEndMs);
  const isSettled = auction.state === 3;
  const hasWinner = auction.highestBidder !== ZERO_ADDRESS;

  // Vickrey winning price — matches the exact Solidity: secondHighestBid > 0 ? secondHighestBid : startingPrice
  const winningPrice = auction.secondHighestBid > BigInt(0)
    ? auction.secondHighestBid
    : auction.startingPrice;

  const phaseColor = isSettled
    ? 'text-[#C9A45C]'
    : phase === 'Revealing'
    ? 'text-blue-400'
    : 'text-amber-400';

  return (
    <div className="min-h-screen py-20 bg-[#0A0A09]">
      <div className="max-w-3xl mx-auto px-6">

        {/* Back */}
        <div className="mb-8">
          <Link href="/verify" className="text-xs font-semibold uppercase tracking-wider text-[#A8A397] hover:text-[#C9A45C] transition-colors">
            ← Back to verifier
          </Link>
        </div>

        {/* Verification Badge */}
        <div className="p-8 rounded-2xl bg-[#151512] border border-white/10 space-y-8">

          {/* ── VERIFIED HEADER ─────────────────────────────────────── */}
          <div className="flex items-center gap-4">
            <div className="w-10 h-10 rounded-full bg-[#C9A45C] text-[#0A0A09] flex items-center justify-center font-bold text-lg flex-shrink-0">
              ✓
            </div>
            <div>
              <h1 className="text-xl font-extrabold uppercase tracking-widest text-[#C9A45C]">
                VERIFIED ON BNB CHAIN
              </h1>
              <p className="text-xs text-[#A8A397] mt-0.5">
                Auction #{auction.id.toString()} · {phase}
              </p>
            </div>
            <div className={`ml-auto px-3 py-1.5 rounded-lg border text-xs font-bold uppercase tracking-wider ${
              isSettled ? 'border-[#C9A45C]/30 bg-[#C9A45C]/5 text-[#C9A45C]' :
              phase === 'Revealing' ? 'border-blue-500/30 bg-blue-500/5 text-blue-400' :
              'border-amber-500/30 bg-amber-500/5 text-amber-400'
            }`}>
              {phase}
            </div>
          </div>

          {/* ── AUCTION DETAILS ─────────────────────────────────────── */}
          <div className="space-y-3 pt-6 border-t border-white/5 text-sm">
            <p className="text-xs uppercase tracking-wider font-bold text-[#A8A397] mb-4">Auction Details</p>

            {[
              { label: 'Auction ID', value: `#${auction.id.toString()}` },
              { label: 'Item', value: auction.itemName },
              { label: 'Description', value: auction.description || '—' },
              { label: 'Seller', value: shortAddr(auction.seller), mono: true, full: auction.seller },
              { label: 'Starting Price', value: `${formatEther(auction.startingPrice)} BNB` },
              { label: 'Commit End', value: formatTs(auction.commitEndTime) },
              { label: 'Reveal End', value: formatTs(auction.revealEndTime) },
              { label: 'Bidders', value: auction.bidderCount.toString() },
              { label: 'Revealed', value: `${auction.revealedCount.toString()} / ${auction.bidderCount.toString()}` },
            ].map(({ label, value, mono, full }) => (
              <div key={label} className="flex justify-between items-start gap-6 py-1.5 border-b border-white/[0.04]">
                <span className="text-[#A8A397] flex-shrink-0">{label}</span>
                <span
                  className={`${mono ? 'font-mono' : 'font-semibold'} text-[#F5F2E8] text-right truncate max-w-[260px]`}
                  title={full}
                >
                  {value}
                </span>
              </div>
            ))}
          </div>

          {/* ── SETTLEMENT RESULT (only if settled) ─────────────────── */}
          {isSettled && (
            <div className="space-y-3 pt-6 border-t border-white/5 text-sm">
              <p className="text-xs uppercase tracking-wider font-bold text-[#A8A397] mb-4">Settlement Result</p>

              {hasWinner ? (
                <>
                  <div className="flex justify-between items-start gap-6 py-1.5 border-b border-white/[0.04]">
                    <span className="text-[#A8A397]">Winner</span>
                    <span className="font-mono text-[#F5F2E8] truncate max-w-[260px]" title={auction.highestBidder}>
                      {shortAddr(auction.highestBidder)}
                    </span>
                  </div>
                  <div className="flex justify-between items-start gap-6 py-1.5 border-b border-white/[0.04]">
                    <span className="text-[#A8A397]">Price paid</span>
                    <span className="font-bold text-[#C9A45C]">{formatEther(winningPrice)} BNB</span>
                  </div>
                  <div className="flex justify-between items-start gap-6 py-1.5 border-b border-white/[0.04]">
                    <span className="text-[#A8A397]">Mechanism</span>
                    <span className="text-[#F5F2E8]">Vickrey second-price</span>
                  </div>
                </>
              ) : (
                <div className="py-4 text-center">
                  <p className="text-sm text-[#A8A397]">
                    No valid bids were revealed. Auction ended with no winner.
                  </p>
                </div>
              )}
            </div>
          )}

          {/* ── NETWORK VERIFICATION SECTION ────────────────────────── */}
          <div className="space-y-3 pt-6 border-t border-white/5 text-sm">
            <p className="text-xs uppercase tracking-wider font-bold text-[#A8A397] mb-4">On-Chain Proof</p>

            {[
              { label: 'Network', value: 'BNB Chain Testnet' },
              { label: 'Chain ID', value: '97' },
              {
                label: 'Contract',
                value: `${VEIL_V2_CONTRACT_ADDRESS.substring(0, 6)}…${VEIL_V2_CONTRACT_ADDRESS.substring(38)}`,
                mono: true,
                full: VEIL_V2_CONTRACT_ADDRESS,
              },
            ].map(({ label, value, mono, full }) => (
              <div key={label} className="flex justify-between items-center gap-6 py-1.5 border-b border-white/[0.04]">
                <span className="text-[#A8A397]">{label}</span>
                <span className={`${mono ? 'font-mono' : 'font-semibold'} text-[#F5F2E8]`} title={full}>{value}</span>
              </div>
            ))}
          </div>

          {/* ── EXPLORER LINKS ───────────────────────────────────────── */}
          <div className="pt-6 border-t border-white/5 flex flex-wrap gap-3">
            {/* Always show contract link */}
            <a
              href={`${EXPLORER_BASE}address/${VEIL_V2_CONTRACT_ADDRESS}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 px-5 py-3 text-xs font-bold uppercase tracking-wider rounded-xl bg-white/[0.04] border border-white/10 text-[#A8A397] hover:text-[#F5F2E8] hover:bg-white/[0.08] transition-colors"
            >
              View Contract on BohrScan →
            </a>

            {/* Auction-specific address lookup for winner */}
            {isSettled && hasWinner && (
              <a
                href={`${EXPLORER_BASE}address/${auction.highestBidder}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-2 px-5 py-3 text-xs font-bold uppercase tracking-wider rounded-xl bg-[#C9A45C]/5 border border-[#C9A45C]/20 text-[#C9A45C] hover:bg-[#C9A45C]/10 transition-colors"
              >
                View Winner on BohrScan →
              </a>
            )}
          </div>

        </div>

        {/* Link back to auction detail */}
        <div className="mt-6 text-center">
          <Link
            href={`/auctions/${auctionId}`}
            className="text-xs font-semibold text-[#A8A397] hover:text-[#C9A45C] transition-colors"
          >
            ← Open full auction detail page
          </Link>
        </div>

      </div>
    </div>
  );
}
