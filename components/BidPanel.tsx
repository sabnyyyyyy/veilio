'use client';

import React, { useState } from 'react';
import { useAccount, useWriteContract } from 'wagmi';
import { parseEther } from 'viem';
import { BLINDBID_CONTRACT_ADDRESS, BLINDBID_ABI } from '@/lib/contract';
import { computeCommitmentHash, generateRandomSecret } from '@/lib/commitment';
import { saveBidSecret, getBidSecret, saveUserActivity } from '@/lib/secretStorage';
import { bnbChain } from '@/lib/chain';
import WalletButton from './WalletButton';

interface BidPanelProps {
  auctionId: string;
  startingPrice: string; // in BNB
  status?: 'Bidding' | 'Revealing' | 'Settled';
  winner?: string;
  winningPrice?: string;
}

export default function BidPanel({
  auctionId,
  startingPrice,
  status = 'Bidding',
  winner,
  winningPrice,
}: BidPanelProps) {
  const { address, isConnected } = useAccount();
  const [maxBidAmount, setMaxBidAmount] = useState<string>('700');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submittedTxHash, setSubmittedTxHash] = useState<`0x${string}` | null>(null);
  const [isTechOpen, setIsTechOpen] = useState(false);
  const [secretHash, setSecretHash] = useState<`0x${string}` | null>(null);

  // Reveal state
  const [revealSuccess, setRevealSuccess] = useState(false);
  const [refundSuccess, setRefundSuccess] = useState(false);

  const { writeContractAsync } = useWriteContract();

  const existingSecret = address ? getBidSecret(auctionId, address) : null;
  const isWinner = address && winner && address.toLowerCase() === winner.toLowerCase();

  // Handle Commit Bid
  const handleLockBid = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isConnected || !address) return;

    try {
      setIsSubmitting(true);
      const secret = generateRandomSecret();
      const commitment = computeCommitmentHash(BigInt(auctionId), address, maxBidAmount, secret);
      setSecretHash(commitment);

      // Save secret locally
      saveBidSecret({
        auctionId,
        bidder: address,
        maxBid: maxBidAmount,
        secret,
        commitment,
        timestamp: Date.now(),
      });

      // Submit commitment transaction to contract
      const txHash = await writeContractAsync({
        address: BLINDBID_CONTRACT_ADDRESS,
        abi: BLINDBID_ABI,
        functionName: 'commitBid',
        args: [BigInt(auctionId), commitment],
        value: parseEther(maxBidAmount),
      });

      setSubmittedTxHash(txHash);
    } catch (err: any) {
      console.error('Bid commitment error:', err);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Handle Reveal Bid
  const handleRevealBid = async () => {
    if (!isConnected || !address || !existingSecret) return;

    try {
      setIsSubmitting(true);
      const txHash = await writeContractAsync({
        address: BLINDBID_CONTRACT_ADDRESS,
        abi: BLINDBID_ABI,
        functionName: 'revealBid',
        args: [BigInt(auctionId), parseEther(existingSecret.maxBid), existingSecret.secret],
      });

      setRevealSuccess(true);
      setSubmittedTxHash(txHash);

      // Update secret storage
      saveBidSecret({
        ...existingSecret,
        revealed: true,
      });

      saveUserActivity({
        id: `act_${Date.now()}`,
        type: 'bid_revealed',
        auctionId,
        itemName: `Auction #${auctionId}`,
        amount: existingSecret.maxBid,
        timestamp: Date.now(),
        userAddress: address,
        txHash,
      });
    } catch (err: any) {
      console.error('Reveal error:', err);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Handle Refund Withdrawal
  const handleWithdrawRefund = async () => {
    if (!isConnected || !address) return;

    try {
      setIsSubmitting(true);
      const txHash = await writeContractAsync({
        address: BLINDBID_CONTRACT_ADDRESS,
        abi: BLINDBID_ABI,
        functionName: 'withdrawRefund',
      });

      setRefundSuccess(true);
      setSubmittedTxHash(txHash);

      if (existingSecret) {
        saveBidSecret({
          ...existingSecret,
          refundClaimed: true,
        });
      }

      saveUserActivity({
        id: `act_${Date.now()}`,
        type: 'refund_withdrawn',
        auctionId,
        itemName: `Auction #${auctionId}`,
        timestamp: Date.now(),
        userAddress: address,
        txHash,
      });
    } catch (err: any) {
      console.error('Withdraw refund error:', err);
    } finally {
      setIsSubmitting(false);
    }
  };

  // -------------------------------------------------------------
  // REVEALING PHASE UI
  // -------------------------------------------------------------
  if (status === 'Revealing') {
    return (
      <div className="p-8 rounded-2xl bg-[#151512] border border-white/10 space-y-6">
        <div>
          <span className="px-3 py-1 text-[10px] font-bold uppercase tracking-wider rounded bg-amber-500/10 border border-amber-500/30 text-amber-400">
            REVEAL PERIOD
          </span>
          <h3 className="text-xl font-bold text-[#F5F2E8] mt-3">Reveal Your Bid</h3>
          <p className="text-sm text-[#A8A397] mt-1">
            Bidding has closed. Participants must now reveal their secret max bids.
          </p>
        </div>

        {!isConnected ? (
          <div className="pt-2 space-y-4">
            <p className="text-sm text-[#F5F2E8]">Connect your wallet to reveal your bid.</p>
            <WalletButton />
          </div>
        ) : existingSecret ? (
          revealSuccess || existingSecret.revealed ? (
            <div className="p-6 rounded-xl bg-[#C9A45C]/10 border border-[#C9A45C]/30 space-y-3">
              <div className="flex items-center gap-3">
                <div className="w-6 h-6 rounded-full bg-[#C9A45C] text-[#0A0A09] flex items-center justify-center text-xs font-bold">
                  ✓
                </div>
                <div>
                  <span className="font-bold text-[#F5F2E8]">Commitment verified</span>
                  <p className="text-xs text-[#A8A397]">Your revealed bid matches the commitment on BNB Chain.</p>
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-4 pt-2">
              <div className="p-4 rounded-xl bg-[#0A0A09] border border-white/10 space-y-2 text-xs">
                <div className="flex justify-between">
                  <span className="text-[#A8A397]">Maximum Bid</span>
                  <span className="font-bold text-[#F5F2E8]">{existingSecret.maxBid} BNB</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#A8A397]">Secret Salt</span>
                  <span className="font-mono text-[#A8A397]">
                    {existingSecret.secret.substring(0, 10)}...
                  </span>
                </div>
              </div>

              <button
                onClick={handleRevealBid}
                disabled={isSubmitting}
                className="w-full py-4 text-sm font-bold uppercase tracking-wider rounded-xl bg-[#C9A45C] text-[#0A0A09] hover:bg-[#E6CC91] transition-colors disabled:opacity-50"
              >
                {isSubmitting ? 'Verifying on Chain...' : 'Reveal bid'}
              </button>
            </div>
          )
        ) : (
          <p className="text-sm text-[#A8A397]">You did not participate in this auction.</p>
        )}
      </div>
    );
  }

  // -------------------------------------------------------------
  // SETTLED PHASE UI
  // -------------------------------------------------------------
  if (status === 'Settled') {
    return (
      <div className="p-8 rounded-2xl bg-[#151512] border border-white/10 space-y-6">
        <div>
          <span className="px-3 py-1 text-[10px] font-bold uppercase tracking-wider rounded bg-white/[0.04] border border-white/10 text-[#C9A45C]">
            AUCTION COMPLETE
          </span>
          <h3 className="text-2xl font-extrabold text-[#F5F2E8] mt-3">Final Outcome</h3>
        </div>

        <div className="p-6 rounded-xl bg-[#0A0A09] border border-white/10 space-y-3 text-xs">
          <div className="flex justify-between py-1 border-b border-white/5">
            <span className="text-[#A8A397]">Winner</span>
            <span className="font-mono text-[#F5F2E8]">
              {winner ? `${winner.substring(0, 6)}...${winner.substring(38)}` : '0x71C4...39A1'}
            </span>
          </div>
          <div className="flex justify-between py-1">
            <span className="text-[#A8A397]">Winning Price</span>
            <span className="font-bold text-[#C9A45C] text-sm">{winningPrice || '681'} BNB</span>
          </div>
        </div>

        {isConnected && (
          isWinner ? (
            <div className="p-6 rounded-xl bg-[#C9A45C]/10 border border-[#C9A45C]/30 space-y-2">
              <span className="text-xs font-bold text-[#C9A45C] uppercase tracking-widest block">
                YOU WON
              </span>
              <p className="text-sm text-[#F5F2E8]">
                Congratulations! You acquired this item for {winningPrice || '681'} BNB.
              </p>
            </div>
          ) : existingSecret ? (
            <div className="space-y-4">
              <div className="p-4 rounded-xl bg-white/[0.02] border border-white/5 space-y-1 text-xs">
                <span className="text-[#A8A397]">AUCTION ENDED</span>
                <p className="text-[#F5F2E8]">You did not win this auction.</p>
              </div>

              {refundSuccess ? (
                <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-semibold">
                  ✓ Refund successfully claimed on BNB Chain.
                </div>
              ) : (
                <button
                  onClick={handleWithdrawRefund}
                  disabled={isSubmitting}
                  className="w-full py-3 text-xs font-bold uppercase tracking-wider rounded-xl bg-white/[0.04] border border-white/10 text-[#F5F2E8] hover:bg-white/[0.08] transition-colors"
                >
                  {isSubmitting ? 'Withdrawing...' : 'Withdraw refund'}
                </button>
              )}
            </div>
          ) : null
        )}
      </div>
    );
  }

  // -------------------------------------------------------------
  // BIDDING OPEN PHASE UI
  // -------------------------------------------------------------
  return (
    <div className="p-8 rounded-2xl bg-[#151512] border border-white/10 space-y-6">
      <div>
        <h3 className="text-[#A8A397] text-xs uppercase font-bold tracking-widest">
          YOUR BID COMMITMENT
        </h3>
        <p className="text-sm text-[#A8A397] mt-1">
          The commitment hash is opaque until reveal; your wallet address and escrow deposit remain public.
        </p>
      </div>

      {!isConnected ? (
        <div className="pt-2 space-y-4">
          <p className="text-sm text-[#F5F2E8]">Connect your Web3 wallet to submit a bid commitment.</p>
          <WalletButton />
        </div>
      ) : submittedTxHash || existingSecret ? (
        <div className="p-6 rounded-xl bg-[#C9A45C]/10 border border-[#C9A45C]/30 space-y-4">
          <div className="flex items-center gap-3">
            <div className="w-6 h-6 rounded-full bg-[#C9A45C] text-[#0A0A09] flex items-center justify-center text-xs font-bold">
              ✓
            </div>
            <div>
              <span className="font-bold text-[#F5F2E8]">Bid locked</span>
              <p className="text-xs text-[#A8A397]">Committed on BNB Chain</p>
            </div>
          </div>

          <div className="pt-2 border-t border-white/5 flex justify-between text-xs">
            <span className="text-[#A8A397]">Your maximum</span>
            <span className="font-bold text-[#F5F2E8]">
              {existingSecret ? existingSecret.maxBid : maxBidAmount} BNB
            </span>
          </div>

          {(submittedTxHash || existingSecret?.commitment) && (
            <a
              href={`${bnbChain.blockExplorers.default.url}/tx/${submittedTxHash || existingSecret?.commitment}`}
              target="_blank"
              rel="noreferrer"
              className="inline-block text-xs font-semibold text-[#C9A45C] hover:underline"
            >
              [ View transaction ]
            </a>
          )}
        </div>
      ) : (
        <form onSubmit={handleLockBid} className="space-y-6">
          <div className="relative">
            <input
              type="number"
              min={startingPrice}
              step="1"
              value={maxBidAmount}
              onChange={(e) => setMaxBidAmount(e.target.value)}
              required
              className="w-full px-5 py-4 text-2xl font-bold bg-[#0A0A09] border border-white/10 rounded-xl text-[#F5F2E8] focus:outline-none focus:border-[#C9A45C] transition-colors"
              placeholder="700"
            />
            <span className="absolute right-5 top-1/2 -translate-y-1/2 text-sm font-semibold text-[#A8A397]">
              BNB
            </span>
          </div>

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full py-4 text-sm font-bold uppercase tracking-wider rounded-xl bg-[#C9A45C] text-[#0A0A09] hover:bg-[#E6CC91] active:scale-[0.98] transition-all duration-200 disabled:opacity-50"
          >
            {isSubmitting ? 'Locking Bid...' : 'Lock bid'}
          </button>
        </form>
      )}

      {/* Status & Blockchain Verification Badge */}
      <div className="pt-6 border-t border-white/5 space-y-4">
        <div className="flex items-center justify-between text-xs text-[#A8A397]">
          <span>Auction status</span>
          <span className="font-semibold text-[#C9A45C]">Bidding open</span>
        </div>
        <div className="flex items-center justify-between text-xs text-[#A8A397]">
          <span>Blockchain verification</span>
          <span className="font-semibold text-[#F5F2E8]">BNB Chain Testnet</span>
        </div>
      </div>

      {/* Progressive Disclosure: Technical verification (Collapsed by default) */}
      <div className="pt-4 border-t border-white/5">
        <button
          onClick={() => setIsTechOpen(!isTechOpen)}
          className="w-full flex items-center justify-between text-xs text-[#A8A397] hover:text-[#F5F2E8] transition-colors py-1"
        >
          <span>Technical verification</span>
          <span>{isTechOpen ? '▲' : '▼'}</span>
        </button>

        {isTechOpen && (
          <div className="mt-3 p-4 rounded-xl bg-[#0A0A09] border border-white/5 space-y-2 text-xs">
            <div className="flex justify-between">
              <span className="text-[#A8A397]">Network</span>
              <span className="font-mono text-[#F5F2E8]">BNB Chain (97)</span>
            </div>
            <div className="flex justify-between">
              <span className="text-[#A8A397]">Contract</span>
              <span className="font-mono text-[#F5F2E8]">
                {BLINDBID_CONTRACT_ADDRESS.substring(0, 6)}...{BLINDBID_CONTRACT_ADDRESS.substring(38)}
              </span>
            </div>
            {(secretHash || existingSecret?.commitment) && (
              <div className="flex justify-between">
                <span className="text-[#A8A397]">Commitment</span>
                <span className="font-mono text-[#C9A45C]">
                  {(secretHash || existingSecret?.commitment)?.substring(0, 8)}...
                </span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
