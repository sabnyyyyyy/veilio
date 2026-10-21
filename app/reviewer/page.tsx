'use client';

import React, { useCallback, useState } from 'react';
import { useAccount, useChainId, usePublicClient, useSignMessage, useSwitchChain, useWriteContract } from 'wagmi';
import { Shield, Check, X } from 'lucide-react';
import { getAuctionContractConfig } from '@/lib/contract';
import { baseSepoliaChain, bnbChain } from '@/lib/chain';
import {
  ALL_AUCTIONS,
  AUCTION_AUTH_ACTIONS,
  auctionNetworkDisplayName,
  sameWallet,
  type AuctionNetworkId,
} from '@/lib/auctionNetwork';
import { buildAuctionAuth, connectSolanaWallet, sendSolanaAuctionInstructions } from '@/lib/client/auctionWallet';
import { createReviewRefundInstruction } from '@/lib/cross-chain/solanaAuction';
import { getSolanaServiceFeeRecipient } from '@/lib/cross-chain/solanaServiceEscrow';
import { fetchSolanaAuctionConfig, fetchSolanaAuctionStateById } from '@/lib/solanaAuctions';

interface RefundRequest {
  auctionId: string;
  networkId?: AuctionNetworkId;
  buyer: string;
  disputedCriterion: string;
  expectedValue: string;
  actualValue: string;
  reason: string;
  evidenceHash: string;
  timestamp: number;
}

interface ReviewAuctionState {
  /** Shared numbering: 3=Inspection, 4=RefundRequested, 5=UnderReview, 6=Completed, 7=Refunded */
  state: number;
  seller: string;
  winner: string;
  reviewer?: string;
}

const NETWORKS: AuctionNetworkId[] = ['bnb:97', 'base:84532', 'solana:devnet'];

function evmChainIdFor(networkId: AuctionNetworkId) {
  return networkId === 'base:84532' ? baseSepoliaChain.id : bnbChain.id;
}

