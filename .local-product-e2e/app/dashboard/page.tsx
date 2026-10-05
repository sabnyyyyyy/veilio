'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useAccount, usePublicClient } from 'wagmi';
import {
  Activity,
  ArrowDownLeft,
  ArrowRight,
  ArrowUpRight,
  BadgeCheck,
  Clock3,
  Database,
  Gavel,
  LayoutDashboard,
  Plus,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Wallet,
} from 'lucide-react';
import WalletButton from '@/components/WalletButton';
import Countdown from '@/components/Countdown';
import { fetchUserBids, type UserBidItem } from '@/lib/userBids';
import { fetchUserAuctions, type UserAuctionItem } from '@/lib/userAuctions';
import { getUserActivities, type UserActivity } from '@/lib/secretStorage';

const formatRelativeTime = (timestamp: number) => {
  const elapsed = Math.max(0, Date.now() - timestamp);
  if (elapsed < 60_000) return 'Just now';
  if (elapsed < 3_600_000) return `${Math.floor(elapsed / 60_000)}m ago`;
  if (elapsed < 86_400_000) return `${Math.floor(elapsed / 3_600_000)}h ago`;
  return `${Math.floor(elapsed / 86_400_000)}d ago`;
};

const shortAddress = (address?: string) => address ? `${address.slice(0, 6)}…${address.slice(-4)}` : '';

function MetricCard({
  label,
  value,
  detail,
  icon: Icon,
  accent = false,
}: {
  label: string;
  value: number;
  detail: string;
  icon: typeof Gavel;
  accent?: boolean;
}) {
  return (
    <div className="group rounded-2xl border border-white/[0.08] bg-[#11110F] p-5 transition duration-200 hover:-translate-y-0.5 hover:border-[#C9A45C]/30 hover:bg-[#14130F] sm:p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-medium text-[#A8A397]">{label}</p>
          <p className={`mt-4 text-3xl font-semibold tracking-tight ${accent ? 'text-[#E6CC91]' : 'text-[#F5F2E8]'}`}>
            {String(value).padStart(2, '0')}
          </p>
          <p className="mt-1 text-xs text-[#77746B]">{detail}</p>
        </div>
        <span className={`flex h-10 w-10 items-center justify-center rounded-xl border ${accent ? 'border-[#C9A45C]/20 bg-[#C9A45C]/10 text-[#C9A45C]' : 'border-white/[0.08] bg-white/[0.03] text-[#A8A397]'}`}>
          <Icon size={18} strokeWidth={1.7} />
        </span>
      </div>
    </div>
  );
}

