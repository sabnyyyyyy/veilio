'use client';

import React, { useState } from 'react';
import {
  AlertTriangle,
  Scale,
  ShieldAlert,
  CheckCircle2,
  FileText,
  Send,
  Loader2,
  ExternalLink,
  ChevronDown,
  ChevronUp,
  HelpCircle,
  Sparkles,
  Lock,
} from 'lucide-react';
import { stringToHex, pad } from 'viem';
import { useAccount, useWriteContract, usePublicClient } from 'wagmi';
import {
  VEIL_SERVICE_ESCROW_ABI,
  getServiceEscrowAddress,
} from '@/lib/serviceContract';
import type { ServiceAuthPayload } from '@/lib/serviceAuth';
import {
  createDisputeOrderInstruction,
  createResolveDisputeInstruction,
  getSolanaServiceEscrowProgramId,
  getSolanaServiceFeeRecipient,
  toSolanaEscrowOrderIdHex,
} from '@/lib/cross-chain/solanaServiceEscrow';
import type { SolanaCompiledInstruction } from '@/lib/cross-chain/solanaServiceRegistry';
import { useServicesWalletAuth } from '@/components/services/useServicesWalletAuth';
import type {
  ServiceOrder,
  ServiceDispute,
  DisputeEvidence,
  DisputeAiRecommendation,
  ServiceNetworkId,
} from '@/lib/server/servicesDb';

interface DisputeResolutionPanelProps {
  order: ServiceOrder;
  dispute: ServiceDispute | null;
  /** Wallet acting on this order (EVM address, or the Solana wallet for Solana orders). */
  currentUserAddress?: string;
  onRefresh: () => void;
  /** Settlement network; defaults to order.network (legacy: BNB Testnet). */
  network?: ServiceNetworkId;
  /** Required for Solana orders: signs + sends an escrow instruction, returns the signature. */
  sendSolanaInstruction?: (ix: SolanaCompiledInstruction) => Promise<string>;
}