export default function ReviewerDashboard() {
  const { address, isConnected } = useAccount();
  const walletChainId = useChainId();
  const { switchChain } = useSwitchChain();
  const { signMessageAsync } = useSignMessage();
  const { writeContractAsync } = useWriteContract();
  const bnbClient = usePublicClient({ chainId: bnbChain.id });
  const baseClient = usePublicClient({ chainId: baseSepoliaChain.id });

  const [networkId, setNetworkId] = useState<AuctionNetworkId>('bnb:97');
  const [reviewerAddress, setReviewerAddress] = useState<string | null>(null);
  const [refunds, setRefunds] = useState<RefundRequest[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyAuction, setBusyAuction] = useState<string | null>(null);
  const [auctionStates, setAuctionStates] = useState<Record<string, ReviewAuctionState>>({});

  const isSolana = networkId === 'solana:devnet';
  const evmClient = networkId === 'base:84532' ? baseClient : bnbClient;

  const loadAuctionStates = useCallback(async (list: RefundRequest[], target: AuctionNetworkId) => {
    const states: Record<string, ReviewAuctionState> = {};
    // After the program upgrade the global AuctionConfig reviewer signs every review_refund.
    let solanaConfigReviewer: string | null = null;
    if (target === 'solana:devnet') {
      try {
        solanaConfigReviewer = (await fetchSolanaAuctionConfig())?.reviewer ?? null;
      } catch (e) {
        console.error(e);
      }
    }
    for (const r of list) {
      try {
        if (target === 'solana:devnet') {
          const decoded = await fetchSolanaAuctionStateById(r.auctionId);
          if (decoded) states[r.auctionId] = { state: Number(decoded.state), seller: decoded.seller, winner: decoded.highestBidder, reviewer: solanaConfigReviewer ?? decoded.reviewer };
        } else {
          const client = target === 'base:84532' ? baseClient : bnbClient;
          if (!client) continue;
          const contract = getAuctionContractConfig(evmChainIdFor(target));
          const raw = await client.readContract({
            address: contract.address,
            abi: contract.abi,
            functionName: 'auctions',
            args: [BigInt(r.auctionId)],
          }) as readonly unknown[];
          states[r.auctionId] = { state: Number(raw[10]), seller: String(raw[1]), winner: String(raw[11]) };
        }
      } catch (e) {
        console.error(e);
      }
    }
    setAuctionStates(states);
  }, [baseClient, bnbClient]);

  /** Signs a reviewer authorization; the server checks the signer is the on-chain reviewer. */
  const loadRefunds = useCallback(async (target: AuctionNetworkId) => {
    setLoading(true);
    setError(null);
    try {
      const signer = target === 'solana:devnet' ? await connectSolanaWallet() : address;
      if (!signer) throw new Error('Connect the reviewer wallet first.');
      setReviewerAddress(signer);
      const auth = await buildAuctionAuth({
        action: AUCTION_AUTH_ACTIONS.listRefunds,
        networkId: target,
        auctionId: ALL_AUCTIONS,
        address: signer,
        signEvm: signMessageAsync,
      });
      const query = new URLSearchParams({
        network: target,
        address: auth.address,
        signature: auth.signature,
        timestamp: String(auth.timestamp),
        nonce: auth.nonce,
      });
      const res = await fetch(`/api/reviewer/refunds?${query.toString()}`, { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Could not load refund requests.');
      setRefunds(data.refunds);
      setLoaded(true);
      await loadAuctionStates(data.refunds, target);
    } catch (e: any) {
      console.error(e);
      setError(e?.shortMessage || e?.message || 'Could not load refund requests.');
    } finally {
      setLoading(false);
    }
  }, [address, signMessageAsync, loadAuctionStates]);

  async function ensureEvmChain() {
    const chainId = evmChainIdFor(networkId);
    if (walletChainId !== chainId) {
      if (!switchChain) throw new Error(`Switch your wallet to ${auctionNetworkDisplayName(networkId)}.`);
      await switchChain({ chainId });
    }
    return chainId;
  }

  const handleMarkUnderReview = async (auctionId: string) => {
    try {
      setBusyAuction(auctionId);
      const chainId = await ensureEvmChain();
      const contract = getAuctionContractConfig(chainId);
      const hash = await writeContractAsync({
        chainId,
        address: contract.address,
        abi: contract.abi,
        functionName: 'markUnderReview',
        args: [BigInt(auctionId)],
      });
      await evmClient?.waitForTransactionReceipt({ hash });
      await loadAuctionStates(refunds, networkId);
    } catch (e: any) {
      alert('Error: ' + (e.shortMessage || e.message));
    } finally {
      setBusyAuction(null);
    }
  };

  const handleResolve = async (r: RefundRequest, approved: boolean) => {
    try {
      setBusyAuction(r.auctionId);
      if (isSolana) {
        // Solana `review_refund(approve)`: approve returns the escrow to the winner,
        // reject pays the seller. The program stores no rejection reason.
        const reviewer = await connectSolanaWallet();
        const onchain = auctionStates[r.auctionId];
        if (!onchain) throw new Error('Auction state is not loaded yet.');
        if (onchain.reviewer && !sameWallet(onchain.reviewer, reviewer, networkId)) {
          throw new Error('The connected Solana wallet is not this auction\'s reviewer.');
        }
        if (!window.confirm(approved ? 'Approve the refund and return the escrow to the winner?' : 'Reject the refund and pay the seller?')) return;
        const inst = createReviewRefundInstruction({
          auctionId: BigInt(r.auctionId),
          seller: onchain.seller,
          reviewer,
          winner: onchain.winner,
          approve: approved,
          feeRecipient: getSolanaServiceFeeRecipient(),
        });
        await sendSolanaAuctionInstructions([inst], reviewer, 'Solana refund review');
        await loadAuctionStates(refunds, networkId);
        return;
      }

      let reason = 'Approved';
      if (!approved) {
        reason = prompt('Enter rejection reason (required):') || '';
        if (!reason.trim()) {
          alert('Rejection reason is mandatory.');
          return;
        }
      }

      const chainId = await ensureEvmChain();
      const contract = getAuctionContractConfig(chainId);
      const hash = await writeContractAsync({
        chainId,
        address: contract.address,
        abi: contract.abi,
        functionName: 'resolveRefund',
        args: [BigInt(r.auctionId), approved, reason],
      });
      await evmClient?.waitForTransactionReceipt({ hash });
      await loadAuctionStates(refunds, networkId);
    } catch (e: any) {
      alert('Error: ' + (e.shortMessage || e.message));
    } finally {
      setBusyAuction(null);
    }
  };

  return (
    <div className="min-h-screen bg-[#0A0A09] pt-32 px-6 pb-20">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center gap-3 mb-8">
          <Shield className="w-8 h-8 text-[#C9A45C]" />
          <h1 className="text-3xl font-bold text-[#F5F2E8]">Reviewer Dashboard</h1>
        </div>

        <div className="mb-6 flex flex-wrap items-center gap-2">
          {NETWORKS.map((id) => (
            <button
              key={id}
              type="button"
              onClick={() => { setNetworkId(id); setLoaded(false); setRefunds([]); setAuctionStates({}); setError(null); }}
              className={`px-4 py-2 text-xs font-bold uppercase tracking-wider rounded-xl transition-colors ${networkId === id ? 'bg-[#C9A45C] text-[#0A0A09]' : 'border border-white/10 text-[#A8A397] hover:text-[#F5F2E8]'}`}
            >
              {auctionNetworkDisplayName(id)}
            </button>
          ))}
        </div>

        <div className="mb-8 rounded-2xl border border-white/10 bg-white/[0.02] p-5 space-y-3">
          <p className="text-sm text-[#A8A397]">
            {isSolana
              ? 'Connect the Solana wallet that is the reviewer of the auctions. Only auctions whose on-chain reviewer is your wallet are listed.'
              : `Connect the reviewer wallet of the ${auctionNetworkDisplayName(networkId)} auction contract. The server verifies your signature against the contract's reviewer().`}
          </p>
          {!isSolana && !isConnected ? (
            <p className="text-sm text-[#A8A397]">Please connect your EVM wallet (must be the reviewer).</p>
          ) : (
            <button
              type="button"
              onClick={() => { void loadRefunds(networkId); }}
              disabled={loading}
              className="px-5 py-3 bg-[#C9A45C] text-[#0A0A09] rounded-xl text-xs font-bold uppercase tracking-wider disabled:opacity-50"
            >
              {loading ? 'Waiting for signature…' : loaded ? 'Refresh (sign again)' : 'Sign in as reviewer'}
            </button>
          )}
          {reviewerAddress && loaded && <p className="text-xs text-[#A8A397]">Signed in as <span className="font-mono text-[#C9A45C]">{reviewerAddress}</span></p>}
          {error && <p role="alert" className="text-sm text-rose-400">{error}</p>}
        </div>

        {!loaded ? null : refunds.length === 0 ? (
          <p className="text-[#A8A397]">No refund requests found.</p>
        ) : (
          <div className="space-y-6">
            {refunds.map(r => {
              const onchain = auctionStates[r.auctionId];
              const state = onchain?.state;
              const isResolved = state === 6 || state === 7;
              const busy = busyAuction === r.auctionId;

              return (
                <div key={`${networkId}:${r.auctionId}`} className="bg-white/[0.02] border border-white/10 p-6 rounded-2xl">
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

                  {!isResolved && (state === 4 || state === 5) && (
                    <div className="flex gap-4">
                      {state === 4 && !isSolana ? (
                        <button
                          onClick={() => handleMarkUnderReview(r.auctionId)}
                          disabled={busy}
                          className="flex-1 py-3 bg-blue-500/20 hover:bg-blue-500/30 text-blue-400 rounded-xl font-bold uppercase tracking-wider text-xs transition-colors disabled:opacity-50"
                        >
                          Mark Under Review
                        </button>
                      ) : (
                        <>
                          <button
                            onClick={() => handleResolve(r, true)}
                            disabled={busy}
                            className="flex-1 py-3 bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-400 rounded-xl font-bold uppercase tracking-wider text-xs transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
                          >
                            <Check className="w-4 h-4" /> Approve Refund
                          </button>
                          <button
                            onClick={() => handleResolve(r, false)}
                            disabled={busy}
                            className="flex-1 py-3 bg-rose-500/20 hover:bg-rose-500/30 text-rose-400 rounded-xl font-bold uppercase tracking-wider text-xs transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
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
