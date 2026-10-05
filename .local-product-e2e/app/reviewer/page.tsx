'use client';

import React, { useEffect, useState } from 'react';
import { useAccount, usePublicClient, useWriteContract } from 'wagmi';
import { Shield, Check, X, Search, FileSearch } from 'lucide-react';
import { VEIL_V2_ABI, VEIL_V2_CONTRACT_ADDRESS } from '@/lib/contract';
import { bnbChain } from '@/lib/chain';

interface RefundRequest {
  auctionId: string;
  buyer: string;
  disputedCriterion: string;
  expectedValue: string;
  actualValue: string;
  reason: string;
  evidenceHash: string;
  timestamp: number;
}

export default function ReviewerDashboard() {
  const { address, isConnected } = useAccount();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();

  const [refunds, setRefunds] = useState<RefundRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [auctionStates, setAuctionStates] = useState<Record<string, number>>({});
  
  // 3=Inspection, 4=RefundRequested, 5=UnderReview, 6=Completed, 7=Refunded
  
  useEffect(() => {
    async function loadRefunds() {
      try {
        const res = await fetch('/api/reviewer/refunds');
        const data = await res.json();
        if (data.success) {
          setRefunds(data.refunds);
          await loadAuctionStates(data.refunds);
        }
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    }
    
    async function loadAuctionStates(list: RefundRequest[]) {
      if (!publicClient) return;
      const states: Record<string, number> = {};
      
      for (const r of list) {
        try {
          const raw = await publicClient.readContract({
            address: VEIL_V2_CONTRACT_ADDRESS,
            abi: VEIL_V2_ABI,
            functionName: 'auctions',
            args: [BigInt(r.auctionId)],
          });
          const state = Number((raw as any)[10]);
          states[r.auctionId] = state;
        } catch (e) {
          console.error(e);
        }
      }
      setAuctionStates(states);
    }
    
    loadRefunds();
  }, [publicClient]);

  const handleMarkUnderReview = async (auctionId: string) => {
    try {
      const hash = await writeContractAsync({
        address: VEIL_V2_CONTRACT_ADDRESS,
        abi: VEIL_V2_ABI,
        functionName: 'markUnderReview',
        args: [BigInt(auctionId)],
      });
      await publicClient?.waitForTransactionReceipt({ hash });
      window.location.reload();
    } catch (e: any) {
      alert('Error: ' + (e.shortMessage || e.message));
    }
  };

  const handleResolve = async (auctionId: string, approved: boolean) => {
    try {
      let reason = 'Approved';
      if (!approved) {
        reason = prompt('Enter rejection reason (required):') || '';
        if (!reason.trim()) {
          alert('Rejection reason is mandatory.');
          return;
        }
      }
      
      const hash = await writeContractAsync({
        address: VEIL_V2_CONTRACT_ADDRESS,
        abi: VEIL_V2_ABI,
        functionName: 'resolveRefund',
        args: [BigInt(auctionId), approved, reason],
      });
      await publicClient?.waitForTransactionReceipt({ hash });
      window.location.reload();
    } catch (e: any) {
      alert('Error: ' + (e.shortMessage || e.message));
    }
  };

  if (!isConnected) {
    return (
      <div className="min-h-screen bg-[#0A0A09] flex items-center justify-center">
        <p className="text-[#A8A397]">Please connect wallet (must be reviewer).</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0A0A09] pt-32 px-6 pb-20">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center gap-3 mb-8">
          <Shield className="w-8 h-8 text-[#C9A45C]" />
          <h1 className="text-3xl font-bold text-[#F5F2E8]">Reviewer Dashboard</h1>
        </div>

        {loading ? (
          <p className="text-[#A8A397]">Loading disputes...</p>
        ) : refunds.length === 0 ? (
          <p className="text-[#A8A397]">No refund requests found.</p>
        ) : (
          <div className="space-y-6">
            {refunds.map(r => {
              const state = auctionStates[r.auctionId];
              const isResolved = state === 6 || state === 7;
              
              return (
                <div key={r.auctionId} className="bg-white/[0.02] border border-white/10 p-6 rounded-2xl">
                  <div className="flex justify-between items-start mb-4">
                    <div>
                      <h2 className="text-lg font-bold text-[#F5F2E8]">Auction #{r.auctionId}</h2>
                      <p className="text-xs text-[#A8A397]">Buyer: <span className="font-mono text-[#C9A45C]">{r.buyer}</span></p>
                    </div>
                    <div>
                      {state === 4 && <span className="px-3 py-1 bg-yellow-500/20 text-yellow-400 text-xs rounded-full uppercase font-bold tracking-wider">Pending</span>}
                      {state === 5 && <span className="px-3 py-1 bg-blue-500/20 text-blue-400 text-xs rounded-full uppercase font-bold tracking-wider">Under Review</span>}
                      {state === 6 && <span className="px-3 py-1 bg-rose-500/20 text-rose-400 text-xs rounded-full uppercase font-bold tracking-wider">Rejected</span>}
                      {state === 7 && <span className="px-3 py-1 bg-emerald-500/20 text-emerald-400 text-xs rounded-full uppercase font-bold tracking-wider">Approved</span>}
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4 mb-6 text-sm">
                    <div className="bg-[#0A0A09] p-4 rounded-xl border border-white/5">
                      <span className="text-xs text-[#A8A397] block mb-1">Disputed Criterion</span>
                      <span className="text-[#F5F2E8] font-bold">{r.disputedCriterion}</span>
                    </div>
                    <div className="bg-[#0A0A09] p-4 rounded-xl border border-white/5">
                      <span className="text-xs text-[#A8A397] block mb-1">Expected vs Actual</span>
                      <span className="text-emerald-400 font-bold">{r.expectedValue}</span> 
                      <span className="text-[#A8A397] mx-2">→</span> 
                      <span className="text-rose-400 font-bold">{r.actualValue}</span>
                    </div>
                  </div>

                  <div className="bg-[#0A0A09] p-4 rounded-xl border border-white/5 mb-6">
                    <span className="text-xs text-[#A8A397] block mb-2">Buyer's Claim</span>
                    <p className="text-sm text-[#F5F2E8]">{r.reason}</p>
                    <div className="mt-4 pt-4 border-t border-white/5">
                      <span className="text-xs text-[#A8A397] block mb-1">Evidence Hash</span>
                      <p className="font-mono text-xs text-[#C9A45C] truncate">{r.evidenceHash}</p>
                    </div>
                  </div>

                  {!isResolved && (
                    <div className="flex gap-4">
                      {state === 4 ? (
                        <button 
                          onClick={() => handleMarkUnderReview(r.auctionId)}
                          className="flex-1 py-3 bg-blue-500/20 hover:bg-blue-500/30 text-blue-400 rounded-xl font-bold uppercase tracking-wider text-xs transition-colors"
                        >
                          Mark Under Review
                        </button>
                      ) : (
                        <>
                          <button 
                            onClick={() => handleResolve(r.auctionId, true)}
                            className="flex-1 py-3 bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-400 rounded-xl font-bold uppercase tracking-wider text-xs transition-colors flex items-center justify-center gap-2"
                          >
                            <Check className="w-4 h-4" /> Approve Refund
                          </button>
                          <button 
                            onClick={() => handleResolve(r.auctionId, false)}
                            className="flex-1 py-3 bg-rose-500/20 hover:bg-rose-500/30 text-rose-400 rounded-xl font-bold uppercase tracking-wider text-xs transition-colors flex items-center justify-center gap-2"
                          >
                            <X className="w-4 h-4" /> Reject Claim
                          </button>
                        </>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