function SectionTitle({
  eyebrow,
  title,
  href,
  linkLabel = 'View all',
}: {
  eyebrow: string;
  title: string;
  href?: string;
  linkLabel?: string;
}) {
  return (
    <div className="mb-5 flex items-end justify-between gap-4">
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[#C9A45C]">{eyebrow}</p>
        <h2 className="mt-1.5 text-lg font-semibold tracking-tight text-[#F5F2E8]">{title}</h2>
      </div>
      {href && (
        <Link href={href} className="inline-flex shrink-0 items-center gap-1.5 text-xs font-medium text-[#A8A397] transition hover:text-[#E6CC91]">
          {linkLabel}<ArrowUpRight size={14} />
        </Link>
      )}
    </div>
  );
}

function StatusPill({ children, tone = 'neutral' }: { children: React.ReactNode; tone?: 'neutral' | 'gold' | 'green' }) {
  const tones = {
    neutral: 'border-white/10 bg-white/[0.04] text-[#A8A397]',
    gold: 'border-[#C9A45C]/20 bg-[#C9A45C]/10 text-[#E6CC91]',
    green: 'border-emerald-400/20 bg-emerald-400/[0.08] text-emerald-300',
  };
  return <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-medium ${tones[tone]}`}><span className="h-1.5 w-1.5 rounded-full bg-current" />{children}</span>;
}

function EmptyPanel({ title, detail, href, action }: { title: string; detail: string; href: string; action: string }) {
  return (
    <div className="rounded-xl border border-dashed border-white/[0.12] bg-white/[0.015] px-5 py-8 text-center sm:px-8">
      <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-xl border border-white/[0.08] bg-white/[0.03] text-[#A8A397]"><Sparkles size={17} /></div>
      <h3 className="mt-3 text-sm font-semibold text-[#F5F2E8]">{title}</h3>
      <p className="mx-auto mt-1 max-w-sm text-xs leading-5 text-[#89867D]">{detail}</p>
      <Link href={href} className="mt-4 inline-flex items-center gap-2 rounded-lg border border-white/10 px-3.5 py-2 text-xs font-semibold text-[#E6CC91] transition hover:border-[#C9A45C]/40 hover:bg-[#C9A45C]/[0.06]">
        {action}<ArrowRight size={14} />
      </Link>
    </div>
  );
}

export default function DashboardPage() {
  const { address, isConnected } = useAccount();
  const publicClient = usePublicClient();
  const [bids, setBids] = useState<UserBidItem[]>([]);
  const [auctions, setAuctions] = useState<UserAuctionItem[]>([]);
  const [activities, setActivities] = useState<UserActivity[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const loadWorkspace = useCallback(async () => {
    if (!address || !publicClient) return;
    setIsLoading(true);
    setError(null);
    try {
      const [nextBids, nextAuctions] = await Promise.all([
        fetchUserBids(publicClient, address),
        fetchUserAuctions(publicClient, address),
      ]);
      setBids(nextBids);
      setAuctions(nextAuctions);
      setActivities(getUserActivities(address));
    } catch (cause) {
      console.error('Failed to load dashboard:', cause);
      setError('We could not load your on-chain activity. Check your connection and try again.');
    } finally {
      setIsLoading(false);
    }
  }, [address, publicClient]);

  useEffect(() => {
    if (isConnected && address && publicClient) {
      void loadWorkspace();
    } else {
      setBids([]);
      setAuctions([]);
      setActivities([]);
      setIsLoading(false);
    }
  }, [address, isConnected, loadWorkspace, publicClient, refreshKey]);

  const needsReveal = useMemo(
    () => bids.filter((bid) => bid.auctionStatus === 'Revealing' && !bid.revealed && Date.now() <= bid.revealEndTime),
    [bids],
  );
  const activeBids = bids.filter((bid) => bid.state < 6);
  const wonBids = bids.filter((bid) => bid.state === 6 && bid.isWinner);
  const completedBids = bids.filter((bid) => bid.state >= 6);

  if (!isConnected || !address) {
    return (
      <main className="min-h-[calc(100vh-5rem)] bg-[#0A0A09] px-5 py-16 sm:px-8 sm:py-24">
        <div className="mx-auto max-w-md rounded-3xl border border-white/[0.08] bg-[#11110F] p-8 text-center shadow-2xl shadow-black/20 sm:p-10">
          <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border border-[#C9A45C]/20 bg-[#C9A45C]/[0.08] text-[#C9A45C]"><Wallet size={23} /></span>
          <p className="mt-6 text-[10px] font-semibold uppercase tracking-[0.2em] text-[#C9A45C]">VEILIO workspace</p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight text-[#F5F2E8]">Connect your wallet</h1>
          <p className="mt-3 text-sm leading-6 text-[#A8A397]">Your bids, auctions, and secured assets will be organized here.</p>
          <div className="mt-6 flex justify-center"><WalletButton /></div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#0A0A09] pb-16">
      <div className="mx-auto max-w-7xl px-5 pt-8 sm:px-8 sm:pt-10 lg:px-10">
        <div className="mb-8 flex flex-col justify-between gap-5 border-b border-white/[0.08] pb-7 sm:flex-row sm:items-end">
          <div>
            <div className="mb-3 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-[#C9A45C]">
              <LayoutDashboard size={13} /> VEILIO / WORKSPACE
            </div>
            <h1 className="text-3xl font-semibold tracking-tight text-[#F5F2E8] sm:text-4xl">Your dashboard<span className="text-[#C9A45C]">.</span></h1>
            <p className="mt-2 max-w-xl text-sm leading-6 text-[#A8A397]">A clear view of your auctions, private bids, and the next step to take.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2.5">
            <div className="inline-flex items-center gap-2 rounded-lg border border-white/[0.08] bg-white/[0.025] px-3 py-2 text-xs text-[#A8A397]">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />BNB Chain · {shortAddress(address)}
            </div>
            <button
              type="button"
              onClick={() => setRefreshKey((value) => value + 1)}
              disabled={isLoading}
              aria-label="Refresh dashboard"
              className="flex h-9 w-9 items-center justify-center rounded-lg border border-white/[0.08] text-[#A8A397] transition hover:border-white/20 hover:text-[#F5F2E8] disabled:opacity-40"
            ><RefreshCw size={15} className={isLoading ? 'animate-spin' : ''} /></button>
            <Link href="/create" className="inline-flex h-9 items-center gap-2 rounded-lg bg-[#C9A45C] px-3.5 text-xs font-bold text-[#11100D] transition hover:bg-[#E6CC91]">
              <Plus size={15} /> Create auction
            </Link>
          </div>
        </div>

        {error && (
          <div role="alert" className="mb-6 flex flex-col gap-3 rounded-xl border border-red-400/20 bg-red-400/[0.06] px-4 py-3 text-sm text-red-200 sm:flex-row sm:items-center sm:justify-between">
            <span>{error}</span><button onClick={() => setRefreshKey((value) => value + 1)} className="font-semibold text-red-100 hover:underline">Try again</button>
          </div>
        )}

        <section aria-label="Activity summary" className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <MetricCard label="Active bids" value={activeBids.length} detail="Your open commitments" icon={Gavel} />
          <MetricCard label="Auctions created" value={auctions.length} detail="Listed from this wallet" icon={Activity} />
          <MetricCard label="Needs your attention" value={needsReveal.length} detail="Reveal window is open" icon={Clock3} accent={needsReveal.length > 0} />
          <MetricCard label="Auctions won" value={wonBids.length} detail="Successful bid outcomes" icon={BadgeCheck} />
        </section>

        <section className="mt-8 grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.55fr)_minmax(300px,0.8fr)]">
          <div className="rounded-2xl border border-white/[0.08] bg-[#11110F] p-5 sm:p-6">
            <SectionTitle eyebrow="Priority" title="Next actions" href="/my-bids" linkLabel="All bids" />
            {isLoading ? (
              <div className="space-y-3" aria-label="Loading actions"><div className="h-[76px] animate-pulse rounded-xl bg-white/[0.04]" /><div className="h-[76px] animate-pulse rounded-xl bg-white/[0.04]" /></div>
            ) : needsReveal.length > 0 ? (
              <div className="space-y-3">
                {needsReveal.slice(0, 3).map((bid) => (
                  <div key={bid.auctionId} className="flex flex-col gap-3 rounded-xl border border-[#C9A45C]/20 bg-[#C9A45C]/[0.045] p-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex min-w-0 items-center gap-3">
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-[#C9A45C]/20 bg-[#C9A45C]/[0.08] text-[#C9A45C]"><Clock3 size={17} /></span>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2"><p className="truncate text-sm font-semibold text-[#F5F2E8]">{bid.itemName}</p><StatusPill tone="gold">Reveal open</StatusPill></div>
                        <p className="mt-1 text-xs text-[#A8A397]">Auction #{bid.auctionId} · Ends in <Countdown endTime={bid.revealEndTime} /></p>
                      </div>
                    </div>
                    <Link href={`/auctions/${bid.auctionId}`} className="inline-flex shrink-0 items-center justify-center gap-2 rounded-lg bg-[#C9A45C] px-3.5 py-2.5 text-xs font-bold text-[#11100D] transition hover:bg-[#E6CC91]">
                      Reveal bid<ArrowRight size={14} />
                    </Link>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyPanel
                title={bids.length ? 'You’re all caught up' : 'No pending actions'}
                detail={bids.length ? 'We’ll highlight a bid here when its reveal period opens.' : 'Join an auction to keep your private bids and next steps in one place.'}
                href={bids.length ? '/auctions' : '/auctions'}
                action={bids.length ? 'Browse auctions' : 'Explore auctions'}
              />
            )}
          </div>

          <div className="rounded-2xl border border-white/[0.08] bg-[#11110F] p-5 sm:p-6">
            <SectionTitle eyebrow="Your activity" title="At a glance" />
            <div className="space-y-1">
              <Link href="/my-bids" className="group flex items-center justify-between rounded-xl px-3 py-3 transition hover:bg-white/[0.035]">
                <span className="flex items-center gap-3"><span className="flex h-9 w-9 items-center justify-center rounded-lg bg-white/[0.04] text-[#A8A397]"><Gavel size={16} /></span><span><span className="block text-sm font-medium text-[#F5F2E8]">My bids</span><span className="mt-0.5 block text-[11px] text-[#77746B]">Commitments and reveal status</span></span></span>
                <span className="flex items-center gap-2 text-xs text-[#A8A397]">{bids.length}<ArrowRight size={14} className="transition group-hover:translate-x-0.5 group-hover:text-[#E6CC91]" /></span>
              </Link>
              <Link href="/my-auctions" className="group flex items-center justify-between rounded-xl px-3 py-3 transition hover:bg-white/[0.035]">
                <span className="flex items-center gap-3"><span className="flex h-9 w-9 items-center justify-center rounded-lg bg-white/[0.04] text-[#A8A397]"><Database size={16} /></span><span><span className="block text-sm font-medium text-[#F5F2E8]">My auctions</span><span className="mt-0.5 block text-[11px] text-[#77746B]">Listings created by your wallet</span></span></span>
                <span className="flex items-center gap-2 text-xs text-[#A8A397]">{auctions.length}<ArrowRight size={14} className="transition group-hover:translate-x-0.5 group-hover:text-[#E6CC91]" /></span>
              </Link>
              <Link href="/seller-analytics" className="group flex items-center justify-between rounded-xl px-3 py-3 transition hover:bg-white/[0.035]">
                <span className="flex items-center gap-3"><span className="flex h-9 w-9 items-center justify-center rounded-lg bg-white/[0.04] text-[#A8A397]"><ArrowDownLeft size={16} /></span><span><span className="block text-sm font-medium text-[#F5F2E8]">Seller analytics</span><span className="mt-0.5 block text-[11px] text-[#77746B]">Performance and settlement</span></span></span>
                <ArrowRight size={14} className="text-[#77746B] transition group-hover:translate-x-0.5 group-hover:text-[#E6CC91]" />
              </Link>
            </div>
            <div className="mt-4 flex items-start gap-2.5 rounded-xl border border-white/[0.06] bg-white/[0.02] p-3.5">
              <ShieldCheck size={16} className="mt-0.5 shrink-0 text-[#C9A45C]" />
              <p className="text-[11px] leading-5 text-[#89867D]">Your bid amount stays private during the commit phase. Keep your wallet connected to manage each auction.</p>
            </div>
          </div>
        </section>

        <section className="mt-8 grid grid-cols-1 gap-5 lg:grid-cols-2">
          <div className="rounded-2xl border border-white/[0.08] bg-[#11110F] p-5 sm:p-6">
            <SectionTitle eyebrow="Seller workspace" title="Your auctions" href="/my-auctions" />
            {isLoading ? (
              <div className="h-24 animate-pulse rounded-xl bg-white/[0.04]" />
            ) : auctions.length > 0 ? (
              <div className="divide-y divide-white/[0.06]">
                {auctions.slice(0, 4).map((auction) => (
                  <Link key={auction.id} href={`/auctions/${auction.id}`} className="group flex items-center justify-between gap-3 py-3.5 first:pt-0 last:pb-0">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-[#F5F2E8] transition group-hover:text-[#E6CC91]">{auction.itemName}</p>
                      <p className="mt-1 text-[11px] text-[#77746B]">Auction #{auction.id} · {auction.bidderCount} {auction.bidderCount === 1 ? 'bid' : 'bids'} · Starts at {auction.startingPrice} BNB</p>
                    </div>
                    <StatusPill tone={auction.status === 'Bidding' ? 'green' : auction.status === 'Revealing' ? 'gold' : 'neutral'}>{auction.status}</StatusPill>
                  </Link>
                ))}
              </div>
            ) : (
              <EmptyPanel title="No listings yet" detail="Put a digital asset up for sealed bidding and track it from this workspace." href="/create" action="Create your first auction" />
            )}
          </div>

          <div className="rounded-2xl border border-white/[0.08] bg-[#11110F] p-5 sm:p-6">
            <SectionTitle eyebrow="Bidder workspace" title="Recent bids" href="/my-bids" />
            {isLoading ? (
              <div className="h-24 animate-pulse rounded-xl bg-white/[0.04]" />
            ) : bids.length > 0 ? (
              <div className="divide-y divide-white/[0.06]">
                {bids.slice(0, 4).map((bid) => (
                  <Link key={bid.auctionId} href={`/auctions/${bid.auctionId}`} className="group flex items-center justify-between gap-3 py-3.5 first:pt-0 last:pb-0">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-[#F5F2E8] transition group-hover:text-[#E6CC91]">{bid.itemName}</p>
                      <p className="mt-1 text-[11px] text-[#77746B]">Auction #{bid.auctionId} · Deposit {bid.deposit} BNB</p>
                    </div>
                    <StatusPill tone={bid.state === 6 ? 'green' : bid.state === 4 || bid.state === 5 ? 'gold' : bid.state === 7 || bid.state === 8 ? 'neutral' : bid.revealed ? 'green' : bid.auctionStatus === 'Revealing' && Date.now() <= bid.revealEndTime ? 'gold' : 'neutral'}>
                      {bid.state === 3 ? 'Inspection' : bid.state === 4 ? 'Refund review' : bid.state === 5 ? 'Under review' : bid.state === 6 ? (bid.isWinner ? 'Won' : 'Completed') : bid.state === 7 ? 'Refunded' : bid.state === 8 ? 'Cancelled' : bid.revealed ? 'Revealed' : bid.auctionStatus === 'Revealing' ? (Date.now() <= bid.revealEndTime ? 'Reveal needed' : 'Reveal ended') : 'Bid sealed'}
                    </StatusPill>
                  </Link>
                ))}
              </div>
            ) : (
              <EmptyPanel title="Your bids will show up here" detail="Browse open listings and commit a private bid when you find the right asset." href="/auctions" action="Explore auctions" />
            )}
          </div>
        </section>

        <section className="mt-8 rounded-2xl border border-white/[0.08] bg-[#11110F] p-5 sm:p-6">
          <SectionTitle eyebrow="History" title="Recent activity" />
          {isLoading ? (
            <div className="h-16 animate-pulse rounded-xl bg-white/[0.04]" />
          ) : activities.length > 0 ? (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
              {activities.slice(0, 6).map((activity) => (
                <Link key={activity.id} href={`/auctions/${activity.auctionId}`} className="flex min-w-0 items-center gap-3 rounded-xl border border-white/[0.05] px-3 py-3 transition hover:border-white/[0.12] hover:bg-white/[0.025]">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/[0.04] text-[#A8A397]">
                    {activity.type === 'auction_created' ? <Database size={15} /> : activity.type === 'refund_withdrawn' ? <ArrowDownLeft size={15} /> : <Gavel size={15} />}
                  </span>
                  <span className="min-w-0 flex-1"><span className="block truncate text-xs font-medium text-[#E8E4D9]">{activity.type.replaceAll('_', ' ')}</span><span className="mt-1 block truncate text-[10px] text-[#77746B]">{activity.itemName} · {formatRelativeTime(activity.timestamp)}</span></span>
                  <ArrowUpRight size={13} className="shrink-0 text-[#77746B]" />
                </Link>
              ))}
            </div>
          ) : (
            <div className="flex flex-col items-start justify-between gap-3 rounded-xl border border-dashed border-white/[0.1] px-4 py-4 sm:flex-row sm:items-center">
              <div><p className="text-sm font-medium text-[#E8E4D9]">Your activity starts here</p><p className="mt-1 text-xs text-[#89867D]">Create a listing or place a bid to build your on-chain history.</p></div>
              <Link href="/auctions" className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#E6CC91] hover:text-[#F5F2E8]">Browse auctions<ArrowRight size={14} /></Link>
            </div>
          )}
        </section>

        {completedBids.length > 0 && (
          <section className="mt-5 flex flex-col gap-3 rounded-xl border border-emerald-400/10 bg-emerald-400/[0.025] px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between">
            <p className="flex items-center gap-2 text-xs text-[#A8A397]"><BadgeCheck size={15} className="text-emerald-300" />You have {completedBids.length} settled {completedBids.length === 1 ? 'bid' : 'bids'} on record.</p>
            <Link href="/my-bids" className="inline-flex items-center gap-1.5 text-xs font-medium text-[#E6CC91] hover:text-[#F5F2E8]">View bid history<ArrowRight size={13} /></Link>
          </section>
        )}
      </div>
    </main>
  );
}
