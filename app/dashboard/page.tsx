'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useAccount, useChainId, usePublicClient } from 'wagmi';
import { createPublicClient, http } from 'viem';
import {
  Activity,
  ArrowDownLeft,
  ArrowRight,
  ArrowUpRight,
  BadgeCheck,
  Clock3,
  Coins,
  Database,
  FileText,
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
import { bnbChain, baseSepoliaChain } from '@/lib/chain';
import { fetchUserBids, type UserBidItem } from '@/lib/userBids';
import { fetchUserAuctions, type UserAuctionItem } from '@/lib/userAuctions';
import {
  getConnectedSolanaAddress,
  setStoredSolanaAddress,
  getMergedActivities,
  subscribeToActivityUpdates,
  type MergedActivityItem,
} from '@/lib/walletStorage';

const defaultBnbClient = createPublicClient({
  chain: bnbChain,
  transport: http(bnbChain.rpcUrls.default.http[0]),
});

const defaultBaseClient = createPublicClient({
  chain: baseSepoliaChain,
  transport: http(baseSepoliaChain.rpcUrls.default.http[0]),
});

const formatRelativeTime = (timestamp: number) => {
  const elapsed = Math.max(0, Date.now() - timestamp);
  if (elapsed < 60_000) return 'Just now';
  if (elapsed < 3_600_000) return `${Math.floor(elapsed / 60_000)}m ago`;
  if (elapsed < 86_400_000) return `${Math.floor(elapsed / 3_600_000)}h ago`;
  return `${Math.floor(elapsed / 86_400_000)}d ago`;
};

const shortAddress = (address?: string | null) => (address ? `${address.slice(0, 6)}…${address.slice(-4)}` : '');

type DashboardNetwork = 'bnb' | 'base' | 'solana';

const DASHBOARD_NETWORKS: Record<DashboardNetwork, { label: string; symbol: string; logo: string; networkId: 'bnb:97' | 'base:84532' | 'solana:devnet'; query: string }> = {
  bnb: { label: 'BNB Chain', symbol: 'BNB', logo: '/logos/chains/bnb-chain.svg', networkId: 'bnb:97', query: '' },
  base: { label: 'Base Sepolia', symbol: 'ETH', logo: '/logos/chains/base.svg', networkId: 'base:84532', query: '?network=base' },
  solana: { label: 'Solana Devnet', symbol: 'SOL', logo: '/logos/chains/solana.svg', networkId: 'solana:devnet', query: '?network=solana' },
};

type SolanaDashboardData = {
  network: string;
  wallet: string;
  auctions: Array<{
    address: string;
    id: string;
    itemName: string;
    startingPrice: string;
    bidderCount: number;
    commitEndTime: number;
    revealEndTime: number;
    status: string;
  }>;
  bids: Array<{
    auctionAddress: string;
    auctionId: string;
    itemName: string;
    deposit: string;
    state: number;
    stateLabel: string;
    revealed: boolean;
    needsReveal: boolean;
    isWinner: boolean;
  }>;
};

type ProfileData = {
  id: string;
  primaryWallet: string;
  linkedWallets: Array<{
    address: string;
    chainFamily: 'evm' | 'solana';
    networkId: string;
    isPrimary: boolean;
    status: 'active' | 'unlinked';
  }>;
};

function MetricCard({
  label,
  value,
  detail,
  icon: Icon,
  accent = false,
  status = 'ready',
}: {
  label: string;
  value: number | null;
  detail: string;
  icon: typeof Gavel;
  accent?: boolean;
  status?: 'loading' | 'ready' | 'error';
}) {
  return (
    <div className="group min-w-0 rounded-2xl border border-white/[0.08] bg-[#11110F] p-5 transition duration-200 hover:-translate-y-0.5 hover:border-[#C9A45C]/30 hover:bg-[#14130F] sm:p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-medium text-[#A8A397]">{label}</p>
          <div className="mt-4 flex items-baseline gap-2">
            {status === 'loading' ? (
              <span className="inline-block h-8 w-12 animate-pulse rounded bg-white/[0.06]" />
            ) : status === 'error' && value === null ? (
              <span className="text-2xl font-semibold tracking-tight text-amber-400/90">—</span>
            ) : (
              <p className={`text-3xl font-semibold tracking-tight ${accent ? 'text-[#E6CC91]' : 'text-[#F5F2E8]'}`}>
                {String(value ?? 0).padStart(2, '0')}
              </p>
            )}
          </div>
          <p className={`mt-1 text-xs ${status === 'error' ? 'text-amber-400/80' : 'text-[#77746B]'}`}>{detail}</p>
        </div>
        <span
          className={`flex h-10 w-10 items-center justify-center rounded-xl border ${
            accent
              ? 'border-[#C9A45C]/20 bg-[#C9A45C]/10 text-[#C9A45C]'
              : 'border-white/[0.08] bg-white/[0.03] text-[#A8A397]'
          }`}
        >
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
        <Link
          href={href}
          className="inline-flex shrink-0 items-center gap-1.5 text-xs font-medium text-[#A8A397] transition hover:text-[#E6CC91]"
        >
          {linkLabel}
          <ArrowUpRight size={14} />
        </Link>
      )}
    </div>
  );
}

