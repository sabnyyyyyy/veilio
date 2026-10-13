'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { useAccount, usePublicClient } from 'wagmi';
import WalletButton from '@/components/WalletButton';
import Countdown from '@/components/Countdown';
import { fetchUserAuctions, UserAuctionItem } from '@/lib/userAuctions';

type SolanaAuctionItem = {
  address: string;
  id: string;
  itemName: string;
  startingPrice: string;
  bidderCount: number;
  commitEndTime: number;
  revealEndTime: number;
  status: string;
};

type SolanaDashboardResponse = {
  auctions: SolanaAuctionItem[];
};

export default function MyAuctionsPage() {
  const { address, isConnected } = useAccount();
  const publicClient = usePublicClient();
  const [auctions, setAuctions] = useState<UserAuctionItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [solanaAuctions, setSolanaAuctions] = useState<SolanaAuctionItem[]>([]);
  const [solanaStatus, setSolanaStatus] = useState<'unlinked' | 'loading' | 'ready' | 'error'>('unlinked');

  useEffect(() => {
    let cancelled = false;

    async function loadAuctions() {
      if (!address || !publicClient) return;

      setIsLoading(true);
      setError(null);
      setSolanaStatus('loading');
      try {
        const data = await fetchUserAuctions(publicClient, address);
        if (!cancelled) setAuctions(data);
      } catch (err) {
        console.error('Failed to load user auctions:', err);
        if (!cancelled) {
          setAuctions([]);
          setError('Failed to load your BNB auctions from the blockchain.');
        }
      }

      try {
        const profileResponse = await fetch(
          `/api/identity/profile?wallet=${encodeURIComponent(address)}&chain=evm`,
          { cache: 'no-store' },
        );
        if (!profileResponse.ok) {
          if (!cancelled) {
            setSolanaAuctions([]);
            setSolanaStatus('unlinked');
          }
          return;
        }

        const profileBody = await profileResponse.json() as {
          profile?: {
            linkedWallets?: Array<{ address: string; chainFamily: string; networkId: string; status: string }>;
          };
        };
        const linkedWallet = profileBody.profile?.linkedWallets?.find((wallet) =>
          wallet.chainFamily === 'solana' && wallet.networkId === 'solana:devnet' && wallet.status === 'active',
        );
        if (!linkedWallet) {
          if (!cancelled) {
            setSolanaAuctions([]);
            setSolanaStatus('unlinked');
          }
          return;
        }

        const solanaResponse = await fetch(
          `/api/solana/dashboard?wallet=${encodeURIComponent(linkedWallet.address)}`,
          { cache: 'no-store' },
        );
        if (!solanaResponse.ok) throw new Error('Solana Devnet activity could not be loaded.');
        const solanaData = await solanaResponse.json() as SolanaDashboardResponse;
        if (!cancelled) {
          setSolanaAuctions(solanaData.auctions || []);
          setSolanaStatus('ready');
        }
      } catch (err) {
        console.error('Failed to load Solana auctions:', err);
        if (!cancelled) {
          setSolanaAuctions([]);
          setSolanaStatus('error');
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    if (isConnected && address) {
      loadAuctions();
    } else {
      setAuctions([]);
      setSolanaAuctions([]);
      setSolanaStatus('unlinked');
    }

    return () => { cancelled = true; };
  }, [address, isConnected, publicClient]);

  if (!isConnected || !address) {
    return (
      <div className="py-24 bg-[#0A0A09]">
        <div className="max-w-xl mx-auto px-6 text-center space-y-6">
          <h1 className="text-3xl font-extrabold text-[#F5F2E8]">Authentication Required</h1>
          <p className="text-sm text-[#A8A397]">Connect your wallet to manage your created auctions.</p>
          <WalletButton />
        </div>
      </div>
    );
  }

  return (
    <div className="py-12 bg-[#0A0A09]">
      <div className="max-w-7xl mx-auto px-6 space-y-8">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <h1 className="text-3xl font-extrabold text-[#F5F2E8] uppercase">MY AUCTIONS</h1>
            <p className="text-sm text-[#A8A397] mt-1">
              Auctions created by your BNB wallet and linked Solana Devnet wallet.
            </p>
          </div>

          <Link
            href="/create"
            className="px-6 py-3 text-xs font-semibold uppercase tracking-wider rounded-xl bg-[#C9A45C] text-[#0A0A09] hover:bg-[#E6CC91] transition-colors"
          >
            + Create auction
          </Link>
        </div>

        {error && (
          <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-500 text-sm">
            {error}
          </div>
        )}

        <section className="space-y-4">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-emerald-400" />
            <h2 className="text-sm font-bold uppercase tracking-wider text-[#F5F2E8]">BNB Chain Testnet</h2>
            <span className="text-xs text-[#77746B]">{auctions.length}</span>
          </div>
          {isLoading ? (
            <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-[#151512] p-8 text-sm text-[#A8A397]">
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-[#C9A45C]/20 border-t-[#C9A45C]" />
              Loading BNB auctions...
            </div>
          ) : auctions.length === 0 ? (
            <div className="rounded-2xl border border-white/10 bg-[#151512] p-8 text-center">
              <p className="text-sm text-[#A8A397]">You haven't listed any BNB auctions yet.</p>
              <Link href="/create" className="mt-4 inline-block rounded-lg bg-[#C9A45C] px-5 py-2.5 text-xs font-semibold uppercase tracking-wider text-[#0A0A09] transition-colors hover:bg-[#E6CC91]">
                Create BNB auction
              </Link>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
              {auctions.map((auc) => (
                <div key={auc.id} className="space-y-4 rounded-2xl border border-white/10 bg-[#151512] p-6">
                  <h3 className="text-lg font-bold text-[#F5F2E8]">{auc.itemName}</h3>
                  <div className="space-y-2 text-xs text-[#A8A397]">
                    <div className="flex justify-between"><span>Starting at</span><span className="font-semibold text-[#F5F2E8]">{auc.startingPrice} BNB</span></div>
                    <div className="flex justify-between"><span>Status</span><span className={`font-semibold ${auc.status === 'Bidding' ? 'text-[#C9A45C]' : auc.status === 'Revealing' ? 'text-blue-400' : 'text-gray-400'}`}>{auc.status}</span></div>
                    <div className="flex justify-between"><span>{auc.status === 'Bidding' ? 'Ends in' : 'Ended'}</span>{auc.status === 'Bidding' ? <Countdown endTime={auc.commitEndTime} /> : <span className="text-[#F5F2E8]">{new Date(auc.commitEndTime).toLocaleDateString()}</span>}</div>
                  </div>
                  <div className="border-t border-white/5 pt-3">
                    <Link href={`/auctions/${auc.id}`} className="inline-block w-full rounded-lg bg-[#C9A45C] py-2.5 text-center text-xs font-semibold uppercase tracking-wider text-[#0A0A09] transition-colors hover:bg-[#E6CC91]">Manage BNB auction &rarr;</Link>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="space-y-4">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-[#8B7BFF]" />
            <h2 className="text-sm font-bold uppercase tracking-wider text-[#F5F2E8]">Solana Devnet</h2>
            {solanaStatus === 'ready' && <span className="text-xs text-[#77746B]">{solanaAuctions.length}</span>}
          </div>
          {solanaStatus === 'loading' ? (
            <div className="flex items-center gap-3 rounded-2xl border border-[#8B7BFF]/15 bg-[#151512] p-8 text-sm text-[#B9B2D8]">
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-[#8B7BFF]/20 border-t-[#8B7BFF]" />
              Loading linked Solana auctions...
            </div>
          ) : solanaStatus === 'unlinked' ? (
            <div className="flex flex-col gap-4 rounded-2xl border border-[#8B7BFF]/15 bg-[#151512] p-6 sm:flex-row sm:items-center sm:justify-between">
              <div><p className="text-sm font-semibold text-[#F5F2E8]">No Solana wallet linked</p><p className="mt-1 text-xs text-[#A8A397]">Link your Solana Devnet wallet to see auctions created by it.</p></div>
              <Link href="/identity" className="shrink-0 rounded-lg border border-[#8B7BFF]/25 px-4 py-2.5 text-center text-xs font-semibold uppercase tracking-wider text-[#C5BCFF] transition hover:bg-[#8B7BFF]/[0.08]">Link Solana wallet</Link>
            </div>
          ) : solanaStatus === 'error' ? (
            <div role="status" className="rounded-2xl border border-[#8B7BFF]/15 bg-[#151512] p-6 text-sm text-[#B9B2D8]">Solana Devnet auctions could not be loaded. Refresh the page to try again.</div>
          ) : solanaAuctions.length === 0 ? (
            <div className="rounded-2xl border border-[#8B7BFF]/15 bg-[#151512] p-8 text-center">
              <p className="text-sm text-[#A8A397]">No auctions found for your linked Solana wallet.</p>
              <p className="mt-1 text-xs text-[#77746B]">Solana auctions are shown here as Devnet accounts; bidding and asset delivery are not available in the VEILIO interface yet.</p>
              <Link href="/create" className="mt-4 inline-block rounded-lg border border-[#8B7BFF]/25 px-5 py-2.5 text-xs font-semibold uppercase tracking-wider text-[#C5BCFF] transition hover:bg-[#8B7BFF]/[0.08]">Create Solana auction</Link>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
              {solanaAuctions.map((auction) => (
                <div key={auction.address} className="space-y-4 rounded-2xl border border-[#8B7BFF]/15 bg-[#151512] p-6">
                  <div className="flex items-start justify-between gap-3">
                    <h3 className="min-w-0 truncate text-lg font-bold text-[#F5F2E8]">{auction.itemName || `Auction #${auction.id}`}</h3>
                    <span className="shrink-0 rounded-full border border-[#8B7BFF]/20 bg-[#8B7BFF]/[0.06] px-2.5 py-1 text-[10px] font-medium text-[#C5BCFF]">{auction.status}</span>
                  </div>
                  <div className="space-y-2 text-xs text-[#A8A397]">
                    <div className="flex justify-between"><span>Starting at</span><span className="font-semibold text-[#F5F2E8]">{auction.startingPrice} SOL</span></div>
                    <div className="flex justify-between"><span>Bids</span><span className="text-[#F5F2E8]">{auction.bidderCount}</span></div>
                    <div className="flex justify-between"><span>Account</span><span className="font-mono text-[#C5BCFF]">{auction.address.slice(0, 6)}…{auction.address.slice(-5)}</span></div>
                  </div>
                  <div className="border-t border-white/5 pt-3">
                    <a href={`https://explorer.solana.com/address/${encodeURIComponent(auction.address)}?cluster=devnet`} target="_blank" rel="noreferrer" className="inline-block w-full rounded-lg border border-[#8B7BFF]/25 py-2.5 text-center text-xs font-semibold uppercase tracking-wider text-[#C5BCFF] transition hover:bg-[#8B7BFF]/[0.08]">View on Solana Explorer &rarr;</a>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
