'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import Countdown from './Countdown';
import { AuctionItem } from '@/lib/mockAuctions';
import { resolveIpfsUri } from '@/lib/ipfs';
import {
  ArrowUpRight,
  Clock3,
  Database,
  Cpu,
  Key,
  FileCode,
  Sparkles,
  Bot,
  BadgeCheck,
  Users,
  Layers,
} from 'lucide-react';

interface AuctionCardProps {
  auction: AuctionItem;
}

function getCategoryIcon(category?: string) {
  const norm = (category || '').toLowerCase();
  if (norm.includes('model') || norm.includes('ai')) return <Cpu size={12} className="text-[#C9A45C]" />;
  if (norm.includes('api') || norm.includes('access')) return <Key size={12} className="text-amber-300" />;
  if (norm.includes('software') || norm.includes('binary')) return <FileCode size={12} className="text-sky-400" />;
  if (norm.includes('nft') || norm.includes('collectible')) return <Sparkles size={12} className="text-purple-300" />;
  if (norm.includes('data-license') || norm.includes('license')) return <Layers size={12} className="text-emerald-400" />;
  return <Database size={12} className="text-[#D7B66E]" />;
}

function getCategoryLabel(category?: string, assetType?: string): string {
  const norm = (category || assetType || 'digital-asset').toLowerCase();
  if (norm === 'dataset' || norm === 'data-product') return 'Dataset';
  if (norm === 'ai-model' || norm === 'model') return 'AI Model';
  if (norm === 'data-license') return 'Data License';
  if (norm === 'api-license') return 'API Access';
  if (norm === 'software-license') return 'Software License';
  if (norm === 'nft') return 'NFT Escrow';
  return 'Digital Asset';
}

function formatLicenseLabel(license?: string): string | null {
  if (!license) return null;
  if (license === 'commercial_use') return 'Commercial';
  if (license === 'academic_or_research') return 'Research / Academic';
  if (license === 'exclusive_transfer') return 'Exclusive';
  return license.replace(/_/g, ' ');
}