function StatusPill({
  children,
  tone = 'neutral',
}: {
  children: React.ReactNode;
  tone?: 'neutral' | 'gold' | 'green' | 'blue' | 'purple';
}) {
  const tones = {
    neutral: 'border-white/10 bg-white/[0.04] text-[#A8A397]',
    gold: 'border-[#C9A45C]/20 bg-[#C9A45C]/10 text-[#E6CC91]',
    green: 'border-emerald-400/20 bg-emerald-400/[0.08] text-emerald-300',
    blue: 'border-sky-400/20 bg-sky-400/[0.08] text-sky-300',
    purple: 'border-[#8B7BFF]/20 bg-[#8B7BFF]/[0.08] text-[#C5BCFF]',
  };
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-medium ${tones[tone]}`}>
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {children}
    </span>
  );
}

function EmptyPanel({
  title,
  detail,
  href,
  action,
}: {
  title: string;
  detail: string;
  href?: string;
  action?: string;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-3 rounded-xl border border-dashed border-white/[0.12] bg-white/[0.015] px-4 py-4 sm:flex-row sm:items-center sm:px-5">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-white/[0.08] bg-white/[0.03] text-[#A8A397]">
          <Sparkles size={15} />
        </div>
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-[#F5F2E8]">{title}</h3>
          <p className="mt-0.5 text-xs leading-5 text-[#89867D]">{detail}</p>
        </div>
      </div>
      {href && action && (
        <Link
          href={href}
          className="inline-flex shrink-0 items-center justify-center gap-2 self-start rounded-lg border border-white/10 px-3 py-2 text-xs font-semibold text-[#E6CC91] transition hover:border-[#C9A45C]/40 hover:bg-[#C9A45C]/[0.06] sm:self-auto"
        >
          {action}
          <ArrowRight size={14} />
        </Link>
      )}
    </div>
  );
}

export default function DashboardPage() {
  const { address, isConnected } = useAccount();
  const currentChainId = useChainId();
  const bnbWagmiClient = usePublicClient({ chainId: bnbChain.id });
  const baseWagmiClient = usePublicClient({ chainId: baseSepoliaChain.id });

  const bnbClient = bnbWagmiClient ?? defaultBnbClient;
  const baseClient = baseWagmiClient ?? defaultBaseClient;

  // Solana Direct Connection State (Phantom, Solflare, etc.)
  const [solanaAddress, setSolanaAddress] = useState<string | null>(null);
  const [solanaConnecting, setSolanaConnecting] = useState(false);

  const [bnbBids, setBnbBids] = useState<UserBidItem[]>([]);
  const [bnbAuctions, setBnbAuctions] = useState<UserAuctionItem[]>([]);
  const [bnbStatus, setBnbStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [bnbError, setBnbError] = useState<string | null>(null);

  const [baseBids, setBaseBids] = useState<UserBidItem[]>([]);
  const [baseAuctions, setBaseAuctions] = useState<UserAuctionItem[]>([]);
  const [baseStatus, setBaseStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [baseError, setBaseError] = useState<string | null>(null);

  const [solanaData, setSolanaData] = useState<SolanaDashboardData | null>(null);
  const [solanaStatus, setSolanaStatus] = useState<'unlinked' | 'loading' | 'ready' | 'error'>('unlinked');
  const [solanaError, setSolanaError] = useState<string | null>(null);

  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [activities, setActivities] = useState<MergedActivityItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);

  // Initialize and track injected Solana wallet
  useEffect(() => {
    const cachedOrInjected = getConnectedSolanaAddress();
    if (cachedOrInjected) {
      setSolanaAddress(cachedOrInjected);
    }

    if (typeof window !== 'undefined') {
      const provider = (window as any).solana;
      if (provider) {
        if (provider.publicKey) {
          const pk = provider.publicKey.toString();
          setSolanaAddress(pk);
          setStoredSolanaAddress(pk);
        }
        const handleAccountChange = (pk: any) => {
          const addr = pk ? pk.toString() : null;
          setSolanaAddress(addr);
          setStoredSolanaAddress(addr);
        };
        provider.on?.('accountChanged', handleAccountChange);
        return () => {
          provider.removeListener?.('accountChanged', handleAccountChange);
        };
      }
    }
  }, []);

  const connectSolanaWallet = async () => {
    if (typeof window === 'undefined' || !(window as any).solana) {
      alert('Phantom or a compatible Solana wallet was not detected. Please install Phantom from https://phantom.app.');
      return;
    }
    try {
      setSolanaConnecting(true);
      const res = await (window as any).solana.connect();
      const pubkey = res.publicKey.toString();
      setSolanaAddress(pubkey);
      setStoredSolanaAddress(pubkey);
    } catch (err: any) {
      console.error('Failed to connect Solana wallet:', err);
    } finally {
      setSolanaConnecting(false);
    }
  };

  const disconnectSolanaWallet = async () => {
    if (typeof window !== 'undefined' && (window as any).solana?.disconnect) {
      try {
        await (window as any).solana.disconnect();
      } catch {
        // ignore
      }
    }
    setSolanaAddress(null);
    setStoredSolanaAddress(null);
  };

  const isEvmConnected = Boolean(isConnected && address);
  const isSolanaConnected = Boolean(solanaAddress);
  const hasConnectedWallet = isEvmConnected || isSolanaConnected;

  const loadWorkspace = useCallback(async () => {
    const effectiveEvmAddress = isConnected && address ? address : null;
    const effectiveSolanaAddress = solanaAddress || null;

    if (!effectiveEvmAddress && !effectiveSolanaAddress) {
      setIsLoading(false);
      return;
    }

    setIsLoading(true);

    // 1. Fetch persistent identity profile
    let currentProfile: ProfileData | null = null;
    try {
      const profileUrl = effectiveEvmAddress
        ? `/api/identity/profile?wallet=${encodeURIComponent(effectiveEvmAddress)}&chain=evm`
        : `/api/identity/profile?wallet=${encodeURIComponent(effectiveSolanaAddress!)}&chain=solana`;

      const profileResponse = await fetch(profileUrl, { cache: 'no-store' });
      if (profileResponse.ok) {
        const profileBody = (await profileResponse.json()) as { profile?: ProfileData };
        if (profileBody.profile?.id) {
          currentProfile = profileBody.profile;
        }
      }
    } catch (e) {
      console.warn('Identity profile fetch error:', e);
    }
    setProfile(currentProfile);

    // 2. Identify linked wallet records across chains
    const bnbLinkedWallet = currentProfile?.linkedWallets?.find(
      (w) => w.status === 'active' && w.chainFamily === 'evm' && (w.networkId === 'bnb:97' || w.networkId === 'bnb:56')
    );
    const baseLinkedWallet = currentProfile?.linkedWallets?.find(
      (w) => w.status === 'active' && w.chainFamily === 'evm' && w.networkId === 'base:84532'
    );
    const solanaLinkedWallet = currentProfile?.linkedWallets?.find(
      (w) => w.status === 'active' && w.chainFamily === 'solana' && (w.networkId === 'solana:devnet' || w.networkId === 'solana:mainnet')
    );

    // 3. EVM Query Target Addresses
    // If EVM address is available, query BNB and Base Sepolia concurrently regardless of active network
    const bnbQueryAddress = (bnbLinkedWallet?.address || effectiveEvmAddress) as `0x${string}` | null;
    const baseQueryAddress = (baseLinkedWallet?.address || effectiveEvmAddress) as `0x${string}` | null;
    const solanaQueryAddress = effectiveSolanaAddress || solanaLinkedWallet?.address || null;

    // 4. Fetch activity per network in isolation
    const bnbFetch = bnbQueryAddress
      ? (async () => {
          setBnbStatus('loading');
          setBnbError(null);
          return Promise.allSettled([
            fetchUserBids(bnbClient, bnbQueryAddress, { chainId: 97 }),
            fetchUserAuctions(bnbClient, bnbQueryAddress, { chainId: 97 }),
          ]);
        })()
      : Promise.resolve(null);

    const baseFetch = baseQueryAddress
      ? (async () => {
          setBaseStatus('loading');
          setBaseError(null);
          return Promise.allSettled([
            fetchUserBids(baseClient, baseQueryAddress, { chainId: 84532 }),
            fetchUserAuctions(baseClient, baseQueryAddress, { chainId: 84532 }),
          ]);
        })()
      : Promise.resolve(null);

    const solanaFetch = solanaQueryAddress
      ? (async () => {
          setSolanaStatus('loading');
          setSolanaError(null);
          const response = await fetch(`/api/solana/dashboard?wallet=${encodeURIComponent(solanaQueryAddress)}`, {
            cache: 'no-store',
          });
          if (!response.ok) {
            const errBody = await response.json().catch(() => ({ error: 'Solana Devnet activity could not be loaded.' }));
            throw new Error(errBody.error || `HTTP ${response.status}`);
          }
          return (await response.json()) as SolanaDashboardData;
        })()
      : Promise.resolve(null);

    // Process BNB result
    const bnbResults = await bnbFetch;
    if (bnbResults) {
      const [bidsResult, auctionsResult] = bnbResults;
      if (bidsResult.status === 'fulfilled' && auctionsResult.status === 'fulfilled') {
        setBnbBids(bidsResult.value);
        setBnbAuctions(auctionsResult.value);
        setBnbStatus('ready');
        setBnbError(null);
      } else {
        const errReason =
          bidsResult.status === 'rejected'
            ? (bidsResult.reason as Error)?.message
            : (auctionsResult.status === 'rejected' ? (auctionsResult.reason as Error)?.message : null);
        console.error('Failed to load BNB activity:', errReason);
        setBnbBids([]);
        setBnbAuctions([]);
        setBnbStatus('error');
        setBnbError('BNB activity could not be loaded. Check your wallet network and try refreshing.');
      }
    } else {
      setBnbBids([]);
      setBnbAuctions([]);
      setBnbStatus('idle');
      setBnbError(null);
    }

    // Process Base result
    const baseResults = await baseFetch;
    if (baseResults) {
      const [baseBidsRes, baseAuctionsRes] = baseResults;
      if (baseBidsRes.status === 'fulfilled' && baseAuctionsRes.status === 'fulfilled') {
        setBaseBids(baseBidsRes.value);
        setBaseAuctions(baseAuctionsRes.value);
        setBaseStatus('ready');
        setBaseError(null);
      } else {
        const errReason =
          baseBidsRes.status === 'rejected'
            ? (baseBidsRes.reason as Error)?.message
            : (baseAuctionsRes.status === 'rejected' ? (baseAuctionsRes.reason as Error)?.message : null);
        console.error('Failed to load Base activity:', errReason);
        setBaseBids([]);
        setBaseAuctions([]);
        setBaseStatus('error');
        setBaseError('Base Sepolia activity could not be loaded.');
      }
    } else {
      setBaseBids([]);
      setBaseAuctions([]);
      setBaseStatus('idle');
      setBaseError(null);
    }

    // Process Solana result
    if (solanaQueryAddress) {
      try {
        const data = await solanaFetch;
        if (data) {
          setSolanaData(data);
          setSolanaStatus('ready');
          setSolanaError(null);
        }
      } catch (cause: any) {
        console.error('Failed to load Solana dashboard:', cause);
        setSolanaData(null);
        setSolanaStatus('error');
        setSolanaError(cause?.message || 'Solana Devnet could not be reached.');
      }
    } else {
      setSolanaData(null);
      setSolanaStatus('unlinked');
      setSolanaError(null);
    }

    // Process Merged User Activities (auctions and verified service escrow orders)
    const merged = getMergedActivities(effectiveEvmAddress, solanaQueryAddress);
    setActivities(merged);

    setIsLoading(false);
  }, [address, isConnected, solanaAddress, bnbClient, baseClient]);

  // Load and listen for changes
  useEffect(() => {
    if (hasConnectedWallet) {
      void loadWorkspace();
    } else {
      setBnbBids([]);
      setBnbAuctions([]);
      setBnbStatus('idle');
      setBaseBids([]);
      setBaseAuctions([]);
      setBaseStatus('idle');
      setActivities([]);
      setSolanaData(null);
      setSolanaStatus('unlinked');
      setProfile(null);
      setIsLoading(false);
    }
  }, [hasConnectedWallet, loadWorkspace, refreshKey]);

  // Subscribe to real-time activity events across tabs and components
  useEffect(() => {
    return subscribeToActivityUpdates(() => {
      void loadWorkspace();
    });
  }, [loadWorkspace]);

  // Aggregate cross-chain metrics
  // The dashboard follows the wallet's active network: Base Sepolia when the EVM wallet is on 84532,
  // BNB when on 97, Solana when only Phantom is connected. The tabs allow a manual peek at another chain.
  const walletNetwork: DashboardNetwork = isEvmConnected
    ? currentChainId === baseSepoliaChain.id
      ? 'base'
      : 'bnb'
    : 'solana';
  const [viewOverride, setViewOverride] = useState<DashboardNetwork | null>(null);
  useEffect(() => {
    setViewOverride(null);
  }, [walletNetwork]);
  const activeNetwork: DashboardNetwork = viewOverride ?? walletNetwork;
  const activeMeta = DASHBOARD_NETWORKS[activeNetwork];
  const isSolanaView = activeNetwork === 'solana';

  const allBids = useMemo(
    () => (activeNetwork === 'bnb' ? bnbBids : activeNetwork === 'base' ? baseBids : []),
    [activeNetwork, bnbBids, baseBids]
  );
  const allAuctions = useMemo(
    () => (activeNetwork === 'bnb' ? bnbAuctions : activeNetwork === 'base' ? baseAuctions : []),
    [activeNetwork, bnbAuctions, baseAuctions]
  );
  const visibleActivities = useMemo(
    () => activities.filter((activity) => !activity.networkId || activity.networkId === activeMeta.networkId),
    [activities, activeMeta.networkId]
  );

  const needsReveal = useMemo(
    () => allBids.filter((bid) => bid.auctionStatus === 'Revealing' && !bid.revealed && Date.now() <= bid.revealEndTime),
    [allBids]
  );
  const activeBids = useMemo(() => allBids.filter((bid) => bid.state < 6), [allBids]);
  const wonBids = useMemo(() => allBids.filter((bid) => bid.state === 6 && bid.isWinner), [allBids]);
  const completedBids = useMemo(() => allBids.filter((bid) => bid.state >= 6), [allBids]);

  const solanaBids = solanaData?.bids ?? [];
  const solanaAuctions = solanaData?.auctions ?? [];

  const activeNetworkStatus = activeNetwork === 'bnb' ? bnbStatus : activeNetwork === 'base' ? baseStatus : solanaStatus;
  const statsMetricStatus =
    activeNetworkStatus === 'loading' || (isLoading && activeNetworkStatus !== 'ready' && activeNetworkStatus !== 'error')
      ? 'loading'
      : activeNetworkStatus === 'error'
      ? 'error'
      : 'ready';

  const allActiveBidCount =
    statsMetricStatus === 'error' ? null : isSolanaView ? solanaBids.filter((bid) => bid.state < 3).length : activeBids.length;

  const allNeedsRevealCount =
    statsMetricStatus === 'error' ? null : isSolanaView ? solanaBids.filter((bid) => bid.needsReveal).length : needsReveal.length;

  const allWonCount =
    statsMetricStatus === 'error' ? null : isSolanaView ? solanaBids.filter((bid) => bid.isWinner).length : wonBids.length;

  const allAuctionCount = statsMetricStatus === 'error' ? null : isSolanaView ? solanaAuctions.length : allAuctions.length;

  // Active provider and linked identity wallets
  const bnbLinkedWallet = profile?.linkedWallets?.find(
    (w) => w.status === 'active' && w.chainFamily === 'evm' && (w.networkId === 'bnb:97' || w.networkId === 'bnb:56')
  );
  const baseLinkedWallet = profile?.linkedWallets?.find(
    (w) => w.status === 'active' && w.chainFamily === 'evm' && w.networkId === 'base:84532'
  );
  const solanaLinkedWallet = profile?.linkedWallets?.find(
    (w) => w.status === 'active' && w.chainFamily === 'solana' && (w.networkId === 'solana:devnet' || w.networkId === 'solana:mainnet')
  );

  const bnbDisplayAddress = bnbLinkedWallet?.address || (isEvmConnected ? address : null);
  const baseDisplayAddress = baseLinkedWallet?.address || (isEvmConnected ? address : null);
  const solanaDisplayAddress = solanaAddress || solanaLinkedWallet?.address || solanaData?.wallet || null;

  // Disconnected view (requires either EVM or Solana wallet to proceed)
  if (!hasConnectedWallet) {
    return (
      <main className="min-h-[calc(100vh-5rem)] bg-[#0A0A09] px-5 py-16 sm:px-8 sm:py-24">
        <div className="mx-auto max-w-md rounded-3xl border border-white/[0.08] bg-[#11110F] p-8 text-center shadow-2xl shadow-black/20 sm:p-10">
          <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border border-[#C9A45C]/20 bg-[#C9A45C]/[0.08] text-[#C9A45C]">
            <Wallet size={23} />
          </span>
          <p className="mt-6 text-[10px] font-semibold uppercase tracking-[0.2em] text-[#C9A45C]">VEILIO workspace</p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight text-[#F5F2E8]">Connect your wallet</h1>
          <p className="mt-3 text-sm leading-6 text-[#A8A397]">
            Connect your EVM wallet (MetaMask) or Solana wallet (Phantom) to view your bids, auctions, and service escrow orders.
          </p>
          <div className="mt-6 flex flex-col sm:flex-row items-center justify-center gap-3">
            <WalletButton />
            <button
              type="button"
              onClick={connectSolanaWallet}
              disabled={solanaConnecting}
              className="flex items-center justify-center h-12 px-5 text-[12px] font-bold uppercase tracking-wider rounded-md border border-[#8B7BFF]/30 bg-[#8B7BFF]/10 text-[#C5BCFF] hover:bg-[#8B7BFF]/20 active:scale-[0.98] transition-all duration-200 shadow-sm"
            >
              {solanaConnecting ? 'Connecting…' : 'Connect Phantom'}
            </button>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#0A0A09] pb-16">
      <div className="mx-auto w-full min-w-0 max-w-7xl px-5 pt-8 sm:px-8 sm:pt-10 lg:px-10">
        <div className="mb-8 min-w-0 border-b border-white/[0.08] pb-7">
          <div>
            <div className="mb-3 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-[#C9A45C]">
              <LayoutDashboard size={13} /> VEILIO / WORKSPACE
            </div>
            <h1 className="text-3xl font-semibold tracking-tight text-[#F5F2E8] sm:text-4xl">
              Your dashboard<span className="text-[#C9A45C]">.</span>
            </h1>
            <p className="mt-2 max-w-xl text-sm leading-6 text-[#A8A397]">
              Your auctions, bid commitments, and next steps on <span className="text-[#E6CC91]">{activeMeta.label}</span>. Switch your wallet network to see another chain.
            </p>
            <div role="tablist" aria-label="Dashboard network" className="mt-4 inline-flex rounded-xl border border-white/[0.08] bg-[#11110F] p-1">
              {(Object.keys(DASHBOARD_NETWORKS) as DashboardNetwork[]).map((key) => {
                const meta = DASHBOARD_NETWORKS[key];
                const selected = key === activeNetwork;
                return (
                  <button
                    key={key}
                    type="button"
                    role="tab"
                    aria-selected={selected}
                    onClick={() => setViewOverride(key === walletNetwork ? null : key)}
                    className={`inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#C9A45C]/60 ${
                      selected ? 'bg-[#C9A45C]/15 text-[#E6CC91] ring-1 ring-[#C9A45C]/40' : 'text-[#A8A397] hover:text-[#F5F2E8]'
                    }`}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={meta.logo} alt="" width={14} height={14} className="h-3.5 w-3.5" />
                    {meta.label}
                    {key === walletNetwork && <span className="text-[9px] font-medium text-emerald-300/80">wallet</span>}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="mt-5 flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            {/* Multichain Wallet Aggregation Badges */}
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              {/* BNB Chain Badge */}
              {bnbDisplayAddress ? (
                <div
                  title={`BNB Chain Testnet · ${bnbDisplayAddress}${currentChainId === 97 ? ' (Active provider network)' : ''}`}
                  className="inline-flex max-w-full min-w-0 items-center gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/[0.06] px-3 py-2 text-xs text-emerald-300"
                >
                  <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-400" />
                  <span className="truncate">
                    BNB Chain · {shortAddress(bnbDisplayAddress)}
                    {currentChainId === 97 && isEvmConnected && (
                      <span className="ml-1 text-[10px] font-semibold text-emerald-400/80">(Active)</span>
                    )}
                  </span>
                </div>
              ) : (
                <Link
                  href="/identity"
                  title="Link or Connect BNB Chain in Multichain Identity"
                  className="inline-flex max-w-full min-w-0 items-center gap-2 rounded-lg border border-dashed border-white/10 bg-white/[0.02] px-3 py-2 text-xs text-[#77746B] transition hover:text-[#A8A397]"
                >
                  <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-white/20" />
                  <span className="truncate">BNB Chain · Not connected</span>
                </Link>
              )}

              {/* Base Sepolia Badge */}
              {baseDisplayAddress ? (
                <div
                  title={`Base Sepolia · ${baseDisplayAddress}${currentChainId === 84532 ? ' (Active provider network)' : ''}`}
                  className="inline-flex max-w-full min-w-0 items-center gap-2 rounded-lg border border-sky-500/20 bg-sky-500/[0.06] px-3 py-2 text-xs text-sky-300"
                >
                  <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-sky-400" />
                  <span className="truncate">
                    Base Sepolia · {shortAddress(baseDisplayAddress)}
                    {currentChainId === 84532 && isEvmConnected && (
                      <span className="ml-1 text-[10px] font-semibold text-sky-400/80">(Active)</span>
                    )}
                  </span>
                </div>
              ) : (
                <Link
                  href="/identity"
                  title="Link or Connect Base Sepolia in Multichain Identity"
                  className="inline-flex max-w-full min-w-0 items-center gap-2 rounded-lg border border-dashed border-white/10 bg-white/[0.02] px-3 py-2 text-xs text-[#77746B] transition hover:text-[#A8A397]"
                >
                  <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-white/20" />
                  <span className="truncate">Base Sepolia · Not connected</span>
                </Link>
              )}

              {/* Solana Devnet Badge */}
              {solanaAddress ? (
                <div
                  title={`Solana Devnet · ${solanaAddress} (Active provider wallet)`}
                  className="inline-flex max-w-full min-w-0 items-center gap-2 rounded-lg border border-[#8B7BFF]/30 bg-[#8B7BFF]/[0.08] px-3 py-2 text-xs text-[#C5BCFF]"
                >
                  <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[#8B7BFF] animate-pulse" />
                  <span className="truncate">
                    Solana Devnet · {shortAddress(solanaAddress)}
                    <span className="ml-1 text-[10px] font-semibold text-[#8B7BFF]">(Active)</span>
                  </span>
                  <button
                    type="button"
                    onClick={disconnectSolanaWallet}
                    title="Disconnect Phantom"
                    className="ml-0.5 text-xs text-[#8985A5] hover:text-white"
                  >
                    ×
                  </button>
                </div>
              ) : solanaDisplayAddress ? (
                <div
                  title={`Solana Devnet · ${solanaDisplayAddress}`}
                  className="inline-flex max-w-full min-w-0 items-center gap-2 rounded-lg border border-[#8B7BFF]/20 bg-[#8B7BFF]/[0.06] px-3 py-2 text-xs text-[#C5BCFF]"
                >
                  <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[#8B7BFF]" />
                  <span className="truncate">Solana Devnet · {shortAddress(solanaDisplayAddress)}</span>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={connectSolanaWallet}
                  disabled={solanaConnecting}
                  title="Connect Phantom for Solana Devnet"
                  className="inline-flex max-w-full min-w-0 items-center gap-2 rounded-lg border border-dashed border-[#8B7BFF]/30 bg-[#8B7BFF]/[0.03] px-3 py-2 text-xs text-[#B9B2D8] transition hover:text-[#C5BCFF]"
                >
                  <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[#8B7BFF]/40" />
                  <span className="truncate">
                    {solanaConnecting ? 'Connecting Phantom…' : '+ Connect Solana (Phantom)'}
                  </span>
                </button>
              )}
            </div>

            <div className="flex shrink-0 items-center gap-2.5">
              <button
                type="button"
                onClick={() => setRefreshKey((value) => value + 1)}
                disabled={isLoading}
                aria-label="Refresh dashboard"
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-white/[0.08] text-[#A8A397] transition hover:border-white/20 hover:text-[#F5F2E8] disabled:opacity-40"
              >
                <RefreshCw size={15} className={isLoading ? 'animate-spin' : ''} />
              </button>
              <Link
                href="/create"
                className="inline-flex h-9 shrink-0 items-center gap-2 whitespace-nowrap rounded-lg bg-[#C9A45C] px-3.5 text-xs font-bold text-[#11100D] transition hover:bg-[#E6CC91]"
              >
                <Plus size={15} /> Create auction
              </Link>
            </div>
          </div>
        </div>

        {/* Network-Specific Errors & Notices */}
        {activeNetwork === 'bnb' && bnbError && (
          <div
            role="alert"
            className="mb-4 flex flex-col gap-3 rounded-xl border border-red-400/20 bg-red-400/[0.06] px-4 py-3 text-sm text-red-200 sm:flex-row sm:items-center sm:justify-between"
          >
            <span>{bnbError}</span>
            <button onClick={() => setRefreshKey((value) => value + 1)} className="font-semibold text-red-100 hover:underline">
              Retry BNB
            </button>
          </div>
        )}

        {activeNetwork === 'base' && baseError && (
          <div
            role="alert"
            className="mb-4 flex flex-col gap-3 rounded-xl border border-red-400/20 bg-red-400/[0.06] px-4 py-3 text-sm text-red-200 sm:flex-row sm:items-center sm:justify-between"
          >
            <span>{baseError}</span>
            <button onClick={() => setRefreshKey((value) => value + 1)} className="font-semibold text-red-100 hover:underline">
              Retry Base
            </button>
          </div>
        )}

        {isSolanaView && solanaStatus === 'unlinked' && !solanaAddress && !isLoading && (
          <div className="mb-6 flex flex-col gap-2 rounded-xl border border-[#8B7BFF]/15 bg-[#8B7BFF]/[0.04] px-4 py-3 text-xs text-[#B9B2D8] sm:flex-row sm:items-center sm:justify-between">
            <span>Solana Devnet activity is not linked to this identity yet.</span>
            <div className="flex items-center gap-3">
              <button onClick={connectSolanaWallet} className="font-semibold text-[#C5BCFF] hover:underline">
                Connect Phantom
              </button>
              <Link href="/identity" className="font-semibold text-[#C5BCFF] hover:underline">
                Link wallet in Multichain ID <ArrowUpRight size={13} className="ml-1 inline" />
              </Link>
            </div>
          </div>
        )}

        {isSolanaView && solanaStatus === 'error' && (
          <div
            role="status"
            className="mb-6 flex flex-col gap-2 rounded-xl border border-[#8B7BFF]/15 bg-[#8B7BFF]/[0.04] px-4 py-3 text-xs text-[#B9B2D8] sm:flex-row sm:items-center sm:justify-between"
          >
            <span>{solanaError || 'Solana Devnet could not be reached. Other networks remain available.'}</span>
            <button onClick={() => setRefreshKey((value) => value + 1)} className="font-semibold text-[#C5BCFF] hover:underline">
              Retry Solana
            </button>
          </div>
        )}

        {/* Multichain Activity Summary */}
        <section aria-label={`Activity summary on ${activeMeta.label}`} className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <MetricCard
            label="Active bids"
            value={allActiveBidCount}
            detail={statsMetricStatus === 'error' ? `${activeMeta.label} bids unavailable — check network` : `Your ${activeMeta.label} commitments`}
            icon={Gavel}
            status={statsMetricStatus}
          />
          <MetricCard
            label="Auctions created"
            value={allAuctionCount}
            detail={statsMetricStatus === 'error' ? `${activeMeta.label} listings unavailable — check network` : `Your ${activeMeta.label} listings`}
            icon={Activity}
            status={statsMetricStatus}
          />
          <MetricCard
            label="Needs your attention"
            value={allNeedsRevealCount}
            detail="Reveal window is open"
            icon={Clock3}
            accent={(allNeedsRevealCount ?? 0) > 0}
            status={statsMetricStatus}
          />
          <MetricCard
            label="Auctions won"
            value={allWonCount}
            detail="Successful bid outcomes"
            icon={BadgeCheck}
            status={statsMetricStatus}
          />
        </section>

        {/* Actions & Overview */}
        <section className="mt-8 grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.55fr)_minmax(300px,0.8fr)]">
          <div className="rounded-2xl border border-white/[0.08] bg-[#11110F] p-5 sm:p-6">
            <SectionTitle eyebrow="Priority" title="Next actions" href="/my-bids" linkLabel="All bids" />
            {isLoading ? (
              <div className="space-y-3" aria-label="Loading actions">
                <div className="h-[76px] animate-pulse rounded-xl bg-white/[0.04]" />
                <div className="h-[76px] animate-pulse rounded-xl bg-white/[0.04]" />
              </div>
            ) : isSolanaView && solanaBids.some((bid) => bid.needsReveal) ? (
              <div className="space-y-3">
                {solanaBids.filter((bid) => bid.needsReveal).slice(0, 3).map((bid) => (
                  <div
                    key={`solana:${bid.auctionAddress}`}
                    className="flex flex-col gap-3 rounded-xl border border-[#C9A45C]/20 bg-[#C9A45C]/[0.045] p-4 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-[#C9A45C]/20 bg-[#C9A45C]/[0.08] text-[#C9A45C]">
                        <Clock3 size={17} />
                      </span>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="truncate text-sm font-semibold text-[#F5F2E8]">{bid.itemName || `Auction #${bid.auctionId}`}</p>
                          <StatusPill tone="gold">Reveal open</StatusPill>
                        </div>
                        <p className="mt-1 text-xs text-[#A8A397]">Auction #{bid.auctionId} · Solana Devnet</p>
                      </div>
                    </div>
                    <Link
                      href={`/auctions/${bid.auctionId}?network=solana`}
                      className="inline-flex shrink-0 items-center justify-center gap-2 rounded-lg bg-[#C9A45C] px-3.5 py-2.5 text-xs font-bold text-[#11100D] transition hover:bg-[#E6CC91]"
                    >
                      Reveal bid
                      <ArrowRight size={14} />
                    </Link>
                  </div>
                ))}
              </div>
            ) : !isSolanaView && needsReveal.length > 0 ? (
              <div className="space-y-3">
                {needsReveal.slice(0, 3).map((bid) => (
                  <div
                    key={`${bid.networkId || 'evm'}:${bid.auctionId}`}
                    className="flex flex-col gap-3 rounded-xl border border-[#C9A45C]/20 bg-[#C9A45C]/[0.045] p-4 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-[#C9A45C]/20 bg-[#C9A45C]/[0.08] text-[#C9A45C]">
                        <Clock3 size={17} />
                      </span>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="truncate text-sm font-semibold text-[#F5F2E8]">{bid.itemName}</p>
                          <StatusPill tone="gold">Reveal open</StatusPill>
                          {bid.networkId && (
                            <span className="text-[10px] text-[#A8A397]">
                              ({bid.networkId === 'base:84532' ? 'Base' : 'BNB'})
                            </span>
                          )}
                        </div>
                        <p className="mt-1 text-xs text-[#A8A397]">
                          Auction #{bid.auctionId} · Ends in <Countdown endTime={bid.revealEndTime} />
                        </p>
                      </div>
                    </div>
                    <Link
                      href={`/auctions/${bid.auctionId}${activeMeta.query}`}
                      className="inline-flex shrink-0 items-center justify-center gap-2 rounded-lg bg-[#C9A45C] px-3.5 py-2.5 text-xs font-bold text-[#11100D] transition hover:bg-[#E6CC91]"
                    >
                      Reveal bid
                      <ArrowRight size={14} />
                    </Link>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyPanel
                title={(isSolanaView ? solanaBids.length : allBids.length) ? 'You’re all caught up' : 'No pending actions'}
                detail={
                  allBids.length
                    ? 'We’ll highlight a bid here when its reveal period opens.'
                    : 'Join an auction or service escrow to track your commitments and next steps in one place.'
                }
                href="/auctions"
                action={allBids.length ? 'Browse auctions' : 'Explore auctions'}
              />
            )}
          </div>

          <div className="rounded-2xl border border-white/[0.08] bg-[#11110F] p-5 sm:p-6">
            <SectionTitle eyebrow="Your activity" title="At a glance" />
            <div className="space-y-1">
              <Link href="/my-bids" className="group flex items-center justify-between rounded-xl px-3 py-3 transition hover:bg-white/[0.035]">
                <span className="flex items-center gap-3">
                  <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-white/[0.04] text-[#A8A397]">
                    <Gavel size={16} />
                  </span>
                  <span>
                    <span className="block text-sm font-medium text-[#F5F2E8]">Your bids</span>
                    <span className="mt-0.5 block text-[11px] text-[#77746B]">On {activeMeta.label}</span>
                  </span>
                </span>
                <span className="flex items-center gap-2 text-xs text-[#A8A397]">
                  {isSolanaView ? solanaBids.length : allBids.length}
                  <ArrowRight size={14} className="transition group-hover:translate-x-0.5 group-hover:text-[#E6CC91]" />
                </span>
              </Link>
              <Link href="/my-auctions" className="group flex items-center justify-between rounded-xl px-3 py-3 transition hover:bg-white/[0.035]">
                <span className="flex items-center gap-3">
                  <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-white/[0.04] text-[#A8A397]">
                    <Database size={16} />
                  </span>
                  <span>
                    <span className="block text-sm font-medium text-[#F5F2E8]">Your auctions</span>
                    <span className="mt-0.5 block text-[11px] text-[#77746B]">On {activeMeta.label}</span>
                  </span>
                </span>
                <span className="flex items-center gap-2 text-xs text-[#A8A397]">
                  {isSolanaView ? solanaAuctions.length : allAuctions.length}
                  <ArrowRight size={14} className="transition group-hover:translate-x-0.5 group-hover:text-[#E6CC91]" />
                </span>
              </Link>
              <Link href="/services/orders" className="group flex items-center justify-between rounded-xl px-3 py-3 transition hover:bg-white/[0.035]">
                <span className="flex items-center gap-3">
                  <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-white/[0.04] text-[#A8A397]">
                    <Coins size={16} />
                  </span>
                  <span>
                    <span className="block text-sm font-medium text-[#F5F2E8]">Service orders</span>
                    <span className="mt-0.5 block text-[11px] text-[#77746B]">Multichain escrows</span>
                  </span>
                </span>
                <ArrowRight size={14} className="text-[#77746B] transition group-hover:translate-x-0.5 group-hover:text-[#E6CC91]" />
              </Link>
              <Link href="/seller-analytics" className="group flex items-center justify-between rounded-xl px-3 py-3 transition hover:bg-white/[0.035]">
                <span className="flex items-center gap-3">
                  <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-white/[0.04] text-[#A8A397]">
                    <ArrowDownLeft size={16} />
                  </span>
                  <span>
                    <span className="block text-sm font-medium text-[#F5F2E8]">Seller analytics</span>
                    <span className="mt-0.5 block text-[11px] text-[#77746B]">Cross-chain revenue</span>
                  </span>
                </span>
                <ArrowRight size={14} className="text-[#77746B] transition group-hover:translate-x-0.5 group-hover:text-[#E6CC91]" />
              </Link>
            </div>
            <div className="mt-4 flex items-start gap-2.5 rounded-xl border border-white/[0.06] bg-white/[0.02] p-3.5">
              <ShieldCheck size={16} className="mt-0.5 shrink-0 text-[#C9A45C]" />
              <p className="text-[11px] leading-5 text-[#89867D]">
                Showing {activeMeta.label} only. Switch the network in your wallet (or the tabs above) to see another chain.
              </p>
            </div>
          </div>
        </section>

        {/* Solana Devnet Activity Section */}
        {isSolanaView && !solanaData && (
          <section className="mt-8 rounded-2xl border border-[#8B7BFF]/15 bg-[#11110F] p-5 sm:p-6">
            <SectionTitle eyebrow="Solana Devnet" title="Linked wallet activity" />
            {solanaStatus === 'loading' || isLoading ? (
              <div className="h-24 animate-pulse rounded-xl bg-white/[0.04]" />
            ) : (
              <EmptyPanel
                title={solanaStatus === 'error' ? 'Solana Devnet is unavailable' : 'No Solana wallet connected'}
                detail={solanaStatus === 'error' ? 'Retry in a moment; your other networks are unaffected.' : 'Connect Phantom or link a Solana wallet in Identity to see your Solana auctions and bids.'}
                href="/identity"
                action="Open Identity"
              />
            )}
          </section>
        )}
        {isSolanaView && solanaData && (
          <section className="mt-8 rounded-2xl border border-[#8B7BFF]/15 bg-[#11110F] p-5 sm:p-6">
            <SectionTitle eyebrow="Solana Devnet" title="Linked wallet activity" />
            <p className="-mt-3 mb-4 text-xs text-[#8985A5]">
              Read-only on-chain view for {shortAddress(solanaData.wallet)}. Select an item to inspect it in Solana Explorer.
            </p>
            {solanaAuctions.length === 0 && solanaBids.length === 0 ? (
              <div className="rounded-xl border border-dashed border-white/[0.1] px-4 py-3 text-xs text-[#89867D]">
                No Solana Devnet auctions or bids for this wallet yet.
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
                <div>
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[#A8A397]">
                    Your auctions <span className="ml-1 text-[#77746B]">{solanaAuctions.length}</span>
                  </h3>
                  {solanaAuctions.length ? (
                    <div className="divide-y divide-white/[0.06]">
                      {solanaAuctions.slice(0, 5).map((auction) => (
                        <a
                          key={auction.address}
                          href={`https://explorer.solana.com/address/${encodeURIComponent(auction.address)}?cluster=devnet`}
                          target="_blank"
                          rel="noreferrer"
                          className="group flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0"
                        >
                          <span className="min-w-0">
                            <span className="block truncate text-sm font-medium text-[#F5F2E8] group-hover:text-[#C5BCFF]">
                              {auction.itemName || `Auction #${auction.id}`}
                            </span>
                            <span className="mt-1 block text-[11px] text-[#77746B]">
                              Auction #{auction.id} · {auction.bidderCount} {auction.bidderCount === 1 ? 'bid' : 'bids'} · Starts at{' '}
                              {auction.startingPrice} SOL
                            </span>
                          </span>
                          <StatusPill tone={auction.status === 'Bidding' ? 'green' : auction.status === 'Revealing' ? 'gold' : 'neutral'}>
                            {auction.status}
                          </StatusPill>
                        </a>
                      ))}
                    </div>
                  ) : (
                    <p className="py-2 text-xs text-[#89867D]">No auctions created on Solana Devnet.</p>
                  )}
                </div>
                <div>
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[#A8A397]">
                    Your bids <span className="ml-1 text-[#77746B]">{solanaBids.length}</span>
                  </h3>
                  {solanaBids.length ? (
                    <div className="divide-y divide-white/[0.06]">
                      {solanaBids.slice(0, 5).map((bid) => (
                        <a
                          key={`${bid.auctionAddress}:${solanaData.wallet}`}
                          href={`https://explorer.solana.com/address/${encodeURIComponent(bid.auctionAddress)}?cluster=devnet`}
                          target="_blank"
                          rel="noreferrer"
                          className="group flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0"
                        >
                          <span className="min-w-0">
                            <span className="block truncate text-sm font-medium text-[#F5F2E8] group-hover:text-[#C5BCFF]">
                              {bid.itemName || `Auction #${bid.auctionId}`}
                            </span>
                            <span className="mt-1 block text-[11px] text-[#77746B]">
                              Auction #{bid.auctionId} · Deposit {bid.deposit} SOL
                            </span>
                          </span>
                          <StatusPill tone={bid.needsReveal ? 'gold' : bid.isWinner ? 'green' : 'neutral'}>
                            {bid.needsReveal ? 'Reveal needed' : bid.isWinner ? 'Won' : bid.stateLabel}
                          </StatusPill>
                        </a>
                      ))}
                    </div>
                  ) : (
                    <p className="py-2 text-xs text-[#89867D]">No bids placed on Solana Devnet.</p>
                  )}
                </div>
              </div>
            )}
          </section>
        )}

        {/* BNB Chain Section */}
        {activeNetwork === 'bnb' && (
        <section className="mt-8 grid grid-cols-1 gap-5 lg:grid-cols-2">
          <div className="rounded-2xl border border-white/[0.08] bg-[#11110F] p-5 sm:p-6">
            <SectionTitle eyebrow="BNB Chain · Seller workspace" title="Your auctions" href="/my-auctions" />
            {isLoading && bnbStatus === 'loading' ? (
              <div className="h-24 animate-pulse rounded-xl bg-white/[0.04]" />
            ) : bnbAuctions.length > 0 ? (
              <div className="divide-y divide-white/[0.06]">
                {bnbAuctions.slice(0, 4).map((auction) => (
                  <Link key={auction.id} href={`/auctions/${auction.id}`} className="group flex items-center justify-between gap-3 py-3.5 first:pt-0 last:pb-0">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-[#F5F2E8] transition group-hover:text-[#E6CC91]">{auction.itemName}</p>
                      <p className="mt-1 text-[11px] text-[#77746B]">
                        Auction #{auction.id} · {auction.bidderCount} {auction.bidderCount === 1 ? 'bid' : 'bids'} · Starts at {auction.startingPrice} BNB
                      </p>
                    </div>
                    <StatusPill tone={auction.status === 'Bidding' ? 'green' : auction.status === 'Revealing' ? 'gold' : 'neutral'}>
                      {auction.status}
                    </StatusPill>
                  </Link>
                ))}
              </div>
            ) : (
              <EmptyPanel
                title={isEvmConnected ? 'No BNB listings yet' : 'EVM wallet not connected'}
                detail={isEvmConnected ? 'Your BNB listings will appear here after you create an auction.' : 'Connect an EVM wallet to view and manage your BNB Chain auctions.'}
              />
            )}
          </div>

          <div className="rounded-2xl border border-white/[0.08] bg-[#11110F] p-5 sm:p-6">
            <SectionTitle eyebrow="BNB Chain · Bidder workspace" title="Recent bids" href="/my-bids" />
            {isLoading && bnbStatus === 'loading' ? (
              <div className="h-24 animate-pulse rounded-xl bg-white/[0.04]" />
            ) : bnbBids.length > 0 ? (
              <div className="divide-y divide-white/[0.06]">
                {bnbBids.slice(0, 4).map((bid) => (
                  <Link key={bid.auctionId} href={`/auctions/${bid.auctionId}`} className="group flex items-center justify-between gap-3 py-3.5 first:pt-0 last:pb-0">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-[#F5F2E8] transition group-hover:text-[#E6CC91]">{bid.itemName}</p>
                      <p className="mt-1 text-[11px] text-[#77746B]">Auction #{bid.auctionId} · Deposit {bid.deposit} BNB</p>
                    </div>
                    <StatusPill
                      tone={
                        bid.state === 6
                          ? 'green'
                          : bid.state === 4 || bid.state === 5
                          ? 'gold'
                          : bid.state === 7 || bid.state === 8
                          ? 'neutral'
                          : bid.revealed
                          ? 'green'
                          : bid.auctionStatus === 'Revealing' && Date.now() <= bid.revealEndTime
                          ? 'gold'
                          : 'neutral'
                      }
                    >
                      {bid.state === 3
                        ? 'Inspection'
                        : bid.state === 4
                        ? 'Refund review'
                        : bid.state === 5
                        ? 'Under review'
                        : bid.state === 6
                        ? bid.isWinner
                          ? 'Won'
                          : 'Completed'
                        : bid.state === 7
                        ? 'Refunded'
                        : bid.state === 8
                        ? 'Cancelled'
                        : bid.revealed
                        ? 'Revealed'
                        : bid.auctionStatus === 'Revealing'
                        ? Date.now() <= bid.revealEndTime
                          ? 'Reveal needed'
                          : 'Reveal ended'
                        : 'Bid sealed'}
                    </StatusPill>
                  </Link>
                ))}
              </div>
            ) : (
              <EmptyPanel
                title={isEvmConnected ? 'No BNB bids on record' : 'EVM wallet not connected'}
                detail={isEvmConnected ? 'Your BNB commitments will appear here.' : 'Connect an EVM wallet to view your BNB bids.'}
              />
            )}
          </div>
        </section>

        )}

        {/* Base Sepolia Section */}
        {activeNetwork === 'base' && (
          <section className="mt-8 grid grid-cols-1 gap-5 lg:grid-cols-2">
            <div className="rounded-2xl border border-sky-500/15 bg-[#11110F] p-5 sm:p-6">
              <SectionTitle eyebrow="Base Sepolia · Seller workspace" title="Your Base auctions" href="/my-auctions" />
              {baseStatus === 'loading' ? (
                <div className="h-24 animate-pulse rounded-xl bg-white/[0.04]" />
              ) : baseAuctions.length > 0 ? (
                <div className="divide-y divide-white/[0.06]">
                  {baseAuctions.slice(0, 4).map((auction) => (
                    <Link key={auction.id} href={`/auctions/${auction.id}?network=base`} className="group flex items-center justify-between gap-3 py-3.5 first:pt-0 last:pb-0">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-[#F5F2E8] transition group-hover:text-sky-300">{auction.itemName}</p>
                        <p className="mt-1 text-[11px] text-[#77746B]">
                          Auction #{auction.id} · Starts at {auction.startingPrice} ETH
                        </p>
                      </div>
                      <StatusPill tone="blue">{auction.status}</StatusPill>
                    </Link>
                  ))}
                </div>
              ) : (
                <EmptyPanel title={isEvmConnected ? 'No Base listings yet' : 'EVM wallet not connected'} detail={isEvmConnected ? 'Your Base Sepolia listings will appear here after you create an auction.' : 'Connect an EVM wallet to view your Base Sepolia auctions.'} />
              )}
            </div>

            <div className="rounded-2xl border border-sky-500/15 bg-[#11110F] p-5 sm:p-6">
              <SectionTitle eyebrow="Base Sepolia · Bidder workspace" title="Your Base bids" href="/my-bids" />
              {baseStatus === 'loading' ? (
                <div className="h-24 animate-pulse rounded-xl bg-white/[0.04]" />
              ) : baseBids.length > 0 ? (
                <div className="divide-y divide-white/[0.06]">
                  {baseBids.slice(0, 4).map((bid) => (
                    <Link key={bid.auctionId} href={`/auctions/${bid.auctionId}?network=base`} className="group flex items-center justify-between gap-3 py-3.5 first:pt-0 last:pb-0">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-[#F5F2E8] transition group-hover:text-sky-300">{bid.itemName}</p>
                        <p className="mt-1 text-[11px] text-[#77746B]">Auction #{bid.auctionId} · Deposit {bid.deposit} ETH</p>
                      </div>
                      <StatusPill tone="blue">{bid.isWinner ? 'Won' : bid.auctionStatus}</StatusPill>
                    </Link>
                  ))}
                </div>
              ) : (
                <EmptyPanel title={isEvmConnected ? 'No Base bids yet' : 'EVM wallet not connected'} detail={isEvmConnected ? 'Your Base Sepolia commitments will appear here.' : 'Connect an EVM wallet to view your Base Sepolia bids.'} />
              )}
            </div>
          </section>
        )}

        {/* History Section: Merged On-Chain & Service Escrow Activity */}
        {(isLoading || visibleActivities.length > 0) && (
          <section className="mt-8 rounded-2xl border border-white/[0.08] bg-[#11110F] p-5 sm:p-6">
            <SectionTitle eyebrow="History" title="Recent activity" />
            {isLoading ? (
              <div className="h-16 animate-pulse rounded-xl bg-white/[0.04]" />
            ) : visibleActivities.length > 0 ? (
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
                {visibleActivities.slice(0, 9).map((activity) => (
                  <Link
                    key={activity.id}
                    href={activity.href}
                    className="flex min-w-0 items-center gap-3 rounded-xl border border-white/[0.05] px-3 py-3 transition hover:border-white/[0.12] hover:bg-white/[0.025]"
                  >
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/[0.04] text-[#A8A397]">
                      {activity.kind === 'service' ? (
                        activity.type === 'service_order_completed' ? (
                          <BadgeCheck size={16} className="text-emerald-400" />
                        ) : (
                          <Coins size={16} className="text-[#C9A45C]" />
                        )
                      ) : activity.type === 'auction_created' ? (
                        <Database size={15} />
                      ) : activity.type === 'refund_withdrawn' ? (
                        <ArrowDownLeft size={15} />
                      ) : (
                        <Gavel size={15} />
                      )}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5 truncate text-xs font-medium text-[#E8E4D9]">
                        <span className="truncate">{activity.type.replaceAll('_', ' ')}</span>
                        {activity.kind === 'service' && (
                          <span
                            className={`rounded px-1.5 py-0.2 text-[9px] font-semibold ${
                              activity.isOnChainConfirmed
                                ? 'bg-emerald-500/10 text-emerald-300'
                                : 'bg-amber-500/10 text-amber-300'
                            }`}
                          >
                            {activity.isOnChainConfirmed ? 'Escrow' : 'Unfunded'}
                          </span>
                        )}
                      </span>
                      <span className="mt-1 block truncate text-[10px] text-[#77746B]">
                        {activity.title} · {formatRelativeTime(activity.timestamp)}
                      </span>
                    </span>
                    <ArrowUpRight size={13} className="shrink-0 text-[#77746B]" />
                  </Link>
                ))}
              </div>
            ) : null}
          </section>
        )}

        {completedBids.length > 0 && (
          <section className="mt-5 flex flex-col gap-3 rounded-xl border border-emerald-400/10 bg-emerald-400/[0.025] px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between">
            <p className="flex items-center gap-2 text-xs text-[#A8A397]">
              <BadgeCheck size={15} className="text-emerald-300" />
              You have {completedBids.length} settled {completedBids.length === 1 ? 'bid' : 'bids'} on record on {activeMeta.label}.
            </p>
            <Link href="/my-bids" className="inline-flex items-center gap-1.5 text-xs font-medium text-[#E6CC91] hover:text-[#F5F2E8]">
              View bid history
              <ArrowRight size={13} />
            </Link>
          </section>
        )}
      </div>
    </main>
  );
}