export default function DisputeResolutionPanel({
  order,
  dispute,
  currentUserAddress,
  onRefresh,
  network: networkProp,
  sendSolanaInstruction,
}: DisputeResolutionPanelProps) {
  const { writeContractAsync } = useWriteContract();
  const { chainId: walletChainId } = useAccount();
  const { signAction } = useServicesWalletAuth();
  const publicClient = usePublicClient();

  const network: ServiceNetworkId = networkProp || order.network || 'bnb:97';
  const isSolanaOrder = network === 'solana:devnet';
  const evmChainId = network === 'base:84532' ? 84532 : 97;
  const evmNetworkName = evmChainId === 84532 ? 'Base Sepolia (84532)' : 'BNB Chain Testnet (97)';
  const escrowAddress = getServiceEscrowAddress(evmChainId);
  const txExplorerUrl = (tx: string) =>
    isSolanaOrder
      ? `https://explorer.solana.com/tx/${tx}?cluster=devnet`
      : evmChainId === 84532
      ? `https://sepolia.basescan.org/tx/${tx}`
      : `https://testnet.bscscan.com/tx/${tx}`;

  const assertEvmChain = () => {
    if (!escrowAddress) {
      throw new Error(`Service escrow contract is not configured for ${evmNetworkName}.`);
    }
    if (walletChainId && walletChainId !== evmChainId) {
      throw new Error(`Please switch your wallet network to ${evmNetworkName}.`);
    }
  };

  const signAuth = async (action: string, scopeId: string): Promise<ServiceAuthPayload> => {
    if (!currentUserAddress) throw new Error('No wallet connected.');
    return signAction(currentUserAddress, action, scopeId);
  };

  // Initiation State
  const [showInitiateModal, setShowInitiateModal] = useState(false);
  const [disputeReason, setDisputeReason] = useState('');
  const [evidenceTitle, setEvidenceTitle] = useState('');
  const [evidenceDesc, setEvidenceDesc] = useState('');
  const [evidenceRef, setEvidenceRef] = useState('');
  const [initiating, setInitiating] = useState(false);

  // Evidence Submission State
  const [showEvidenceForm, setShowEvidenceForm] = useState(false);
  const [newEvTitle, setNewEvTitle] = useState('');
  const [newEvDesc, setNewEvDesc] = useState('');
  const [newEvType, setNewEvType] = useState<'claim' | 'file_url' | 'milestone_proof' | 'contract_log' | 'chat_excerpt'>('claim');
  const [newEvRef, setNewEvRef] = useState('');
  const [submittingEvidence, setSubmittingEvidence] = useState(false);

  // AI Evaluation State
  const [evaluating, setEvaluating] = useState(false);

  // Reviewer Decision State
  const [reviewerDecision, setReviewerDecision] = useState<'approved_as_recommended' | 'revised_and_approved'>('approved_as_recommended');
  const [revisedBuyerSplit, setRevisedBuyerSplit] = useState<number>(50);
  const [reviewerReason, setReviewerReason] = useState('');
  const [reviewing, setReviewing] = useState(false);

  const sameAddress = (a?: string, b?: string) =>
    Boolean(a && b) && (isSolanaOrder ? a === b : a!.toLowerCase() === b!.toLowerCase());
  const isBuyer = sameAddress(currentUserAddress, order.buyerId);
  const isSeller = sameAddress(currentUserAddress, order.sellerId);

  // Helper to convert orderId to bytes32
  const getBytes32OrderId = (idStr: string) => {
    try {
      const hex = stringToHex(idStr);
      return pad(hex, { size: 32, dir: 'right' });
    } catch {
      return ('0x' + Buffer.from(idStr.padEnd(32, '\0')).toString('hex')) as `0x${string}`;
    }
  };

  // Open Dispute
  const handleInitiateDispute = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentUserAddress || !disputeReason.trim()) return;

    try {
      setInitiating(true);

      // On-chain dispute on the order's own network (required: escrow funds are locked)
      let onChainDisputeTx: string;
      if (isSolanaOrder) {
        if (!sendSolanaInstruction) throw new Error('Connect your Solana wallet to open a dispute on Solana Devnet.');
        onChainDisputeTx = await sendSolanaInstruction(createDisputeOrderInstruction({
          programId: getSolanaServiceEscrowProgramId(),
          caller: currentUserAddress,
          orderId: toSolanaEscrowOrderIdHex(order.id),
          reason: disputeReason.trim().slice(0, 200),
        }));
      } else {
        assertEvmChain();
        const orderBytes32 = getBytes32OrderId(order.id);
        const evmTx = await writeContractAsync({
          address: escrowAddress,
          abi: VEIL_SERVICE_ESCROW_ABI,
          functionName: 'dispute',
          args: [orderBytes32, disputeReason.trim()],
        });
        onChainDisputeTx = evmTx;

        if (publicClient && evmTx) {
          const receipt = await publicClient.waitForTransactionReceipt({ hash: evmTx });
          if (receipt.status !== 'success') {
            throw new Error('On-chain dispute transaction failed or reverted.');
          }
        }
      }

      // Sign authentication payload
      const disputeAuth = await signAuth('dispute', order.id);

      const res = await fetch(`/api/services/orders/${order.id}/disputes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          initiatorAddress: currentUserAddress,
          reason: disputeReason.trim(),
          evidenceTitle: evidenceTitle.trim() || undefined,
          evidenceDescription: evidenceDesc.trim() || undefined,
          evidenceReferences: evidenceRef.trim() ? [evidenceRef.trim()] : undefined,
          txHash: onChainDisputeTx,
          auth: disputeAuth,
        }),
      });

      const data = await res.json();
      if (data.success) {
        setShowInitiateModal(false);
        setDisputeReason('');
        setEvidenceTitle('');
        setEvidenceDesc('');
        setEvidenceRef('');
        onRefresh();
        alert('Dispute successfully initiated. Evidence gathering phase is open.');
      } else {
        alert(data.error || 'Failed to initiate dispute');
      }
    } catch (err: any) {
      alert(err.message || 'Error initiating dispute');
    } finally {
      setInitiating(false);
    }
  };

  // Submit Evidence
  const handleSubmitEvidence = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!dispute || !currentUserAddress || !newEvTitle.trim() || !newEvDesc.trim()) return;

    try {
      setSubmittingEvidence(true);
      const evidenceAuth = await signAuth('submit-dispute-evidence', dispute.id);
      const res = await fetch(`/api/services/disputes/${dispute.id}/evidence`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          submittedBy: currentUserAddress,
          evidenceType: newEvType,
          title: newEvTitle.trim(),
          description: newEvDesc.trim(),
          references: newEvRef.trim() ? [newEvRef.trim()] : [],
          auth: evidenceAuth,
        }),
      });

      const data = await res.json();
      if (data.success) {
        setShowEvidenceForm(false);
        setNewEvTitle('');
        setNewEvDesc('');
        setNewEvRef('');
        onRefresh();
        alert('Evidence recorded and timestamped.');
      } else {
        alert(data.error || 'Failed to submit evidence');
      }
    } catch (err: any) {
      alert(err.message || 'Error submitting evidence');
    } finally {
      setSubmittingEvidence(false);
    }
  };

  // Run AI Evaluation
  const handleRunAiEvaluation = async () => {
    if (!dispute || !currentUserAddress || (!isBuyer && !isSeller)) return;

    try {
      setEvaluating(true);
      const evaluateAuth = await signAuth('evaluate-dispute', dispute.id);
      const res = await fetch(`/api/services/disputes/${dispute.id}/evaluate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          auth: evaluateAuth,
        }),
      });

      const data = await res.json();
      if (data.success) {
        onRefresh();
      } else {
        alert(data.error || 'Failed to run AI evaluation');
      }
    } catch (err: any) {
      alert(err.message || 'Error running evaluation');
    } finally {
      setEvaluating(false);
    }
  };

  // Reviewer Decision & Settlement
  const handleReviewerDecision = async () => {
    if (!dispute || !currentUserAddress) return;

    const buyerSplit =
      reviewerDecision === 'approved_as_recommended'
        ? dispute.recommendation?.recommendedDistribution.buyerRefundPercent ?? 50
        : revisedBuyerSplit;

    const sellerSplit = 100 - buyerSplit;

    if (!confirm(`Execute settlement: ${buyerSplit}% Refund to Buyer, ${sellerSplit}% Award to Seller? This will submit an on-chain transaction.`)) {
      return;
    }

    try {
      setReviewing(true);
      const preflightRes = await fetch(`/api/services/disputes/${dispute.id}/review`, { cache: 'no-store' });
      const preflight = await preflightRes.json();
      if (!preflightRes.ok || !preflight.ready) {
        throw new Error(preflight.error || 'Reviewer settlement is not configured.');
      }
      if (!sameAddress(String(preflight.reviewerAddress), currentUserAddress)) {
        throw new Error('Connect the designated reviewer wallet before settling this dispute.');
      }

      let txHash: string;
      if (isSolanaOrder) {
        if (!sendSolanaInstruction) throw new Error('Connect the reviewer Solana wallet to settle on Solana Devnet.');
        txHash = await sendSolanaInstruction(createResolveDisputeInstruction({
          programId: getSolanaServiceEscrowProgramId(),
          reviewer: currentUserAddress,
          buyer: order.buyerId,
          seller: order.sellerId,
          feeRecipient: getSolanaServiceFeeRecipient(),
          orderId: toSolanaEscrowOrderIdHex(order.id),
          splitToBuyerPercent: buyerSplit,
        }));
      } else {
        assertEvmChain();
        const orderBytes32 = getBytes32OrderId(order.id);
        const evmTx = await writeContractAsync({
          address: escrowAddress,
          abi: VEIL_SERVICE_ESCROW_ABI,
          functionName: 'resolveDispute',
          args: [orderBytes32, buyerSplit],
        });
        txHash = evmTx;

        if (publicClient) {
          const receipt = await publicClient.waitForTransactionReceipt({ hash: evmTx });
          if (receipt.status !== 'success') {
            throw new Error('On-chain dispute resolution transaction failed or was reverted.');
          }
        }
      }

      // Sign reviewer authentication payload
      const reviewAuth = await signAuth('review-dispute', dispute.id);

      const res = await fetch(`/api/services/disputes/${dispute.id}/review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reviewerAddress: currentUserAddress,
          decision: reviewerDecision,
          buyerRefundPercent: buyerSplit,
          sellerGrossAwardPercent: sellerSplit,
          reason: reviewerReason.trim() || 'Reviewer approved resolution following evidence review.',
          settlementTxHash: txHash,
          auth: reviewAuth,
        }),
      });

      const data = await res.json();
      if (data.success) {
        alert('Dispute resolution settled and recorded on-chain.');
        onRefresh();
      } else {
        alert(data.error || 'Failed to record review decision');
      }
    } catch (err: any) {
      console.error('Review execution error:', err);
      const isRejection = err.message?.includes('User rejected') || err.code === 4001;
      alert(isRejection ? 'Transaction cancelled in wallet.' : (err.shortMessage || err.message || 'Review execution failed'));
    } finally {
      setReviewing(false);
    }
  };

  // If no dispute exists, show the dispute initiation trigger button
  if (!dispute) {
    const isEligibleToDispute =
      (isBuyer || isSeller) &&
      ['Funded', 'InProgress', 'InReview', 'RevisionRequested'].includes(order.status);

    if (!isEligibleToDispute) return null;

    return (
      <div className="p-6 rounded-2xl bg-[#151512] border border-white/5 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-[#A8A397]">
            <Scale className="w-4 h-4 text-[#C9A45C]" />
            <span className="text-xs font-bold uppercase tracking-wider text-[#F5F2E8]">
              Dispute Resolution & Cancellation
            </span>
          </div>
          <button
            onClick={() => setShowInitiateModal(!showInitiateModal)}
            className="px-4 py-2 bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/20 rounded-xl text-xs font-bold uppercase tracking-wider transition-colors flex items-center gap-2"
          >
            <ShieldAlert className="w-3.5 h-3.5" />
            <span>Open Dispute</span>
          </button>
        </div>

        {showInitiateModal && (
          <form onSubmit={handleInitiateDispute} className="pt-4 border-t border-white/5 space-y-4">
            <div className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-xl text-xs text-amber-300 space-y-1">
              <span className="font-bold flex items-center gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5" />
                VEILIO Escrow Dispute Safeguard
              </span>
              <p className="text-[11px] text-amber-200/80 leading-relaxed">
                Opening a dispute will freeze escrow fund distribution. Neither party can unilaterally claim funds. An AI recommendation will evaluate deliverables and cancellation validity, followed by designated human reviewer resolution.
              </p>
            </div>

            <div className="space-y-1.5">
              <label className="text-[10px] uppercase tracking-widest text-[#A8A397] block font-bold">
                Dispute / Cancellation Reason *
              </label>
              <textarea
                rows={3}
                value={disputeReason}
                onChange={(e) => setDisputeReason(e.target.value)}
                placeholder="State clearly why you are disputing this order (missed deadline, defective work, unresponsiveness)..."
                required
                className="w-full bg-[#0A0A09] border border-white/10 rounded-xl p-3 text-xs text-[#F5F2E8] focus:outline-none focus:border-[#C9A45C]"
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-[10px] uppercase tracking-widest text-[#A8A397] block font-bold">
                  Evidence Claim Title (Optional)
                </label>
                <input
                  type="text"
                  value={evidenceTitle}
                  onChange={(e) => setEvidenceTitle(e.target.value)}
                  placeholder="e.g. Scope Non-Compliance"
                  className="w-full bg-[#0A0A09] border border-white/10 rounded-xl px-4 py-2.5 text-xs text-[#F5F2E8] focus:outline-none focus:border-[#C9A45C]"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-[10px] uppercase tracking-widest text-[#A8A397] block font-bold">
                  Evidence Reference Link (Optional)
                </label>
                <input
                  type="text"
                  value={evidenceRef}
                  onChange={(e) => setEvidenceRef(e.target.value)}
                  placeholder="https://... or ipfs://..."
                  className="w-full bg-[#0A0A09] border border-white/10 rounded-xl px-4 py-2.5 text-xs text-[#F5F2E8] focus:outline-none focus:border-[#C9A45C]"
                />
              </div>
            </div>

            <div className="flex items-center gap-3">
              <button
                type="submit"
                disabled={initiating}
                className="py-2.5 px-5 bg-rose-500 text-white hover:bg-rose-600 text-xs font-bold uppercase tracking-wider rounded-xl transition-colors flex items-center gap-2 disabled:opacity-50"
              >
                {initiating ? <Loader2 className="w-4 h-4 animate-spin" /> : <span>Confirm & Open Dispute</span>}
              </button>
              <button
                type="button"
                onClick={() => setShowInitiateModal(false)}
                className="py-2.5 px-4 bg-white/5 hover:bg-white/10 text-[#A8A397] text-xs font-bold uppercase tracking-wider rounded-xl border border-white/10 transition-colors"
              >
                Cancel
              </button>
            </div>
          </form>
        )}
      </div>
    );
  }

  // Active Dispute Display
  const rec = dispute.recommendation;
  const decision = dispute.reviewDecision;

  return (
    <div className="p-6 md:p-8 rounded-2xl bg-[#151512] border border-[#C9A45C]/30 space-y-6">
      {/* Dispute Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-white/5">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="text-xs font-mono font-bold text-[#C9A45C]">
              Dispute #{dispute.id}
            </span>
            <span className={`text-[10px] uppercase font-bold px-2.5 py-0.5 rounded-full ${
              dispute.status === 'resolved'
                ? 'bg-emerald-500/20 text-emerald-400'
                : 'bg-rose-500/20 text-rose-400'
            }`}>
              {dispute.status}
            </span>
          </div>
          <h3 className="text-base font-bold text-[#F5F2E8]">
            AI-Assisted Escrow Dispute Resolution
          </h3>
        </div>

        <div className="text-xs text-[#A8A397] space-y-1 sm:text-right">
          <div>
            <span>Initiated by: </span>
            <strong className="text-[#F5F2E8] uppercase">{dispute.initiatorRole}</strong>
          </div>
          <span className="text-[11px] block text-[#A8A397]/70">
            {new Date(dispute.createdAt).toLocaleString()}
          </span>
          {dispute.disputeTxHash && (
            <div className="pt-1">
              <a
                href={txExplorerUrl(dispute.disputeTxHash)}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[#C9A45C] hover:underline font-mono text-[11px] inline-flex items-center gap-1"
              >
                <span>Tx: {dispute.disputeTxHash.slice(0, 8)}...{dispute.disputeTxHash.slice(-6)}</span>
                <ExternalLink className="w-3 h-3" />
              </a>
            </div>
          )}
        </div>
      </div>

      {/* Initial Reason */}
      <div className="p-4 rounded-xl bg-[#0A0A09] border border-white/5 space-y-1">
        <span className="text-[10px] uppercase tracking-widest text-[#A8A397] font-bold block">
          Primary Dispute Allegation
        </span>
        <p className="text-xs text-[#F5F2E8] leading-relaxed">
          {dispute.reason}
        </p>
      </div>

      {/* Submitted Evidence List */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-[10px] uppercase tracking-widest text-[#A8A397] font-bold">
            Submitted Evidence Items ({dispute.evidence.length})
          </span>

          {dispute.status !== 'resolved' && (isBuyer || isSeller) && (
            <button
              onClick={() => setShowEvidenceForm(!showEvidenceForm)}
              className="text-xs text-[#C9A45C] hover:underline flex items-center gap-1 font-semibold"
            >
              <Send className="w-3 h-3" />
              <span>{showEvidenceForm ? 'Close Form' : '+ Submit Evidence'}</span>
            </button>
          )}
        </div>

        {/* Evidence Submission Form */}
        {showEvidenceForm && (
          <form onSubmit={handleSubmitEvidence} className="p-4 rounded-xl bg-[#0A0A09] border border-white/10 space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-[10px] uppercase text-[#A8A397] font-bold">Evidence Title *</label>
                <input
                  type="text"
                  value={newEvTitle}
                  onChange={(e) => setNewEvTitle(e.target.value)}
                  placeholder="e.g. Milestone 2 Delivery Verification"
                  required
                  className="w-full bg-[#151512] border border-white/10 rounded-lg px-3 py-2 text-xs text-[#F5F2E8] focus:outline-none focus:border-[#C9A45C]"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[10px] uppercase text-[#A8A397] font-bold">Evidence Category</label>
                <select
                  value={newEvType}
                  onChange={(e) => setNewEvType(e.target.value as any)}
                  className="w-full bg-[#151512] border border-white/10 rounded-lg px-3 py-2 text-xs text-[#F5F2E8] focus:outline-none focus:border-[#C9A45C]"
                >
                  <option value="claim">Claim / Statement</option>
                  <option value="file_url">File / Deliverable URL</option>
                  <option value="milestone_proof">Milestone Completion Proof</option>
                  <option value="contract_log">Smart Contract Event Log</option>
                  <option value="chat_excerpt">Chat Agreement Excerpt</option>
                </select>
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-[10px] uppercase text-[#A8A397] font-bold">Explanation / Details *</label>
              <textarea
                rows={2}
                value={newEvDesc}
                onChange={(e) => setNewEvDesc(e.target.value)}
                placeholder="Explain this evidence and cite specific facts..."
                required
                className="w-full bg-[#151512] border border-white/10 rounded-lg p-2.5 text-xs text-[#F5F2E8] focus:outline-none focus:border-[#C9A45C]"
              />
            </div>

            <div className="space-y-1">
              <label className="text-[10px] uppercase text-[#A8A397] font-bold">Reference Link / CID</label>
              <input
                type="text"
                value={newEvRef}
                onChange={(e) => setNewEvRef(e.target.value)}
                placeholder="https://... or ipfs://..."
                className="w-full bg-[#151512] border border-white/10 rounded-lg px-3 py-2 text-xs text-[#F5F2E8] focus:outline-none focus:border-[#C9A45C]"
              />
            </div>

            <button
              type="submit"
              disabled={submittingEvidence}
              className="py-2 px-4 bg-[#C9A45C] hover:bg-[#E6CC91] text-[#0A0A09] text-xs font-bold uppercase rounded-lg transition-colors flex items-center gap-2 disabled:opacity-50"
            >
              {submittingEvidence ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <span>Record Evidence</span>}
            </button>
          </form>
        )}

        <div className="space-y-2">
          {dispute.evidence.map((ev) => (
            <div key={ev.id} className="p-3.5 rounded-xl bg-[#0A0A09] border border-white/5 text-xs space-y-1.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className={`text-[9px] uppercase font-bold px-2 py-0.5 rounded-full ${
                    ev.partyRole === 'buyer'
                      ? 'bg-blue-500/20 text-blue-400'
                      : ev.partyRole === 'seller'
                      ? 'bg-purple-500/20 text-purple-400'
                      : 'bg-amber-500/20 text-amber-400'
                  }`}>
                    {ev.partyRole}
                  </span>
                  <span className="font-bold text-[#F5F2E8]">{ev.title}</span>
                </div>
                <span className="text-[10px] text-[#A8A397]">
                  {new Date(ev.submittedAt).toLocaleTimeString()}
                </span>
              </div>
              <p className="text-[#A8A397] leading-relaxed">{ev.description}</p>
              {ev.references && ev.references.length > 0 && (
                <div className="flex flex-wrap gap-2 pt-1">
                  {ev.references.map((ref, idx) => (
                    <a
                      key={idx}
                      href={ref}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-[10px] text-[#C9A45C] hover:underline"
                    >
                      <ExternalLink className="w-2.5 h-2.5" />
                      <span>{ref}</span>
                    </a>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* AI Recommendation Section */}
      <div className="pt-4 border-t border-white/5 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-[#C9A45C]" />
            <span className="text-xs font-bold uppercase tracking-wider text-[#F5F2E8]">
              AI Evaluation & Recommendation
            </span>
          </div>

          {!rec && dispute.status !== 'resolved' && (isBuyer || isSeller) && (
            <button
              onClick={handleRunAiEvaluation}
              disabled={evaluating}
              className="px-4 py-2 bg-[#C9A45C] hover:bg-[#E6CC91] text-[#0A0A09] text-xs font-bold uppercase tracking-wider rounded-xl transition-all flex items-center gap-2 disabled:opacity-50 shadow-md"
            >
              {evaluating ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Analyzing Dispute...</span>
                </>
              ) : (
                <>
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>Run AI Evaluation</span>
                </>
              )}
            </button>
          )}
        </div>

        {rec ? (
          <div className="p-5 rounded-xl bg-[#0A0A09] border border-white/10 space-y-4">
            {/* Header info */}
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs pb-3 border-b border-white/5">
              <div className="flex items-center gap-2">
                <span className="text-[10px] uppercase font-mono px-2 py-0.5 rounded bg-white/5 text-[#A8A397]">
                  Policy: {rec.policyVersion}
                </span>
                <span className="text-[10px] uppercase font-mono px-2 py-0.5 rounded bg-[#C9A45C]/10 text-[#C9A45C]">
                  Engine: {rec.engineUsed}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] uppercase font-bold text-[#A8A397]">Confidence:</span>
                <span className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded-full ${
                  rec.confidence.level === 'high'
                    ? 'bg-emerald-500/20 text-emerald-400'
                    : rec.confidence.level === 'medium'
                    ? 'bg-amber-500/20 text-amber-400'
                    : 'bg-rose-500/20 text-rose-400'
                }`}>
                  {rec.confidence.level}
                </span>
              </div>
            </div>

            {/* Summary */}
            <p className="text-xs text-[#F5F2E8] leading-relaxed font-medium">
              {rec.summary}
            </p>

            {/* Recommended Split Visualization */}
            <div className="p-4 rounded-xl bg-[#151512] border border-white/5 space-y-3">
              <span className="text-[10px] uppercase tracking-widest text-[#A8A397] font-bold block">
                Recommended Escrow Fund Split
              </span>

              <div className="grid grid-cols-2 gap-4">
                <div className="p-3 rounded-lg bg-blue-500/10 border border-blue-500/20">
                  <span className="text-[10px] text-blue-400 uppercase font-bold block">Buyer Refund</span>
                  <div className="text-xl font-black text-[#F5F2E8] mt-1">
                    {rec.recommendedDistribution.buyerRefundPercent}%
                  </div>
                  <span className="text-[10px] text-[#A8A397]">0% Platform Fee</span>
                </div>

                <div className="p-3 rounded-lg bg-purple-500/10 border border-purple-500/20">
                  <span className="text-[10px] text-purple-400 uppercase font-bold block">Seller Gross Award</span>
                  <div className="text-xl font-black text-[#F5F2E8] mt-1">
                    {rec.recommendedDistribution.sellerGrossAwardPercent}%
                  </div>
                  <span className="text-[10px] text-[#A8A397]">Subject to 5% Platform Fee</span>
                </div>
              </div>

              <p className="text-[11px] text-[#C9A45C] font-mono leading-relaxed">
                {rec.recommendedDistribution.sellerNetPayoutCalculation}
              </p>
            </div>

            {/* Findings List */}
            {rec.findings.length > 0 && (
              <div className="space-y-2">
                <span className="text-[10px] uppercase tracking-widest text-[#A8A397] font-bold block">
                  Material Findings & Evidence References
                </span>
                <div className="space-y-2">
                  {rec.findings.map((f, i) => (
                    <div key={i} className="p-3 rounded-lg bg-[#151512] border border-white/5 text-xs space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-[#F5F2E8]">{f.claim}</span>
                        <span className={`text-[9px] uppercase font-bold px-2 py-0.5 rounded-full ${
                          f.assessment === 'supported'
                            ? 'bg-emerald-500/20 text-emerald-400'
                            : f.assessment === 'unsupported'
                            ? 'bg-rose-500/20 text-rose-400'
                            : 'bg-amber-500/20 text-amber-400'
                        }`}>
                          {f.assessment}
                        </span>
                      </div>
                      <p className="text-[11px] text-[#A8A397]">{f.explanation}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Escalation requirement notice */}
            {rec.escalation.required && (
              <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-xs text-amber-300 flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                <div>
                  <strong className="block font-bold">Reviewer Escalation Mandated</strong>
                  <p className="text-[11px] text-amber-200/80">{rec.escalation.reason}</p>
                </div>
              </div>
            )}
          </div>
        ) : (
          <p className="text-xs text-[#A8A397] italic">
            AI analysis has not been executed yet. Click &quot;Run AI Evaluation&quot; to review evidence and generate split recommendation.
          </p>
        )}
      </div>

      {/* Reviewer Action / Resolution Record */}
      <div className="pt-4 border-t border-white/5 space-y-4">
        <div className="flex items-center gap-2">
          <Lock className="w-4 h-4 text-[#C9A45C]" />
          <span className="text-xs font-bold uppercase tracking-wider text-[#F5F2E8]">
            Designated Reviewer Settlement Authorization
          </span>
        </div>

        {decision ? (
          <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/30 space-y-2 text-xs">
            <div className="flex items-center justify-between text-emerald-400 font-bold">
              <span>Resolution Decision: {decision.decision.toUpperCase()}</span>
              <span>Settled at {new Date(decision.decidedAt).toLocaleString()}</span>
            </div>
            <p className="text-[#F5F2E8] leading-relaxed">
              Final Split: Buyer <strong>{decision.buyerRefundPercent}%</strong> / Seller <strong>{decision.sellerGrossAwardPercent}%</strong>
            </p>
            <p className="text-[#A8A397]">
              Reviewer Reason: &quot;{decision.reason}&quot;
            </p>
            {decision.settlementTxHash && (
              <div className="pt-2 text-xs flex items-center gap-2">
                <span className="text-[#A8A397]">Settlement On-Chain Tx:</span>
                <a
                  href={txExplorerUrl(decision.settlementTxHash)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[#C9A45C] hover:underline font-mono inline-flex items-center gap-1"
                >
                  <span>{decision.settlementTxHash.slice(0, 10)}...{decision.settlementTxHash.slice(-8)}</span>
                  <ExternalLink className="w-3 h-3" />
                </a>
              </div>
            )}
          </div>
        ) : (
          <div className="p-4 rounded-xl bg-[#0A0A09] border border-white/5 space-y-3">
            <p className="text-xs text-[#A8A397]">
              Neither buyer nor seller can authorize fund settlement. The designated reviewer must approve or revise the recommendation before executing on-chain escrow resolution.
            </p>

            <div className="space-y-3 pt-2">
              <div className="flex items-center gap-4 text-xs">
                <label className="flex items-center gap-2 text-[#F5F2E8]">
                  <input
                    type="radio"
                    name="decisionType"
                    checked={reviewerDecision === 'approved_as_recommended'}
                    onChange={() => setReviewerDecision('approved_as_recommended')}
                    className="accent-[#C9A45C]"
                  />
                  <span>Approve as AI Recommended ({rec?.recommendedDistribution.buyerRefundPercent ?? 50}% / {rec?.recommendedDistribution.sellerGrossAwardPercent ?? 50}%)</span>
                </label>

                <label className="flex items-center gap-2 text-[#F5F2E8]">
                  <input
                    type="radio"
                    name="decisionType"
                    checked={reviewerDecision === 'revised_and_approved'}
                    onChange={() => setReviewerDecision('revised_and_approved')}
                    className="accent-[#C9A45C]"
                  />
                  <span>Revise Split Percentage</span>
                </label>
              </div>

              {reviewerDecision === 'revised_and_approved' && (
                <div className="space-y-1">
                  <label className="text-[10px] uppercase text-[#A8A397] font-bold">
                    Custom Buyer Refund % (0 to 100): {revisedBuyerSplit}% (Seller gets {100 - revisedBuyerSplit}%)
                  </label>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={revisedBuyerSplit}
                    onChange={(e) => setRevisedBuyerSplit(Number(e.target.value))}
                    className="w-full accent-[#C9A45C]"
                  />
                </div>
              )}

              <div className="space-y-1">
                <label className="text-[10px] uppercase text-[#A8A397] font-bold">Reviewer Rationale</label>
                <input
                  type="text"
                  value={reviewerReason}
                  onChange={(e) => setReviewerReason(e.target.value)}
                  placeholder="State reason for resolution approval or revision..."
                  className="w-full bg-[#151512] border border-white/10 rounded-lg px-3 py-2 text-xs text-[#F5F2E8] focus:outline-none focus:border-[#C9A45C]"
                />
              </div>

              <button
                onClick={handleReviewerDecision}
                disabled={reviewing || !currentUserAddress}
                className="py-2.5 px-5 bg-[#C9A45C] hover:bg-[#E6CC91] text-[#0A0A09] text-xs font-bold uppercase tracking-wider rounded-xl transition-all flex items-center gap-2 disabled:opacity-50 shadow-lg"
              >
                {reviewing ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Executing On-Chain Settlement...</span>
                  </>
                ) : (
                  <>
                    <Scale className="w-4 h-4" />
                    <span>Authorize & Execute Settlement</span>
                  </>
                )}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