export default function AuctionCard({ auction }: AuctionCardProps) {
  const [imgError, setImgError] = useState(false);
  const imageSrc = auction.imageURI ? resolveIpfsUri(auction.imageURI) : null;
  const now = Date.now();
  const isBidding = auction.status === 'Bidding' && auction.commitEndTime > now;
  const isRevealing = auction.status === 'Revealing' && auction.revealEndTime > now;
  const isClosed = !isBidding && !isRevealing;
  const countdownEnd = isRevealing ? auction.revealEndTime : auction.commitEndTime;
  const statusLabel = isBidding ? 'Bidding open' : isRevealing ? 'Reveal phase' : 'Auction closed';
  const statusTone = isBidding ? 'text-emerald-200 border-emerald-300/20 bg-emerald-300/[0.08]' : isRevealing ? 'text-[#E6CC91] border-[#C9A45C]/25 bg-[#C9A45C]/[0.08]' : 'text-[#A8A397] border-white/[0.1] bg-black/20';

  const categoryLabel = getCategoryLabel(auction.metadata?.category, auction.assetType);
  const licenseLabel = formatLicenseLabel(auction.metadata?.licenseType);
  const isAgentCompatible = auction.metadata?.agentCompatible ?? true;
  const formatTag = auction.metadata?.format;

  return (
    <Link
      href={`/auctions/${auction.id}`}
      className="group relative flex h-full flex-col overflow-hidden rounded-2xl border border-white/[0.09] bg-[#12120F] shadow-[0_12px_40px_rgba(0,0,0,0.18)] transition duration-300 hover:-translate-y-1 hover:border-[#C9A45C]/35 hover:shadow-[0_20px_55px_rgba(0,0,0,0.34)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#C9A45C]"
    >
      <div className="relative aspect-[16/10] w-full overflow-hidden bg-[#10120F]">
        {imageSrc && !imgError ? (
          <>
            <img
              src={imageSrc}
              alt={auction.itemName}
              className="absolute inset-0 h-full w-full object-cover transition duration-700 group-hover:scale-[1.04]"
              onError={() => setImgError(true)}
            />
            <div className="absolute inset-0 bg-gradient-to-t from-[#0A0A09]/80 via-transparent to-[#0A0A09]/20" />
          </>
        ) : (
          <div className="absolute inset-0 overflow-hidden bg-[radial-gradient(ellipse_at_50%_45%,rgba(201,164,92,0.14),transparent_48%),linear-gradient(145deg,#171912_0%,#10110F_55%,#14201C_100%)]">
            <div className="absolute inset-0 opacity-[0.12]" style={{ backgroundImage: 'linear-gradient(rgba(233,225,202,.32) 1px, transparent 1px), linear-gradient(90deg, rgba(233,225,202,.32) 1px, transparent 1px)', backgroundSize: '32px 32px' }} />
            <svg aria-hidden="true" viewBox="0 0 600 340" preserveAspectRatio="xMidYMid slice" className="absolute inset-0 h-full w-full opacity-45">
              <path d="M0 252 118 180 218 215 325 92 424 135 600 45M62 0l86 87 87-21 113 108 109-13 83 88" fill="none" stroke="rgba(201,164,92,.42)" strokeWidth="1" />
              <circle cx="118" cy="180" r="3" fill="#C9A45C" /><circle cx="325" cy="92" r="3" fill="#E6CC91" /><circle cx="424" cy="135" r="3" fill="#C9A45C" />
            </svg>
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="relative flex h-24 w-24 items-center justify-center rounded-full border border-[#C9A45C]/25 bg-[#0A0A09]/45 shadow-[0_0_55px_rgba(201,164,92,.1)] backdrop-blur-sm transition duration-500 group-hover:scale-105 group-hover:border-[#C9A45C]/45">
                {getCategoryIcon(auction.metadata?.category || auction.assetType)}
                <span className="absolute -bottom-2 rounded-full border border-white/[0.1] bg-[#11110F] px-2.5 py-0.5 text-[8px] font-semibold uppercase tracking-[0.18em] text-[#A8A397]">
                  {categoryLabel}
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Top Badges */}
        <div className="absolute left-3 top-3 inline-flex items-center gap-1.5 rounded-lg border border-white/[0.12] bg-[#0A0A09]/80 px-2.5 py-1 text-[9px] font-semibold uppercase tracking-[0.14em] text-[#E6CC91] shadow-sm backdrop-blur-md">
          {getCategoryIcon(auction.metadata?.category || auction.assetType)}
          <span>{categoryLabel}</span>
          <span className="text-white/30">·</span>
          <span className="text-[#A8A397]">Sealed Bid</span>
        </div>

        <div className={`absolute right-3 top-3 inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[9px] font-medium backdrop-blur-md ${statusTone}`}>
          <span className={`h-1.5 w-1.5 rounded-full ${isBidding ? 'animate-pulse bg-emerald-300' : isRevealing ? 'bg-[#C9A45C]' : 'bg-[#77746B]'}`} />
          {statusLabel}
        </div>

        {/* Agent badge bottom-right of image */}
        {isAgentCompatible && (
          <div className="absolute bottom-2.5 right-3 inline-flex items-center gap-1 rounded border border-[#C9A45C]/30 bg-[#0A0A09]/85 px-1.5 py-0.5 text-[8px] font-mono uppercase tracking-wider text-[#C9A45C] backdrop-blur-sm">
            <Bot size={10} /> Agent Ready
          </div>
        )}
      </div>

      <div className="flex flex-1 flex-col p-4 sm:p-5">
        {/* Title & Description */}
        <div className="min-h-[76px]">
          <h3 className="line-clamp-2 text-base font-semibold leading-snug text-[#F5F2E8] transition-colors group-hover:text-[#E6CC91]">
            {auction.itemName}
          </h3>
          <p className="mt-1.5 line-clamp-2 text-xs leading-relaxed text-[#918D82]">
            {auction.description || 'Verified digital asset listed for private sealed bidding on BNB Chain.'}
          </p>
        </div>

        {/* Metadata Badges */}
        <div className="mt-3 flex flex-wrap items-center gap-1.5 text-[10px]">
          {licenseLabel && (
            <span className="rounded border border-white/[0.08] bg-white/[0.03] px-2 py-0.5 text-[#C7C2B7] font-medium">
              {licenseLabel}
            </span>
          )}
          {formatTag && (
            <span className="rounded border border-white/[0.08] bg-white/[0.03] px-2 py-0.5 font-mono text-[#A8A397]">
              {formatTag}
            </span>
          )}
          {auction.metadata?.region && (
            <span className="rounded border border-white/[0.08] bg-white/[0.03] px-2 py-0.5 text-[#89867D]">
              {auction.metadata.region}
            </span>
          )}
        </div>

        {/* Pricing and Participants */}
        <div className="mt-4 grid grid-cols-2 gap-3 border-y border-white/[0.07] py-3">
          <div>
            <span className="block text-[9px] font-medium uppercase tracking-[0.16em] text-[#77746B]">Starting price</span>
            <span className="mt-0.5 block text-sm font-semibold tabular-nums text-[#F5F2E8]">
              {auction.startingPrice} <span className="text-[11px] font-medium text-[#A8A397]">BNB</span>
            </span>
          </div>
          <div className="text-right">
            <span className="block text-[9px] font-medium uppercase tracking-[0.16em] text-[#77746B]">Participants</span>
            <span className="mt-0.5 inline-flex items-center justify-end gap-1.5 text-sm font-semibold tabular-nums text-[#F5F2E8]">
              <Users size={13} className="text-[#A8A397]" />
              {auction.bidderCount}
            </span>
          </div>
        </div>

        {/* Seller Trust & Verification indicator */}
        <div className="mt-2.5 flex items-center justify-between text-[10px] text-[#A8A397]">
          <span className="inline-flex items-center gap-1 font-mono">
            <BadgeCheck size={12} className="text-[#C9A45C]" />
            {auction.seller.slice(0, 6)}…{auction.seller.slice(-4)}
          </span>
          <span className="text-[9px] font-semibold text-emerald-400">
            {auction.sellerReputation && auction.sellerReputation.completedAuctions > 0
              ? `${auction.sellerReputation.deliverySuccessRate}% Delivered`
              : auction.sellerReputation
                ? 'New Seller'
                : 'Verified Settlement'}
          </span>
        </div>

        {/* Bottom Status & Link */}
        <div className="mt-auto flex items-center justify-between gap-3 pt-3.5 border-t border-white/[0.05]">
          <div className="min-w-0 text-[10px] text-[#89867D]">
            {isClosed ? (
              <span className="inline-flex items-center gap-1.5"><Clock3 size={12} />Bidding has ended</span>
            ) : (
              <span className="inline-flex flex-wrap items-center gap-1.5">
                <Clock3 size={12} />
                {isRevealing ? 'Reveal closes in' : 'Bidding closes in'} <Countdown endTime={countdownEnd} />
              </span>
            )}
          </div>
          <span className="inline-flex shrink-0 items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.12em] text-[#D5B267] transition group-hover:gap-2">
            View auction <ArrowUpRight size={13} />
          </span>
        </div>
      </div>
    </Link>
  );
}
