'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { useAccount, usePublicClient } from 'wagmi';
import WalletButton from '@/components/WalletButton';
import Countdown from '@/components/Countdown';
import { fetchUserBids, fetchUserRefund, UserBidItem } from '@/lib/userBids';

export default function MyBidsPage() {
  const { address, isConnected } = useAccount();
  const publicClient = usePublicClient();
  const [bids, setBids] = useState<UserBidItem[]>([]);
  const [refund, setRefund] = useState('0');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<'All' | 'Active' | 'Needs Reveal' | 'Completed'>('All');

  useEffect(() => {
    async function loadBids() {
      if (!address || !publicClient) return;
      
      setIsLoading(true);
      setError(null);
      try {
        const [fetchedBids, fetchedRefund] = await Promise.all([
          fetchUserBids(publicClient, address),
          fetchUserRefund(publicClient, address)
        ]);
        setBids(fetchedBids);
        setRefund(fetchedRefund);
      } catch (err) {
        console.error('Failed to load user bids:', err);
        setError('Failed to load your bids from the blockchain.');
      } finally {
        setIsLoading(false);
      }
    }

    if (isConnected && address) {
      loadBids();
    } else {
      setBids([]);
      setRefund('0');
    }
  }, [address, isConnected, publicClient]);

  if (!isConnected || !address) {
    return (
      <div className="py-24 bg-[#0A0A09]">
        <div className="max-w-xl mx-auto px-6 text-center space-y-6">
          <h1 className="text-3xl font-extrabold text-[#F5F2E8]">Authentication Required</h1>
          <p className="text-sm text-[#A8A397]">Connect your wallet to view your bid commitments.</p>
          <WalletButton />
        </div>
      </div>
    );
  }

  const filteredBids = bids.filter((b) => {
    if (filter === 'Active') return b.auctionStatus === 'Bidding';
    if (filter === 'Needs Reveal') return b.auctionStatus === 'Revealing' && !b.revealed;
    if (filter === 'Completed') return b.auctionStatus === 'Settled';
    return true;
  });

  return (
    <div className="py-12 bg-[#0A0A09]">
      <div className="max-w-7xl mx-auto px-6 space-y-8">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <h1 className="text-3xl font-extrabold text-[#F5F2E8] uppercase">MY BIDS</h1>
            <p className="text-sm text-[#A8A397] mt-1">
              Track your on-chain commitments, public deposits, and reveal deadlines.
            </p>
          </div>
          {Number(refund) > 0 && (
            <div className="px-4 py-2 bg-[#C9A45C]/10 border border-[#C9A45C]/20 rounded-xl flex items-center gap-3">
              <span className="text-sm text-[#A8A397]">Claimable Refund:</span>
              <span className="font-bold text-[#C9A45C]">{refund} BNB</span>
              {/* Note: Withdraw button could be added here, but out of scope for pure audit/read replacement */}
            </div>
          )}
        </div>

        {/* Filter Tabs */}
        <div className="flex gap-3 border-b border-white/10 pb-4 overflow-x-auto">
          {(['All', 'Active', 'Needs Reveal', 'Completed'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setFilter(tab)}
              className={`px-4 py-2 whitespace-nowrap text-xs font-semibold uppercase tracking-wider rounded-lg transition-colors ${
                filter === tab
                  ? 'bg-[#C9A45C] text-[#0A0A09]'
                  : 'bg-white/[0.04] text-[#A8A397] hover:text-[#F5F2E8]'
              }`}
            >
              {tab}
            </button>
          ))}
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
            <p className="text-sm text-[#A8A397]">Loading your bids from the blockchain...</p>
          </div>
        ) : !isLoading && filteredBids.length === 0 && !error ? (
          <div className="p-12 rounded-2xl bg-[#151512] border border-white/10 text-center space-y-4">
            <p className="text-sm text-[#A8A397]">No bids found for this category.</p>
            <Link
              href="/auctions"
              className="inline-block px-6 py-2.5 text-xs font-semibold uppercase tracking-wider rounded-lg bg-[#C9A45C] text-[#0A0A09] hover:bg-[#E6CC91] transition-colors"
            >
              Explore auctions
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {filteredBids.map((bid) => {
              return (
                <div key={bid.auctionId} className="p-6 rounded-2xl bg-[#151512] border border-white/10 space-y-4 flex flex-col">
                  <div className="flex justify-between items-start">
                    <h3 className="font-bold text-[#F5F2E8] text-lg truncate pr-2">{bid.itemName || `Auction #${bid.auctionId}`}</h3>
                    <span className={`px-2.5 py-1 text-[10px] uppercase font-bold tracking-wider rounded border ${
                      bid.revealed 
                        ? 'bg-blue-500/10 border-blue-500/20 text-blue-400' 
                        : 'bg-white/[0.04] border-white/10 text-[#C9A45C]'
                    }`}>
                      {bid.revealed ? 'Revealed' : 'Sealed'}
                    </span>
                  </div>

                  <div className="pt-2 border-t border-white/5 space-y-2 text-xs flex-grow">
                    <div className="flex justify-between">
                      <span className="text-[#A8A397]">Deposit</span>
                      <span className="font-semibold text-[#F5F2E8]">{bid.deposit} BNB</span>
                    </div>
                    {bid.revealed && (
                      <div className="flex justify-between">
                        <span className="text-[#A8A397]">Max Bid</span>
                        <span className="font-semibold text-[#F5F2E8]">{bid.onchainMaxBid} BNB</span>
                      </div>
                    )}
                    <div className="flex justify-between">
                      <span className="text-[#A8A397]">Auction Status</span>
                      <span className={`font-semibold ${
                        bid.auctionStatus === 'Bidding' ? 'text-[#C9A45C]' : 
                        bid.auctionStatus === 'Revealing' ? 'text-blue-400' : 'text-gray-400'
                      }`}>
                        {bid.auctionStatus}
                      </span>
                    </div>
                    
                    {bid.auctionStatus === 'Settled' && (
                      <div className="flex justify-between">
                        <span className="text-[#A8A397]">Result</span>
                        <span className={`font-bold ${bid.isWinner ? 'text-[#C9A45C]' : 'text-red-400'}`}>
                          {bid.isWinner ? `Won for ${bid.winningPrice} BNB` : 'Outbid'}
                        </span>
                      </div>
                    )}

                    {bid.auctionStatus === 'Bidding' && (
                      <div className="flex justify-between">
                        <span className="text-[#A8A397]">Bidding ends in</span>
                        <Countdown endTime={bid.commitEndTime} />
                      </div>
                    )}
                    
                    {bid.auctionStatus === 'Revealing' && (
                      <div className="flex justify-between">
                        <span className="text-[#A8A397]">Reveal ends in</span>
                        <Countdown endTime={bid.revealEndTime} />
                      </div>
                    )}
                  </div>

                  <div className="pt-3 border-t border-white/5 mt-auto">
                    <Link
                      href={`/auctions/${bid.auctionId}`}
                      className={`inline-block w-full text-center py-2.5 text-xs font-semibold uppercase tracking-wider rounded-lg transition-colors ${
                        !bid.revealed && bid.auctionStatus === 'Revealing'
                          ? 'bg-[#C9A45C] text-[#0A0A09] hover:bg-[#E6CC91]'
                          : 'bg-white/5 text-[#F5F2E8] hover:bg-white/10'
                      }`}
                    >
                      {!bid.revealed && bid.auctionStatus === 'Revealing' ? 'Reveal bid →' : 'View auction →'}
                    </Link>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
