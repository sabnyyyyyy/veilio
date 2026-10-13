'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { formatEther } from 'viem';
import { useAccount, useChainId, usePublicClient, useSwitchChain } from 'wagmi';
import {
  Activity,
  ArrowUpRight,
  CircleAlert,
  Database,
  ExternalLink,
  Gavel,
  Globe,
  Layers,
  RefreshCw,
  Shield,
  ShieldCheck,
  Sparkles,
  Wallet,
} from 'lucide-react';
import WalletButton from '@/components/WalletButton';
import { fetchUserAuctions, UserAuctionItem } from '@/lib/userAuctions';
import { getAuctionContractConfig } from '@/lib/contract';
import { baseSepoliaChain, bnbChain } from '@/lib/chain';
import { contractReadErrorMessage } from '@/lib/contractReadError';
import { DEFAULT_SOLANA_AUCTION_PROGRAM_ID, getSolanaAuctionProgramId } from '@/lib/cross-chain/solanaAuction';

interface AnalyticsListing {
  id: string;
  itemName: string;
  startingPrice: string;
  bidderCount: number;
  commitEndTime: number;
  revealEndTime: number;
  status: string;
  views: number;
  dailyViews: Record<string, number>;
  reveals: number;
  winner: string;
  winningPrice: string;
  state: number;
  escrowStatus: string;
  address?: string; // On-chain address or PDA
}

interface SolanaDashboardPayload {
  network: string;
  programId?: string;
  wallet: string;
  auctions: Array<{
    address: string;
    id: string;
    itemName: string;
    startingPrice: string;
    bidderCount: number;
    commitEndTime: number;
    revealEndTime: number;
    state?: number;
    reveals?: number;
    winner?: string;
    winningPrice?: string;
    escrowStatus?: string;
    status: string;
  }>;
}

interface IdentityActivityItem {
  id: string;
  activityType: string;
  title: string;
  description: string;
  txHashOrSignature?: string;
  timestamp: number;
  status: string;
}

const stateNames = [
  'Created',
  'Bidding',
  'Revealing',
  'Inspection',
  'Refund requested',
  'Under review',
  'Completed',
  'Refunded',
  'Cancelled',
];

import {
  type NetworkKey,
  isValidSolanaAddress,
  formatShortAddress,
  getExplorerLink,
} from '@/lib/sellerAnalytics';

export { type NetworkKey, isValidSolanaAddress, formatShortAddress, getExplorerLink };

