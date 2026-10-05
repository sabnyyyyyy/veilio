'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { useAccount, usePublicClient } from 'wagmi';
import WalletButton from '@/components/WalletButton';
import Countdown from '@/components/Countdown';
import { fetchUserAuctions, UserAuctionItem } from '@/lib/userAuctions';

export default function MyAuctionsPage() {
  const { address, isConnected } = useAccount();
  const publicClient = usePublicClient();
  const [auctions, setAuctions] = useState<UserAuctionItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadAuctions() {
      if (!address || !publicClient) return;
      
      setIsLoading(true);
      setError(null);
      try {
        const data = await fetchUserAuctions(publicClient, address);
        setAuctions(data);
      } catch (err) {
        console.error('Failed to load user auctions:', err);
        setError('Failed to load your auctions from the blockchain.');
      } finally {
        setIsLoading(false);
      }
    }

    if (isConnected && address) {
      loadAuctions();
    } else {
      setAuctions([]);
    }
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
              Auctions listed by your wallet address on BNB Chain Testnet.
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

        {/* Loading State */}
        {isLoading ? (
          <div className="flex flex-col items-center justify-center p-12 space-y-4">
            <div className="w-8 h-8 border-4 border-[#C9A45C]/20 border-t-[#C9A45C] rounded-full animate-spin" />
            <p className="text-sm text-[#A8A397]">Loading your auctions from the blockchain...</p>
          </div>
        ) : !isLoading && auctions.length === 0 && !error ? (
          <div className="p-12 rounded-2xl bg-[#151512] border border-white/10 text-center space-y-4">
            <p className="text-sm text-[#A8A397]">You haven't listed any auctions yet.</p>
            <Link
              href="/create"
              className="inline-block px-6 py-2.5 text-xs font-semibold uppercase tracking-wider rounded-lg bg-[#C9A45C] text-[#0A0A09] hover:bg-[#E6CC91] transition-colors"
            >
              Create your first auction
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {auctions.map((auc) => (
              <div key={auc.id} className="p-6 rounded-2xl bg-[#151512] border border-white/10 space-y-4">
                <h3 className="font-bold text-[#F5F2E8] text-lg">{auc.itemName}</h3>
                <div className="text-xs space-y-2 text-[#A8A397]">
                  <div className="flex justify-between">
                    <span>Starting at</span>
                    <span className="font-semibold text-[#F5F2E8]">{auc.startingPrice} BNB</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Status</span>
                    <span className={`font-semibold ${auc.status === 'Bidding' ? 'text-[#C9A45C]' : auc.status === 'Revealing' ? 'text-blue-400' : 'text-gray-400'}`}>
                      {auc.status}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span>{auc.status === 'Bidding' ? 'Ends in' : 'Ended'}</span>
                    {auc.status === 'Bidding' ? (
                      <Countdown endTime={auc.commitEndTime} />
                    ) : (
                      <span className="text-[#F5F2E8]">
                        {new Date(auc.commitEndTime).toLocaleDateString()}
                      </span>
                    )}
                  </div>
                </div>

                <div className="pt-3 border-t border-white/5">
                  <Link
                    href={`/auctions/${auc.id}`}
                    className="inline-block w-full text-center py-2.5 text-xs font-semibold uppercase tracking-wider rounded-lg bg-[#C9A45C] text-[#0A0A09] hover:bg-[#E6CC91] transition-colors"
                  >
                    Manage auction &rarr;
                  </Link>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