export default function SellerAnalyticsPage() {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const { switchChainAsync } = useSwitchChain();

  const [selectedNetwork, setSelectedNetwork] = useState<NetworkKey>(() => {
    return chainId === baseSepoliaChain.id ? 'base' : 'bnb';
  });

  // Track Solana wallet connections (both direct via window.solana and linked via Multichain ID)
  const [directSolanaWallet, setDirectSolanaWallet] = useState<string>('');
  const [linkedSolanaWallet, setLinkedSolanaWallet] = useState<string | null>(null);
  const [identityId, setIdentityId] = useState<string | null>(null);
  const [identityChecking, setIdentityChecking] = useState<boolean>(false);
  const [solanaConnecting, setSolanaConnecting] = useState<boolean>(false);

  // Solana identity activities
  const [solanaActivities, setSolanaActivities] = useState<IdentityActivityItem[]>([]);

  // EVM public client strictly for EVM chain IDs
  const evmChainId = selectedNetwork === 'base' ? baseSepoliaChain.id : bnbChain.id;
  const publicClient = usePublicClient({ chainId: evmChainId });

  const [rows, setRows] = useState<AnalyticsListing[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [solanaProgramId, setSolanaProgramId] = useState<string>(DEFAULT_SOLANA_AUCTION_PROGRAM_ID);
  const [refreshKey, setRefreshKey] = useState(0);

  // Automatically sync network if wallet connects on supported EVM chain and user hasn't explicitly selected Solana
  useEffect(() => {
    if (selectedNetwork !== 'solana') {
      if (chainId === baseSepoliaChain.id) setSelectedNetwork('base');
      else if (chainId === bnbChain.id) setSelectedNetwork('bnb');
    }
  }, [chainId, selectedNetwork]);

  // Check window.solana on mount
  useEffect(() => {
    if (typeof window !== 'undefined' && window.solana?.publicKey) {
      const pubkey = window.solana.publicKey.toString();
      if (isValidSolanaAddress(pubkey)) {
        setDirectSolanaWallet(pubkey);
      }
    }
  }, []);

  // Check linked Solana wallet from Multichain Identity when EVM wallet connects
  useEffect(() => {
    let alive = true;
    if (!address) {
      setLinkedSolanaWallet(null);
      setIdentityId(null);
      return;
    }

    setIdentityChecking(true);
    fetch(`/api/identity/profile?wallet=${encodeURIComponent(address)}&chain=evm`, { cache: 'no-store' })
      .then(async (res) => {
        if (!res.ok) return null;
        return (await res.json()) as {
          profile?: {
            id?: string;
            linkedWallets?: Array<{ address: string; chainFamily: string; networkId: string; status: string }>;
          };
        };
      })
      .then((data) => {
        if (!alive) return;
        setIdentityId(data?.profile?.id || null);
        const linked = data?.profile?.linkedWallets?.find(
          (item) => item.chainFamily === 'solana' && item.networkId === 'solana:devnet' && item.status === 'active'
        );
        if (linked && isValidSolanaAddress(linked.address)) {
          setLinkedSolanaWallet(linked.address);
        } else {
          setLinkedSolanaWallet(null);
        }
      })
      .catch(() => {
        if (alive) {
          setLinkedSolanaWallet(null);
          setIdentityId(null);
        }
      })
      .finally(() => {
        if (alive) setIdentityChecking(false);
      });

    return () => {
      alive = false;
    };
  }, [address]);

  // Active Solana address resolution: direct wallet > linked wallet
  const activeSolanaWallet = directSolanaWallet || linkedSolanaWallet || '';
  const isSolanaWalletConfigured = isValidSolanaAddress(activeSolanaWallet);

  // Contract config for EVM networks
  const contractConfig = useMemo(() => {
    try {
      return getAuctionContractConfig(evmChainId);
    } catch {
      return getAuctionContractConfig(bnbChain.id);
    }
  }, [evmChainId]);

  // Active network meta
  const networkName =
    selectedNetwork === 'solana'
      ? 'Solana Devnet'
      : selectedNetwork === 'base'
      ? 'Base Sepolia'
      : 'BNB Chain Testnet';

  const currencySymbol =
    selectedNetwork === 'solana' ? 'SOL' : selectedNetwork === 'base' ? 'ETH' : 'BNB';

  const explorerUrl =
    selectedNetwork === 'solana'
      ? 'https://explorer.solana.com/?cluster=devnet'
      : selectedNetwork === 'base'
      ? baseSepoliaChain.blockExplorers.default.url
      : bnbChain.blockExplorers.default.url;

  const activeWalletAddress = selectedNetwork === 'solana' ? activeSolanaWallet : address || '';

  // Direct Solana wallet connection handler
  const handleConnectSolanaWallet = useCallback(async () => {
    if (typeof window === 'undefined' || !window.solana) {
      setError('No Solana wallet detected. Please install Phantom or another Solana Web3 extension.');
      return;
    }
    setSolanaConnecting(true);
    setError('');
    try {
      const resp = await window.solana.connect();
      const pubkey = resp.publicKey.toString();
      if (isValidSolanaAddress(pubkey)) {
        setDirectSolanaWallet(pubkey);
      } else {
        throw new Error('Connected Solana wallet address failed Base58 validation.');
      }
    } catch (err: any) {
      console.error('Failed to connect Solana wallet:', err);
      setError(err?.message || 'Failed to connect Solana wallet.');
    } finally {
      setSolanaConnecting(false);
    }
  }, []);

  // Main data loader strictly separated by network
  useEffect(() => {
    let cancelled = false;

    async function loadData() {
      setLoading(true);
      setError('');
      setRows([]);
      setSolanaActivities([]);

      // ─── 1. SOLANA DEVNET READ PIPELINE ───────────────────────────────────────
      if (selectedNetwork === 'solana') {
        if (!activeSolanaWallet) {
          setLoading(false);
          return;
        }

        if (!isValidSolanaAddress(activeSolanaWallet)) {
          setError('Solana wallet address is not a valid 32-byte Base58 public key.');
          setLoading(false);
          return;
        }

        try {
          // Query Solana auction data through dedicated Solana RPC endpoint
          // Note: EVM client is never invoked with Solana address
          const solanaRes = await fetch(
            `/api/solana/dashboard?wallet=${encodeURIComponent(activeSolanaWallet)}`,
            { cache: 'no-store' }
          );

          if (!solanaRes.ok) {
            const body = await solanaRes.json().catch(() => ({}));
            throw new Error(
              body.error || `Solana Devnet RPC returned status ${solanaRes.status}`
            );
          }

          const solanaData = (await solanaRes.json()) as SolanaDashboardPayload;
          if (solanaData.programId) {
            setSolanaProgramId(solanaData.programId);
          }

          const enrichedSolanaAuctions: AnalyticsListing[] = await Promise.all(
            (solanaData.auctions || []).map(async (auction) => {
              const viewRes = await fetch(
                `/api/analytics/views?auctionId=${encodeURIComponent(auction.id)}`
              )
                .then((r) => r.json())
                .catch(() => null);

              const stateNum = auction.state ?? 0;
              return {
                id: auction.id,
                itemName: auction.itemName,
                startingPrice: auction.startingPrice,
                bidderCount: auction.bidderCount,
                commitEndTime: auction.commitEndTime,
                revealEndTime: auction.revealEndTime,
                status: auction.status,
                views: Number(viewRes?.stats?.totalViews || 0),
                dailyViews: viewRes?.stats?.daily || {},
                reveals: auction.reveals ?? 0,
                winner: auction.winner || '',
                winningPrice: auction.winningPrice || '0',
                state: stateNum,
                escrowStatus: auction.escrowStatus || stateNames[stateNum] || 'Unknown',
                address: auction.address,
              };
            })
          );

          if (!cancelled) {
            setRows(enrichedSolanaAuctions);
          }

          // Fetch verified multichain identity activity if identityId exists
          if (identityId) {
            try {
              const actRes = await fetch(
                `/api/identity/activity?identityId=${encodeURIComponent(identityId)}&chainFamily=solana&networkId=solana:devnet&limit=20`,
                { cache: 'no-store' }
              );
              if (actRes.ok) {
                const actData = (await actRes.json()) as { items?: IdentityActivityItem[] };
                if (!cancelled) {
                  setSolanaActivities(actData.items || []);
                }
              }
            } catch {
              // Activity history is supplementary; do not fail whole view
            }
          }
        } catch (err: any) {
          if (!cancelled) {
            console.error('Failed to load Solana seller analytics:', err);
            setError(
              err?.message ||
                'Solana Devnet could not be reached via dedicated RPC. Verify cluster connectivity or refresh to retry.'
            );
          }
        } finally {
          if (!cancelled) setLoading(false);
        }
        return;
      }

      // ─── 2. EVM (BNB / BASE) READ PIPELINE ─────────────────────────────────────
      if (!address || !publicClient) {
        setLoading(false);
        return;
      }

      try {
        const auctions = await fetchUserAuctions(publicClient, address, {
          chainId: evmChainId,
        });

        const enriched = await Promise.all(
          auctions.map(async (auction) => {
            const [raw, viewRes] = await Promise.all([
              publicClient.readContract({
                address: contractConfig.address,
                abi: contractConfig.abi,
                functionName: 'auctions',
                args: [BigInt(auction.id)],
              }) as Promise<readonly unknown[]>,
              fetch(`/api/analytics/views?auctionId=${encodeURIComponent(auction.id)}`)
                .then((r) => r.json())
                .catch(() => null),
            ]);

            const state = Number(raw[10] || 0);
            return {
              ...auction,
              views: Number(viewRes?.stats?.totalViews || 0),
              dailyViews: viewRes?.stats?.daily || {},
              reveals: Number(raw[14] || 0),
              winner: String(raw[11] || ''),
              winningPrice: formatEther((raw[12] as bigint) || BigInt(0)),
              state,
              escrowStatus: stateNames[state] || 'Unknown',
              address: contractConfig.address,
            };
          })
        );

        if (!cancelled) setRows(enriched);
      } catch (e) {
        if (!cancelled) {
          setError(
            contractReadErrorMessage(e, contractConfig.address, {
              expectedChainId: evmChainId,
              chainId,
              networkName,
            })
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void loadData();
    return () => {
      cancelled = true;
    };
  }, [
    selectedNetwork,
    activeSolanaWallet,
    identityId,
    address,
    publicClient,
    evmChainId,
    contractConfig,
    chainId,
    networkName,
    refreshKey,
  ]);

  // Aggregate KPI totals
  const totals = useMemo(
    () => ({
      views: rows.reduce((sum, row) => sum + row.views, 0),
      bidders: rows.reduce((sum, row) => sum + row.bidderCount, 0),
      reveals: rows.reduce((sum, row) => sum + row.reveals, 0),
      active: rows.filter((row) => row.state === 0 || row.state === 1 || row.state === 2).length,
      completed: rows.filter((row) => row.state === 6).length,
      earned: rows
        .filter((row) => row.state === 6)
        .reduce((sum, row) => sum + Number(row.winningPrice) * 0.9, 0),
    }),
    [rows]
  );

  // 7-day view trend calculation
  const dailyTrend = useMemo(
    () =>
      Array.from({ length: 7 }, (_, offset) => {
        const date = new Date();
        date.setUTCDate(date.getUTCDate() - (6 - offset));
        const key = date.toISOString().slice(0, 10);
        return {
          key,
          label: key.slice(5),
          count: rows.reduce((sum, row) => sum + (row.dailyViews[key] || 0), 0),
        };
      }),
    [rows]
  );

  // Unconnected state if EVM is selected and EVM wallet is disconnected
  if (selectedNetwork !== 'solana' && (!isConnected || !address)) {
    return (
      <div className="min-h-screen bg-[#0A0A09] flex flex-col items-center justify-center gap-6 px-6 text-[#F5F2E8]">
        <div className="mx-auto max-w-md w-full rounded-2xl border border-white/10 bg-[#151512] p-8 text-center shadow-2xl">
          <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border border-[#C9A45C]/20 bg-[#C9A45C]/[0.08] text-[#C9A45C]">
            <Wallet size={24} />
          </span>
          <p className="mt-6 text-[10px] font-semibold uppercase tracking-[0.2em] text-[#C9A45C]">
            VEILIO Seller Workspace
          </p>
          <h1 className="mt-2 text-2xl font-bold">Connect seller wallet</h1>
          <p className="mt-2 text-xs leading-5 text-[#A8A397]">
            Connect your wallet to inspect auction analytics, listing performance, and settlement on {networkName}.
          </p>
          <div className="mt-6 flex justify-center">
            <WalletButton />
          </div>
          <div className="mt-6 pt-5 border-t border-white/[0.08] flex items-center justify-center gap-2">
            <span className="text-xs text-[#77746B]">Or switch network:</span>
            <button
              type="button"
              onClick={() => setSelectedNetwork('solana')}
              className="text-xs font-semibold text-[#8B7BFF] hover:underline"
            >
              Solana Devnet →
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0A0A09] pt-28 pb-20 px-6 text-[#F5F2E8]">
      <div className="max-w-7xl mx-auto space-y-8">
        {/* Header & Network Selector */}
        <div className="flex flex-wrap justify-between items-end gap-4 border-b border-white/[0.08] pb-6">
          <div>
            <div className="flex items-center gap-2 text-xs uppercase tracking-widest text-[#C9A45C]">
              <Layers size={13} /> Seller Workspace · Analytics
            </div>
            <h1 className="text-3xl sm:text-4xl font-bold mt-2 tracking-tight">
              Seller Analytics<span className="text-[#C9A45C]">.</span>
            </h1>
            <p className="text-sm text-[#A8A397] mt-2">
              Listing views, participant activity, and auction settlement outcomes across supported chains.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {/* 3-Network Selector */}
            <div
              role="tablist"
              aria-label="Select blockchain network"
              className="inline-flex rounded-xl border border-white/10 bg-[#151512] p-1 text-xs shadow-inner"
            >
              <button
                type="button"
                role="tab"
                aria-selected={selectedNetwork === 'bnb'}
                onClick={() => setSelectedNetwork('bnb')}
                className={`rounded-lg px-3 py-1.5 font-semibold transition ${
                  selectedNetwork === 'bnb'
                    ? 'bg-[#C9A45C] text-[#0A0A09] shadow-sm'
                    : 'text-[#A8A397] hover:text-white'
                }`}
              >
                BNB Chain Testnet
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={selectedNetwork === 'base'}
                onClick={() => setSelectedNetwork('base')}
                className={`rounded-lg px-3 py-1.5 font-semibold transition ${
                  selectedNetwork === 'base'
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'text-[#A8A397] hover:text-white'
                }`}
              >
                Base Sepolia
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={selectedNetwork === 'solana'}
                onClick={() => setSelectedNetwork('solana')}
                className={`rounded-lg px-3 py-1.5 font-semibold transition flex items-center gap-1.5 ${
                  selectedNetwork === 'solana'
                    ? 'bg-[#8B7BFF] text-[#0A0A09] font-bold shadow-sm'
                    : 'text-[#A8A397] hover:text-white'
                }`}
              >
                <span
                  className={`h-1.5 w-1.5 rounded-full ${
                    selectedNetwork === 'solana' ? 'bg-[#0A0A09]' : 'bg-[#8B7BFF]'
                  }`}
                />
                Solana Devnet
              </button>
            </div>

            <button
              type="button"
              onClick={() => setRefreshKey((k) => k + 1)}
              disabled={loading}
              aria-label="Refresh analytics"
              title="Refresh analytics data"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-[#151512] text-[#A8A397] transition hover:border-white/20 hover:text-white disabled:opacity-40"
            >
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            </button>

            <Link
              href="/my-auctions"
              className="px-4 py-2 border border-white/10 rounded-lg text-xs font-semibold uppercase tracking-wider text-[#F5F2E8] hover:border-[#C9A45C]/50 hover:text-[#E6CC91] transition"
            >
              Manage auctions
            </Link>
          </div>
        </div>

        {/* Selected Network & Wallet Info Strip */}
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/[0.08] bg-[#11110F] px-4 py-3 text-xs">
          <div className="flex flex-wrap items-center gap-3">
            <span className="flex items-center gap-2 text-[#A8A397]">
              Active Network: <strong className="text-white">{networkName}</strong>
            </span>
            <span className="text-white/20">|</span>
            <span className="flex items-center gap-2">
              <span className="text-[#A8A397]">Seller Wallet:</span>
              {activeWalletAddress ? (
                <a
                  href={getExplorerLink(selectedNetwork, 'address', activeWalletAddress)}
                  target="_blank"
                  rel="noreferrer"
                  title={activeWalletAddress}
                  className="inline-flex items-center gap-1 font-mono font-medium text-[#E6CC91] hover:underline"
                >
                  {formatShortAddress(activeWalletAddress)}
                  <ExternalLink size={11} />
                </a>
              ) : (
                <span className="font-mono text-amber-300">Disconnected</span>
              )}
            </span>
            {selectedNetwork === 'solana' && isSolanaWalletConfigured && (
              <span className="inline-flex items-center gap-1 rounded-full border border-[#8B7BFF]/30 bg-[#8B7BFF]/10 px-2 py-0.5 text-[10px] text-[#C5BCFF]">
                {directSolanaWallet ? 'Direct Phantom/Solana' : 'Linked via Multichain ID'}
              </span>
            )}
          </div>

          <div className="flex items-center gap-3">
            {selectedNetwork === 'solana' ? (
              <a
                href={`https://explorer.solana.com/address/${solanaProgramId}?cluster=devnet`}
                target="_blank"
                rel="noreferrer"
                className="text-[#8B7BFF] hover:underline flex items-center gap-1 text-[11px]"
              >
                Inspect Program ({formatShortAddress(solanaProgramId)}) ↗
              </a>
            ) : (
              <a
                href={`${explorerUrl}/address/${contractConfig.address}`}
                target="_blank"
                rel="noreferrer"
                className="text-[#E6CC91] hover:underline flex items-center gap-1 text-[11px]"
              >
                Inspect Contract ({formatShortAddress(contractConfig.address)}) ↗
              </a>
            )}
          </div>
        </div>

        {/* EVM Chain Mismatch Notice */}
        {selectedNetwork !== 'solana' && isConnected && chainId !== evmChainId && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-500/30 bg-amber-500/[0.06] px-4 py-3 text-xs text-amber-200">
            <span>
              Connected wallet is on Chain {chainId}. Reading auctions from <strong className="text-white">{networkName}</strong> via dedicated RPC.
            </span>
            {switchChainAsync && (
              <button
                type="button"
                onClick={() => switchChainAsync({ chainId: evmChainId })}
                className="font-semibold text-[#E6CC91] hover:underline"
              >
                Switch wallet to {networkName} →
              </button>
            )}
          </div>
        )}

        {/* Solana Architecture & Capability Notice (Honest Solana handling per sol-5) */}
        {selectedNetwork === 'solana' && (
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 rounded-xl border border-[#8B7BFF]/25 bg-[#8B7BFF]/[0.05] p-4 text-xs text-[#C5BCFF]">
            <div className="flex items-start gap-2.5">
              <ShieldCheck size={16} className="mt-0.5 shrink-0 text-[#8B7BFF]" />
              <div>
                <p className="font-semibold text-white">
                  Solana Devnet Architecture · Anchor Auction Program ({formatShortAddress(solanaProgramId)})
                </p>
                <p className="mt-0.5 text-[#A8A397] leading-relaxed">
                  Real-time seller auction PDA accounts and multichain activity are read directly from Solana Devnet RPC using Anchor schema decoders.
                </p>
              </div>
            </div>
            <a
              href={`https://explorer.solana.com/address/${solanaProgramId}?cluster=devnet`}
              target="_blank"
              rel="noreferrer"
              className="shrink-0 text-xs font-semibold text-[#8B7BFF] hover:underline"
            >
              Solana Explorer ↗
            </a>
          </div>
        )}

        {/* Solana Disconnected / Unlinked State */}
        {selectedNetwork === 'solana' && !isSolanaWalletConfigured && (
          <div className="rounded-2xl border border-dashed border-white/15 bg-[#151512] p-8 text-center space-y-4">
            <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl border border-[#8B7BFF]/30 bg-[#8B7BFF]/10 text-[#8B7BFF]">
              <Wallet size={22} />
            </span>
            <div>
              <h3 className="text-lg font-bold text-white">No Solana Devnet wallet connected or linked</h3>
              <p className="mt-1 max-w-lg mx-auto text-xs leading-5 text-[#A8A397]">
                Connect a Solana wallet (such as Phantom) or link your Solana Devnet public key in VEILIO Multichain Identity to inspect your Solana seller performance.
              </p>
            </div>
            <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
              <button
                type="button"
                onClick={handleConnectSolanaWallet}
                disabled={solanaConnecting}
                className="inline-flex items-center gap-2 rounded-lg bg-[#8B7BFF] px-4 py-2 text-xs font-bold text-[#0A0A09] transition hover:bg-[#A397FF] disabled:opacity-50"
              >
                <Wallet size={14} />
                {solanaConnecting ? 'Connecting…' : 'Connect Phantom / Solana Wallet'}
              </button>
              <Link
                href="/identity"
                className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 px-4 py-2 text-xs font-semibold text-[#E6CC91] transition hover:border-[#C9A45C]/40 hover:bg-[#C9A45C]/[0.06]"
              >
                Link in Multichain Identity <ArrowUpRight size={14} />
              </Link>
            </div>
          </div>
        )}

        {/* Loading State */}
        {loading ? (
          <div className="p-10 text-center rounded-xl border border-white/10 bg-[#151512]">
            <RefreshCw size={24} className="animate-spin mx-auto text-[#C9A45C] mb-3" />
            <p className="text-sm text-[#A8A397]">Loading blockchain and view analytics for {networkName}…</p>
          </div>
        ) : error ? (
          /* Error State */
          <div role="alert" className="p-5 border border-rose-500/30 bg-rose-950/20 text-rose-200 space-y-3 rounded-xl">
            <div className="flex items-start gap-3">
              <CircleAlert size={18} className="text-rose-400 mt-0.5 shrink-0" />
              <div>
                <p className="font-semibold">Unable to load {networkName} data</p>
                <p className="mt-1 text-xs text-rose-300/90 leading-5">{error}</p>
              </div>
            </div>
            <div className="flex flex-wrap gap-4 pt-2">
              <button
                type="button"
                onClick={() => setRefreshKey((k) => k + 1)}
                className="text-xs font-bold text-white underline underline-offset-4 hover:text-[#E6CC91]"
              >
                Try refreshing ↺
              </button>
              {selectedNetwork === 'solana' ? (
                <a
                  className="text-xs uppercase tracking-wider text-[#8B7BFF] underline underline-offset-4"
                  href={`https://explorer.solana.com/address/${solanaProgramId}?cluster=devnet`}
                  target="_blank"
                  rel="noreferrer"
                >
                  Inspect configured program on Solana Explorer ↗
                </a>
              ) : (
                <a
                  className="text-xs uppercase tracking-wider text-[#E6CC91] underline underline-offset-4"
                  href={`${explorerUrl}/address/${contractConfig.address}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  Inspect configured contract on {networkName} ↗
                </a>
              )}
            </div>
          </div>
        ) : isSolanaWalletConfigured || selectedNetwork !== 'solana' ? (
          /* Ready Analytics Content */
          <>
            {/* KPI Cards */}
            <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
              {[
                ['Unique listing viewers', totals.views],
                ['Auction participants', totals.bidders],
                ['Revealed bids', totals.reveals],
                ['Active auctions', totals.active],
                ['Completed sales', totals.completed],
                ['Seller proceeds*', `${totals.earned.toFixed(4)} ${currencySymbol}`],
              ].map(([label, value]) => (
                <div key={String(label)} className="p-5 bg-[#151512] border border-white/10 rounded-xl">
                  <div className="text-[10px] uppercase tracking-wider text-[#A8A397]">{label}</div>
                  <div className="text-xl font-bold mt-2 text-[#E6CC91]">{value}</div>
                </div>
              ))}
            </div>

            {/* 7-Day Trend Chart */}
            <div className="p-6 bg-[#151512] border border-white/10 rounded-xl">
              <h2 className="text-xs uppercase tracking-widest text-[#A8A397] mb-5">
                New unique viewers · last 7 days ({networkName})
              </h2>
              <div className="grid grid-cols-7 gap-3 items-end h-28">
                {dailyTrend.map((day) => (
                  <div key={day.key} className="h-full flex flex-col justify-end items-center gap-2">
                    <div className="text-[10px] text-[#E6CC91]">{day.count || ''}</div>
                    <div
                      className="w-full max-w-12 bg-[#C9A45C]/80 rounded-t transition-all duration-300"
                      style={{
                        height: `${Math.max(
                          day.count ? 12 : 2,
                          (day.count / Math.max(...dailyTrend.map((d) => d.count), 1)) * 70
                        )}%`,
                      }}
                    />
                    <div className="text-[10px] text-[#A8A397]">{day.label}</div>
                  </div>
                ))}
              </div>
            </div>

            <p className="text-[11px] text-[#A8A397]">
              *Estimated at 90% of completed winning prices on {networkName}. Pending withdrawals, disputes, and non-reveal penalties are calculated per protocol rules.
            </p>

            {/* Empty Listings State */}
            {rows.length === 0 ? (
              <div className="p-10 bg-[#151512] border border-white/10 text-center rounded-xl space-y-3">
                <Sparkles size={20} className="mx-auto text-[#C9A45C]" />
                <p className="text-sm font-semibold text-white">
                  No auctions created by this wallet on {networkName} yet.
                </p>
                <p className="text-xs text-[#A8A397] max-w-md mx-auto">
                  {selectedNetwork === 'solana'
                    ? 'When you initialize a sealed-bid auction using the Veilio Solana auction program, listing metrics will display here.'
                    : 'List an encrypted dataset or intellectual asset to start tracking bidder attention and settlement.'}
                </p>
                <div className="pt-2">
                  <Link
                    href="/create"
                    className="inline-flex items-center gap-1.5 rounded-lg bg-[#C9A45C] px-3.5 py-2 text-xs font-bold text-[#0A0A09] hover:bg-[#E6CC91] transition"
                  >
                    Create auction <ArrowUpRight size={14} />
                  </Link>
                </div>
              </div>
            ) : (
              /* Listings Table */
              <div className="overflow-x-auto border border-white/10 rounded-xl">
                <table className="w-full text-sm">
                  <thead className="bg-[#151512] text-left text-[10px] uppercase tracking-wider text-[#A8A397]">
                    <tr>
                      {['Listing', 'Views', 'Participants', 'Reveals', 'Winning price', 'Escrow / settlement', 'Action'].map(
                        (x) => (
                          <th key={x} className="px-4 py-4">
                            {x}
                          </th>
                        )
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr key={row.id} className="border-t border-white/10 hover:bg-white/[0.02] transition">
                        <td className="px-4 py-4">
                          <div className="font-semibold text-white">{row.itemName}</div>
                          <div className="text-xs text-[#A8A397]">
                            Auction #{row.id} · {networkName}
                          </div>
                        </td>
                        <td className="px-4 py-4 font-mono">{row.views}</td>
                        <td className="px-4 py-4 font-mono">{row.bidderCount}</td>
                        <td className="px-4 py-4 font-mono">{row.reveals}</td>
                        <td className="px-4 py-4 font-mono">
                          {row.state === 6 ? `${row.winningPrice} ${currencySymbol}` : '—'}
                        </td>
                        <td className="px-4 py-4">
                          <span
                            className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[10px] font-medium border ${
                              row.state === 6
                                ? 'border-emerald-400/20 bg-emerald-400/10 text-emerald-300'
                                : row.state === 1 || row.state === 2
                                ? 'border-[#C9A45C]/20 bg-[#C9A45C]/10 text-[#E6CC91]'
                                : 'border-white/10 bg-white/[0.04] text-[#A8A397]'
                            }`}
                          >
                            <span className="h-1.5 w-1.5 rounded-full bg-current" />
                            {row.escrowStatus}
                          </span>
                        </td>
                        <td className="px-4 py-4">
                          {selectedNetwork === 'solana' ? (
                            <a
                              className="text-[#8B7BFF] hover:underline flex items-center gap-1 text-xs"
                              href={`https://explorer.solana.com/address/${row.address || activeSolanaWallet}?cluster=devnet`}
                              target="_blank"
                              rel="noreferrer"
                            >
                              Explorer ↗
                            </a>
                          ) : (
                            <Link
                              className="text-[#E6CC91] hover:underline flex items-center gap-1 text-xs"
                              href={`/auctions/${row.id}${selectedNetwork === 'base' ? '?network=base' : ''}`}
                            >
                              Open →
                            </Link>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Separated Verified Multichain Identity Activity Section (Solana Devnet only) */}
            {selectedNetwork === 'solana' && solanaActivities.length > 0 && (
              <div className="mt-8 space-y-4 rounded-xl border border-white/10 bg-[#151512] p-5 sm:p-6">
                <div>
                  <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-[#8B7BFF]">
                    <Shield size={12} /> Multichain Identity Ledger
                  </div>
                  <h3 className="mt-1 text-base font-semibold text-white">
                    Verified Activity on Solana Devnet
                  </h3>
                  <p className="mt-0.5 text-xs text-[#A8A397]">
                    Cryptographic identity and service events registered for this linked wallet. These are verified activity events, kept strictly distinct from native auction listings.
                  </p>
                </div>

                <div className="overflow-x-auto border border-white/[0.08] rounded-lg">
                  <table className="w-full text-xs">
                    <thead className="bg-[#11110F] text-left text-[10px] uppercase tracking-wider text-[#A8A397]">
                      <tr>
                        <th className="px-3 py-3">Event</th>
                        <th className="px-3 py-3">Details</th>
                        <th className="px-3 py-3">Status</th>
                        <th className="px-3 py-3">Date</th>
                        <th className="px-3 py-3">Proof</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/[0.06]">
                      {solanaActivities.map((act) => (
                        <tr key={act.id} className="hover:bg-white/[0.015]">
                          <td className="px-3 py-3 font-semibold text-white">{act.title}</td>
                          <td className="px-3 py-3 text-[#A8A397]">{act.description}</td>
                          <td className="px-3 py-3">
                            <span className="inline-flex rounded bg-[#8B7BFF]/10 px-2 py-0.5 font-mono text-[10px] text-[#C5BCFF]">
                              {act.status}
                            </span>
                          </td>
                          <td className="px-3 py-3 text-[#77746B]">
                            {new Date(act.timestamp).toLocaleDateString()}
                          </td>
                          <td className="px-3 py-3">
                            {act.txHashOrSignature ? (
                              <a
                                href={`https://explorer.solana.com/tx/${encodeURIComponent(act.txHashOrSignature)}?cluster=devnet`}
                                target="_blank"
                                rel="noreferrer"
                                className="text-[#8B7BFF] hover:underline"
                              >
                                View ↗
                              </a>
                            ) : (
                              <span className="text-[#555]">—</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </>
        ) : null}
      </div>
    </div>
  );
}

