'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Shield, Clock, AlertTriangle, EyeOff, Lock, Unlock, Download, ChevronRight, FileSearch } from 'lucide-react';
import RefundForm from '@/components/RefundForm';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useAccount, usePublicClient, useWriteContract, useSignMessage } from 'wagmi';
import { formatEther, parseEther } from 'viem';

import { VEIL_V3_ABI, VEIL_V3_CONTRACT_ADDRESS, VEIL_V4_CONTRACT_ADDRESS } from '@/lib/contract';
import Countdown from '@/components/Countdown';
import { resolveIpfsUri } from '@/lib/ipfs';
import { computeCommitmentHash, generateRandomSecret } from '@/lib/commitment';
import { getBidSecret, saveBidSecret } from '@/lib/secretStorage';
import { bnbChain } from '@/lib/chain';
import { decryptDatasetClientSide, triggerDownload, unpackEncryptedAssetBundle } from '@/lib/client/decryption';
import { datasetDownloadMessage, datasetInspectMessage } from '@/lib/assetAuth';

// ── Types ──────────────────────────────────────────────────────────────────

interface AuctionData {
  id: bigint;
  seller: string;
  itemName: string;
  description: string;
  imageURI: string;
  startingPrice: bigint;
  commitEndTime: bigint;
  revealEndTime: bigint;
  state: number;          // VeilV2 AuctionState
  highestBidder: string;
  highestBid: bigint;
  bidderCount: bigint;
  revealedCount: bigint;
  finalTxHash: string;
  evidenceHash: string;
  inspectionEndTime: bigint;
  reviewReason: string;
}

interface AssetMetadata {
  assetType?: string; deliveryMethod?: string;
  tokenStandard?: string; tokenAddress?: string; tokenId?: string; tokenAmount?: string; licenseType?: string;
}

interface AuctionMetadata {
  name?: string;
  description?: string;
  image?: string;
  dataset?: AssetMetadata;
  asset?: AssetMetadata;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function normalizeAddress(value: unknown): string | null {
  if (typeof value === 'string') {
    return value.toLowerCase();
  }
  return null;
}

function extractCid(uri: string): string | null {
  if (uri.startsWith('ipfs://')) return uri.replace('ipfs://', '');
  if (uri.startsWith('/ipfs/')) return uri.replace('/ipfs/', '');
  return null;
}

async function fetchIpfsJson(uri: string): Promise<AuctionMetadata | null> {
  try {
    if (uri.startsWith('http://') || uri.startsWith('https://') || uri.startsWith('/')) {
      const res = await fetch(uri);
      if (!res.ok) return null;
      return (await res.json()) as AuctionMetadata;
    }
    const cid = extractCid(uri);
    if (!cid) return null;
    const res = await fetch(`/api/ipfs/proxy?cid=${encodeURIComponent(cid)}`);
    if (!res.ok) return null;
    const ct = res.headers.get('content-type') || '';
    if (!ct.includes('json') && !ct.includes('text')) return null;
    return (await res.json()) as AuctionMetadata;
  } catch (e) {
    console.warn('[AuctionDetail] fetchIpfsJson failed:', e);
    return null;
  }
}

/** Parse a contract/wallet error into a readable user-facing message. */
function parseError(err: unknown): string {
  if (!(err instanceof Error)) return 'Transaction failed.';
  const m = err.message;
  if (m.includes('Seller cannot bid') || m.includes('own auction'))
    return 'You cannot bid on your own auction.';
  if (m.includes('Already revealed') || m.includes('already revealed'))
    return 'You have already revealed your bid for this auction.';
  if (m.includes('Reveal phase not active') || m.includes('reveal phase'))
    return 'The reveal phase is not currently active.';
  if (m.includes('Reveal phase not finished'))
    return 'The reveal phase has not finished yet. Wait until the reveal period ends.';
  if (m.includes('Auction already settled') || m.includes('already settled'))
    return 'This auction has already been settled.';
  if (m.includes('No commitment found') || m.includes('no commitment'))
    return 'No committed bid was found for your address.';
  if (m.includes('No pending refund'))
    return 'You have no pending refund for this auction.';
  if (m.includes('rejected') || m.includes('denied') || m.includes('user rejected'))
    return 'Transaction rejected by wallet.';
  if (m.includes('insufficient') || m.includes('Insufficient'))
    return 'Insufficient BNB balance for gas.';
  if (m.includes('reverted on-chain'))
    return 'Transaction was reverted by the contract.';
  return m.length > 200 ? m.substring(0, 200) + '…' : m;
}

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

// ── Component ──────────────────────────────────────────────────────────────

export default function AuctionDetailPage() {
  const params = useParams();
  const publicClient = usePublicClient();
  const { address, isConnected } = useAccount();
  const { writeContractAsync } = useWriteContract();

  const auctionId = params?.id ? String(params.id) : '';

  // ── Auction data ─────────────────────────────────────────────────────
  const [auction, setAuction] = useState<AuctionData | null>(null);
  const [resolvedImageUrl, setResolvedImageUrl] = useState<string>('');
  const [imageError, setImageError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [debugInfo, setDebugInfo] = useState<{
    metadataUri: string; imageUri: string; resolvedUrl: string;
  } | null>(null);
  const [datasetMeta, setDatasetMeta] = useState<AssetMetadata | undefined>(undefined);
  const [nftDeliveryState, setNftDeliveryState] = useState<string>('Checking escrow status...');
  const [inspectionData, setInspectionData] = useState<any>(null);
  const [privateDeliveryInfo, setPrivateDeliveryInfo] = useState<Record<string, string> | undefined>(undefined);

  // ── Pending refund (read after settle or on load when settled) ───────
  const [pendingRefund, setPendingRefund] = useState<bigint | null>(null);
  const [refundLoading, setRefundLoading] = useState(false);

  // ── Commit state ─────────────────────────────────────────────────────
  const [maxBidInput, setMaxBidInput] = useState('');
  const [commitStatus, setCommitStatus] = useState<'idle' | 'confirming' | 'success' | 'error'>('idle');
  const [commitTxHash, setCommitTxHash] = useState<`0x${string}` | null>(null);
  const [commitError, setCommitError] = useState<string | null>(null);
  const [committedMaxBid, setCommittedMaxBid] = useState<string>('');

  // ── Reveal state ─────────────────────────────────────────────────────
  const [revealStatus, setRevealStatus] = useState<'idle' | 'confirming' | 'success' | 'error'>('idle');
  const [revealTxHash, setRevealTxHash] = useState<`0x${string}` | null>(null);
  const [revealError, setRevealError] = useState<string | null>(null);

  // ── Settle state ─────────────────────────────────────────────────────
  const [settleStatus, setSettleStatus] = useState<'idle' | 'confirming' | 'success' | 'error'>('idle');
  const [settleTxHash, setSettleTxHash] = useState<`0x${string}` | null>(null);
  const [settleError, setSettleError] = useState<string | null>(null);

  // ── Withdraw state ───────────────────────────────────────────────────
  const [withdrawStatus, setWithdrawStatus] = useState<'idle' | 'confirming' | 'success' | 'error'>('idle');
  const [withdrawTxHash, setWithdrawTxHash] = useState<`0x${string}` | null>(null);
  const [withdrawError, setWithdrawError] = useState<string | null>(null);

  // ── Unlock / Download state ──────────────────────────────────────────
  const { signMessageAsync } = useSignMessage();
  const [unlockStatus, setUnlockStatus] = useState<'idle' | 'signing' | 'downloading' | 'decrypting' | 'success' | 'error'>('idle');
  const [unlockError, setUnlockError] = useState<string | null>(null);

  // ── Load auction from chain ──────────────────────────────────────────
  const loadAuction = useCallback(async (quiet = false) => {
    if (!publicClient || !auctionId) return;

    try {
      if (!quiet) setLoading(true);
      setError(null);
      setImageError(false);

      const raw = await publicClient.readContract({
        address: VEIL_V3_CONTRACT_ADDRESS,
        abi: VEIL_V3_ABI,
        functionName: 'auctions',
        args: [BigInt(auctionId)],
      });

      let id, seller, itemName, description, imageURI;
      let startingPrice, commitEndTime, revealEndTime;
      let inspectionDuration, inspectionEndTime;
      let state, highestBidder, highestBid;
      let bidderCount, revealedCount, finalTxHash, evidenceHash, reviewReason;

      const values = raw as any[];

      if (values.length === 15) {
        // BlindBid V1 fallback
        [
          id, seller, itemName, description, imageURI,
          startingPrice, commitEndTime, revealEndTime,
          state, highestBidder, highestBid,
          bidderCount, revealedCount, finalTxHash
        ] = values;
        
        inspectionDuration = BigInt(0);
        inspectionEndTime = BigInt(0);
        evidenceHash = '';
        reviewReason = '';
      } else {
        // VeilV3 format
        [
          id, seller, itemName, description, imageURI,
          startingPrice, commitEndTime, revealEndTime,
          inspectionDuration, inspectionEndTime,
          state, highestBidder, highestBid,
          bidderCount, revealedCount, finalTxHash, evidenceHash, reviewReason
        ] = values;
      }

      if (Number(id) === 0) throw new Error('Auction not found on BNB Chain.');

      const data: AuctionData = {
        id, seller, itemName, description, imageURI,
        startingPrice, commitEndTime, revealEndTime,
        inspectionEndTime, state, highestBidder, highestBid,
        bidderCount, revealedCount, finalTxHash, evidenceHash, reviewReason
      };

      console.log('[AuctionDetail] On-chain:', {
        id: id.toString(), state,
        commitEndTime: commitEndTime.toString(),
        revealEndTime: revealEndTime.toString(),
        highestBidder, highestBid: highestBid.toString(),
      });

      setAuction(data);

      // Resolve image
      let metadataUri = imageURI;
      let imageUri = imageURI;
      let resolvedUrl = '';

      const looksLikeMetadata =
        imageURI.endsWith('.json') ||
        imageURI.startsWith('ipfs://') ||
        imageURI.startsWith('/ipfs/');

      if (looksLikeMetadata) {
        const metadata = await fetchIpfsJson(imageURI);
        if (metadata) {
          if (metadata.name) data.itemName = metadata.name;
          if (metadata.description) data.description = metadata.description;
          if (metadata.image) imageUri = metadata.image;
          const asset = metadata.asset || metadata.dataset;
          if (asset) {
            const publicAsset: AssetMetadata = {
              assetType: asset.assetType,
              deliveryMethod: asset.deliveryMethod,
              ...(asset.assetType === 'nft' ? {
                tokenStandard: asset.tokenStandard,
                tokenAddress: asset.tokenAddress,
                tokenId: asset.tokenId,
                tokenAmount: asset.tokenAmount,
              } : {}),
              ...(asset.assetType === 'software-license' ? { licenseType: asset.licenseType } : {}),
            };
            setDatasetMeta(publicAsset);
            if (publicAsset.assetType === 'nft' && VEIL_V4_CONTRACT_ADDRESS) {
              try {
                const nft = await publicClient.readContract({ address: VEIL_V3_CONTRACT_ADDRESS, abi: VEIL_V3_ABI, functionName: 'nftAssets', args: [BigInt(auctionId)] }) as readonly [number, string, bigint, bigint, boolean, boolean];
                setNftDeliveryState(nft[5] ? 'Delivered to the winning bidder' : nft[4] ? 'Held in VEILIO escrow' : 'Not currently held in escrow');
              } catch {
                setNftDeliveryState('Unable to read NFT escrow status');
              }
            }
          }
          setAuction({ ...data });
        }
      }

      resolvedUrl = resolveIpfsUri(imageUri);
      setDebugInfo({ metadataUri, imageUri, resolvedUrl });
      setResolvedImageUrl(resolvedUrl);
    } catch (err) {
      console.error('[AuctionDetail] Load error:', err);
      setError(err instanceof Error ? err.message : 'Failed to load auction from BNB Chain.');
    } finally {
      if (!quiet) setLoading(false);
    }
  }, [publicClient, auctionId]);

  useEffect(() => { loadAuction(); }, [loadAuction]);

  useEffect(() => {
    if (datasetMeta?.assetType !== 'nft') return;
    const timer = setInterval(() => { void loadAuction(true); }, 15_000);
    return () => clearInterval(timer);
  }, [datasetMeta?.assetType, loadAuction]);

  useEffect(() => {
    if (!auctionId) return;
    try {
      let visitorId = localStorage.getItem('veil_viewer_id');
      if (!visitorId) {
        visitorId = crypto.randomUUID();
        localStorage.setItem('veil_viewer_id', visitorId);
      }
      void fetch('/api/analytics/views', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ auctionId, visitorId }),
      });
    } catch (error) { console.warn('Could not record listing view', error); }
  }, [auctionId]);

  // ── Read pending refund from chain ───────────────────────────────────
  const loadPendingRefund = useCallback(async () => {
    if (!publicClient || !address) return;
    try {
      setRefundLoading(true);
      const refund = await publicClient.readContract({
        address: VEIL_V3_CONTRACT_ADDRESS,
        abi: VEIL_V3_ABI,
        functionName: 'pendingRefunds',
        args: [address],
      }) as bigint;
      console.log('[Refund] pendingRefunds for', address, '=', refund.toString(), 'wei');
      setPendingRefund(refund);
    } catch (e) {
      console.warn('[Refund] Failed to read pendingRefunds:', e);
      setPendingRefund(BigInt(0));
    } finally {
      setRefundLoading(false);
    }
  }, [publicClient, address]);

  // Load refund whenever auction is settled and wallet is connected
  useEffect(() => {
    if (auction && isConnected && address) {
      const now = Date.now();
      const revealEndMs = Number(auction.revealEndTime) * 1000;
      const isSettledPhase = auction.state === 3 || now >= revealEndMs;
      if (isSettledPhase) loadPendingRefund();
    }
  }, [auction, isConnected, address, loadPendingRefund]);

  // ── COMMIT handler ───────────────────────────────────────────────────
  async function handleCommit() {
    setCommitError(null);
    if (!isConnected || !address) { setCommitError('Please connect your wallet first.'); return; }
    if (!publicClient) { setCommitError('Blockchain client unavailable.'); return; }
    if (!auction) { setCommitError('Auction data not loaded yet.'); return; }

    const maxBidTrimmed = maxBidInput.trim();
    const maxBidNum = parseFloat(maxBidTrimmed);
    if (!maxBidTrimmed || isNaN(maxBidNum) || maxBidNum <= 0) {
      setCommitError('Please enter a valid bid amount greater than 0.');
      return;
    }

    try {
      setCommitStatus('confirming');
      const secret = generateRandomSecret();
      const maxBidWei = parseEther(maxBidTrimmed);
      const commitment = computeCommitmentHash(auction.id, address, maxBidTrimmed, secret);

      console.log('[CommitBid] auctionId:', auction.id.toString());
      console.log('[CommitBid] bidder:', address);
      console.log('[CommitBid] maxBid:', maxBidTrimmed, 'BNB');
      console.log('[CommitBid] commitment:', commitment);

      // commitBid(uint256 auctionId, bytes32 commitment) payable
      const hash = await writeContractAsync({
        address: VEIL_V3_CONTRACT_ADDRESS,
        abi: VEIL_V3_ABI,
        functionName: 'commitBid',
        args: [auction.id, commitment],
        value: maxBidWei,
      });

      console.log('[CommitBid] Tx submitted:', hash);
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      console.log('[CommitBid] Receipt status:', receipt.status);

      if (receipt.status !== 'success') {
        throw new Error(`Transaction reverted on-chain (tx: ${hash}).`);
      }

      saveBidSecret({ auctionId, bidder: address, maxBid: maxBidTrimmed, secret, commitment, timestamp: Date.now() });
      setCommitTxHash(hash);
      setCommittedMaxBid(maxBidTrimmed);
      setCommitStatus('success');
    } catch (err: unknown) {
      console.error('[CommitBid] Error:', err);
      setCommitError(parseError(err));
      setCommitStatus('error');
    }
  }

  // ── REVEAL handler ───────────────────────────────────────────────────
  async function handleReveal() {
    setRevealError(null);
    if (!isConnected || !address) { setRevealError('Please connect your wallet first.'); return; }
    if (!publicClient) { setRevealError('Blockchain client unavailable.'); return; }
    if (!auction) { setRevealError('Auction data not loaded yet.'); return; }

    const stored = getBidSecret(auctionId, address);
    if (!stored) {
      setRevealError('No committed bid found for this wallet. You must commit before revealing.');
      return;
    }

    const { maxBid: storedMaxBid, secret: storedSecret } = stored;

    console.log('[RevealBid] auctionId:', auctionId);
    console.log('[RevealBid] bidder:', address);
    console.log('[RevealBid] original maxBid:', storedMaxBid, 'BNB');

    try {
      setRevealStatus('confirming');
      const maxBidWei = parseEther(storedMaxBid);

      // revealBid(uint256 auctionId, uint256 maxBid, bytes32 secret) nonpayable
      const hash = await writeContractAsync({
        address: VEIL_V3_CONTRACT_ADDRESS,
        abi: VEIL_V3_ABI,
        functionName: 'revealBid',
        args: [auction.id, maxBidWei, storedSecret],
      });

      console.log('[RevealBid] Tx submitted:', hash);
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      console.log('[RevealBid] Receipt status:', receipt.status);

      if (receipt.status !== 'success') {
        throw new Error(`Transaction reverted on-chain (tx: ${hash}).`);
      }

      saveBidSecret({ ...stored, revealed: true });
      setRevealTxHash(hash);
      setRevealStatus('success');
    } catch (err: unknown) {
      console.error('[RevealBid] Error:', err);
      setRevealError(parseError(err));
      setRevealStatus('error');
    }
  }

  // ── SETTLE handler ───────────────────────────────────────────────────
  async function handleSettle() {
    setSettleError(null);
    if (!isConnected || !address) { setSettleError('Please connect your wallet first.'); return; }
    if (!publicClient) { setSettleError('Blockchain client unavailable.'); return; }
    if (!auction) { setSettleError('Auction data not loaded yet.'); return; }

    console.log('[SettleAuction] auctionId:', auctionId);

    try {
      setSettleStatus('confirming');

      // settleAuction(uint256 auctionId) nonpayable — permissionless
      const hash = await writeContractAsync({
        address: VEIL_V3_CONTRACT_ADDRESS,
        abi: VEIL_V3_ABI,
        functionName: 'settleAuction',
        args: [auction.id],
      });

      console.log('[SettleAuction] Tx submitted:', hash);
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      console.log('[SettleAuction] Receipt status:', receipt.status);

      if (receipt.status !== 'success') {
        throw new Error(`Transaction reverted on-chain (tx: ${hash}).`);
      }

      setSettleTxHash(hash);
      setSettleStatus('success');

      // Re-read auction state from chain — contract is source of truth
      console.log('[SettleAuction] Reloading auction data from chain...');
      await loadAuction();

      // Also read pending refund for the connected wallet
      await loadPendingRefund();
    } catch (err: unknown) {
      console.error('[SettleAuction] Error:', err);
      setSettleError(parseError(err));
      setSettleStatus('error');
    }
  }

  // ── WITHDRAW REFUND handler ──────────────────────────────────────────
  async function handleWithdraw() {
    setWithdrawError(null);
    if (!isConnected || !address) { setWithdrawError('Please connect your wallet first.'); return; }
    if (!publicClient) { setWithdrawError('Blockchain client unavailable.'); return; }

    console.log('[WithdrawRefund] address:', address);

    try {
      setWithdrawStatus('confirming');

      // withdrawRefund() nonpayable — pull-based
      const hash = await writeContractAsync({
        address: VEIL_V3_CONTRACT_ADDRESS,
        abi: VEIL_V3_ABI,
        functionName: 'withdrawRefund',
        args: [],
      });

      console.log('[WithdrawRefund] Tx submitted:', hash);
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      console.log('[WithdrawRefund] Receipt status:', receipt.status);

      if (receipt.status !== 'success') {
        throw new Error(`Transaction reverted on-chain (tx: ${hash}).`);
      }

      setWithdrawTxHash(hash);
      setWithdrawStatus('success');

      // Re-read pending refund — should now be 0
      await loadPendingRefund();
    } catch (err: unknown) {
      console.error('[WithdrawRefund] Error:', err);
      setWithdrawError(parseError(err));
      setWithdrawStatus('error');
    }
  }

  // ── UNLOCK / DOWNLOAD handler ──────────────────────────────────────────
  async function handleUnlockDataset() {
    setUnlockError(null);
    if (!isConnected || !address) { setUnlockError('Please connect your wallet first.'); return; }
    
    try {
      setUnlockStatus('signing');
      const timestamp = Date.now();
      const message = datasetDownloadMessage({ auctionId, address, timestamp });
      
      const signature = await signMessageAsync({ message });
      
      setUnlockStatus('downloading');
      
      const res = await fetch('/api/datasets/download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          auctionId,
          address,
          signature,
          timestamp
        })
      });
      
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Download failed');
      }
      
      setUnlockStatus('decrypting');
      
      // Decrypt client-side
      const bundle = unpackEncryptedAssetBundle(await res.arrayBuffer());
      const blob = await decryptDatasetClientSide(
        bundle.encryptedData,
        bundle.metadata.keyBase64,
        bundle.metadata.ivBase64,
        bundle.metadata.authTagBase64,
        bundle.metadata.fileHashHex,
      );
      
      triggerDownload(blob, bundle.metadata.fileName || 'asset_decrypted');
      setUnlockStatus('success');
      
    } catch (err: unknown) {
      console.error('[UnlockDataset] Error:', err);
      setUnlockError(err instanceof Error ? err.message : 'Failed to unlock dataset');
      setUnlockStatus('error');
    }
  }

  // ── INSPECT DATA handler ───────────────────────────────────────────
  const fetchInspectionData = useCallback(async () => {
    if (!isConnected || !address || !auctionId || !signMessageAsync) return;
    if (datasetMeta?.deliveryMethod === 'nft-transfer') {
      setInspectionData({ format: 'NFT transfer', recordCount: 0, columnCount: 0 });
      return;
    }
    try {
      const timestamp = Date.now();
      const message = datasetInspectMessage({ auctionId, address, timestamp });
      const signature = await signMessageAsync({ message });
      
      const res = await fetch('/api/datasets/inspect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ auctionId, address, signature, timestamp })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setInspectionData(data.manifest);
        setPrivateDeliveryInfo(data.deliveryInfo);
      } else {
        console.error("Inspection error:", data.error);
      }
    } catch (err) {
      console.error("Fetch inspection data failed", err);
    }
  }, [isConnected, address, auctionId, signMessageAsync, datasetMeta]);

  useEffect(() => {
    // We only need inspection data if we're the winner and it's in a state that allows it
    if (auction && address && isConnected && (auction.state === 3 || auction.state === 4 || auction.state === 5 || auction.state === 6)) {
      if (normalizeAddress(auction.highestBidder) === normalizeAddress(address) && !inspectionData) {
        // Uncomment to auto-fetch (but signing prompts automatically might be annoying, so let's trigger it via button or just show what's available)
        // For MVP, we will rely on a manual click if required, or we just rely on datasetMeta if it's public.
        // Wait, the instructions said:
        // "Inspection should only be available while the auction is in Inspection, RefundRequested, UnderReview."
      }
    }
  }, [auction, address, isConnected, inspectionData]);

  const [showRefundForm, setShowRefundForm] = useState(false);

  const handleAcceptDataset = async () => {
    try {
      if (!address || !publicClient) return;
      
      const hash = await writeContractAsync({
        address: VEIL_V3_CONTRACT_ADDRESS,
        abi: VEIL_V3_ABI,
        functionName: 'acceptDataset',
        args: [BigInt(auctionId)],
      });

      await publicClient.waitForTransactionReceipt({ hash });
      await loadAuction();
      await loadPendingRefund();
    } catch (err: any) {
      console.error(err);
      alert('Failed to accept dataset: ' + (err.shortMessage || err.message));
    }
  };

  const handleRequestRefund = async (evidenceHash: string) => {
    try {
      if (!address || !publicClient) return;
      
      const hash = await writeContractAsync({
        address: VEIL_V3_CONTRACT_ADDRESS,
        abi: VEIL_V3_ABI,
        functionName: 'requestRefund',
        args: [BigInt(auctionId), evidenceHash],
      });

      await publicClient.waitForTransactionReceipt({ hash });
      await loadAuction();
      await loadPendingRefund();
      setShowRefundForm(false);
    } catch (err: any) {
      console.error(err);
      throw new Error('Failed to submit refund request on-chain: ' + (err.shortMessage || err.message));
    }
  };

  // ── Loading / error guards ───────────────────────────────────────────
  if (loading) {
    return (
      <div className="min-h-screen bg-[#0A0A09] flex items-center justify-center">
        <p className="text-[#A8A397]">Loading auction from BNB Chain...</p>
      </div>
    );
  }

  if (error || !auction) {
    return (
      <div className="min-h-screen bg-[#0A0A09] px-6 pt-32">
        <div className="max-w-3xl mx-auto rounded-2xl border border-white/10 bg-[#151512] p-12 text-center">
          <h1 className="text-2xl font-bold text-[#F5F2E8]">Auction not found</h1>
          <p className="mt-4 text-[#A8A397]">{error || 'This auction does not exist on BNB Chain.'}</p>
          <Link href="/auctions" className="inline-block mt-8 text-[#C9A45C] font-semibold">← Back to auctions</Link>
        </div>
      </div>
    );
  }

  // ── Phase calculations (from real on-chain timestamps + state) ───────
  const now = Date.now();
  const commitEndMs = Number(auction.commitEndTime) * 1000;
  const revealEndMs = Number(auction.revealEndTime) * 1000;

  const isCommitOpen = now < commitEndMs;
  const isRevealOpen = now >= commitEndMs && now < revealEndMs;

  // VeilV2 States: Created=0, Bidding=1, Revealing=2, Inspection=3, RefundRequested=4, UnderReview=5, Completed=6, Refunded=7, Cancelled=8
  const isInspectionOnChain = auction.state === 3;
  const isRefundRequestedOnChain = auction.state === 4;
  const isUnderReviewOnChain = auction.state === 5;
  const isCompletedOnChain = auction.state === 6;
  const isRefundedOnChain = auction.state === 7;
  const isCancelledOnChain = auction.state === 8;
  const isSettledOrLater = auction.state >= 3;

  const canSettle = auction.state === 0 && !isCommitOpen && !isRevealOpen && now >= revealEndMs;

  const phaseLabel = isRefundedOnChain ? 'Refunded'
    : isCompletedOnChain ? 'Completed'
    : isUnderReviewOnChain ? 'Under Review'
    : isRefundRequestedOnChain ? 'Refund Requested'
    : isInspectionOnChain ? 'Inspection Phase'
    : isRevealOpen ? 'Revealing'
    : isCommitOpen ? 'Bidding'
    : 'Awaiting Settlement';

  // Stored secret / reveal status for connected wallet
  const storedSecret = isConnected && address ? getBidSecret(auctionId, address) : null;
  const hasCommitted = storedSecret !== null;
  const alreadyRevealed = storedSecret?.revealed === true;

  // Winner detection — straight from chain data, never from local state
  const hasWinner = !!auction?.highestBidder && auction.highestBidder !== '0x0000000000000000000000000000000000000000';
  const isSeller = isConnected && !!address && normalizeAddress(auction?.seller) === normalizeAddress(address);
  
  const normalizedWinner = normalizeAddress(auction?.highestBidder);
  const normalizedAddress = normalizeAddress(address);

  const isWinner =
    !!normalizedWinner &&
    !!normalizedAddress &&
    normalizedWinner === normalizedAddress;

  // First-Price winning price: highestBid
  const winningPrice = auction.highestBid;

  return (
    <div className="min-h-screen bg-[#0A0A09] pt-12 pb-24">
      <div className="max-w-7xl mx-auto px-6">

        {/* BACK */}
        <Link
          href="/auctions"
          className="inline-block mb-10 text-sm uppercase tracking-wider text-[#A8A397] hover:text-[#C9A45C] transition-colors"
        >
          ← Back to auctions
        </Link>


        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12">

          {/* IMAGE */}
          <div className="relative aspect-[4/3] overflow-hidden rounded-2xl bg-[#151512] border border-white/10">
            {resolvedImageUrl && !imageError ? (
              <img
                src={resolvedImageUrl}
                alt={auction.itemName}
                className="absolute inset-0 w-full h-full object-cover"
                onError={() => { console.warn('[AuctionDetail] Image failed:', resolvedImageUrl); setImageError(true); }}
              />
            ) : (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
                <span className="text-[#A8A397] text-sm">Image unavailable</span>
                <span className="text-[#A8A397] text-xs opacity-60">{imageError ? 'Could not load from IPFS' : 'No image URI'}</span>
              </div>
            )}
            <div className="absolute top-5 left-5">
              <span className="px-4 py-2 rounded-lg bg-[#0A0A09]/85 border border-white/10 text-[#C9A45C] text-xs font-bold uppercase tracking-wider">
                {phaseLabel}
              </span>
            </div>
          </div>

          {/* DETAILS */}
          <div>
            <div className="mb-2">
              <span className="text-[#A8A397] text-[10px] uppercase font-bold tracking-widest">DIGITAL ASSET · {datasetMeta?.assetType || 'DATASET'}</span>
            </div>
            <h1 className="text-4xl lg:text-5xl font-extrabold tracking-tight text-[#F5F2E8]">
              {auction.itemName}
            </h1>
            <p className="mt-5 text-lg leading-8 text-[#A8A397]">{auction.description}</p>
            
            {datasetMeta && (
              <div className="mt-6 p-5 rounded-2xl border border-white/10 bg-[#0A0A09] space-y-4">
                {datasetMeta.deliveryMethod !== 'nft-transfer' && <div className="flex items-center gap-3 flex-wrap">
                  <span className="px-3 py-1 rounded bg-white/[0.04] border border-white/10 text-[#F5F2E8] text-[10px] font-bold uppercase tracking-widest">
                    ✓ FILE VERIFIED
                  </span>
                  <span className="px-3 py-1 rounded bg-white/[0.04] border border-white/10 text-[#F5F2E8] text-[10px] font-bold uppercase tracking-widest">
                    ✓ HASH RECORDED
                  </span>
                  <span className="px-3 py-1 rounded bg-[#C9A45C]/10 border border-[#C9A45C]/30 text-[#C9A45C] text-[10px] font-bold uppercase tracking-widest flex items-center gap-2">
                    <span>🔒 ENCRYPTED</span>
                  </span>
                </div>}
                <div className="text-xs text-[#A8A397] space-y-4 font-mono pt-2">
                  <div>
                    <div className="text-[#F5F2E8] font-bold mb-1">File:</div>
                    <div className="text-[#A8A397] truncate">{datasetMeta.deliveryMethod === 'nft-transfer' ? 'Digital token asset' : 'Encrypted product file · details shown during inspection'}</div>
                  </div>
                  <div>
                    <div className="text-[#F5F2E8] font-bold mb-1">Size:</div>
                    <div className="text-[#A8A397]">{datasetMeta.deliveryMethod === 'nft-transfer' ? 'On-chain asset' : 'File details hidden until inspection'}</div>
                  </div>
                  {datasetMeta.tokenAddress && <div><div className="text-[#F5F2E8] font-bold mb-1">NFT delivery:</div><div>{datasetMeta.tokenStandard} · Token #{datasetMeta.tokenId}{datasetMeta.tokenStandard === 'ERC-1155' ? ` · Amount ${datasetMeta.tokenAmount || '1'}` : ''}</div><div className="break-all">{datasetMeta.tokenAddress}</div><div className="mt-2 text-[#C9A45C]">On-chain status: {nftDeliveryState}</div></div>}
                  {datasetMeta.licenseType && <div><div className="text-[#F5F2E8] font-bold mb-1">License:</div><div>{datasetMeta.licenseType}</div></div>}
                  {privateDeliveryInfo?.accessInstructions && <div><div className="text-[#F5F2E8] font-bold mb-1">Private delivery instructions:</div><div className="whitespace-pre-wrap">{privateDeliveryInfo.accessInstructions}</div></div>}
                </div>
              </div>
            )}

            {/* STATS */}
            <div className="mt-8 grid grid-cols-3 rounded-2xl border border-white/10 bg-[#151512] overflow-hidden">
              <div className="p-5 border-r border-white/10">
                <span className="block text-xs uppercase tracking-wider text-[#A8A397]">Starting At</span>
                <span className="block mt-2 text-xl font-bold text-[#F5F2E8]">{formatEther(auction.startingPrice)} BNB</span>
              </div>
              <div className="p-5 border-r border-white/10">
                <span className="block text-xs uppercase tracking-wider text-[#A8A397]">Bidders</span>
                <span className="block mt-2 text-xl font-bold text-[#F5F2E8]">{Number(auction.bidderCount)}</span>
              </div>
              <div className="p-5">
                <span className="block text-xs uppercase tracking-wider text-[#A8A397]">
                  {isSettledOrLater ? 'Revealed' : isRevealOpen ? 'Reveal ends' : isCommitOpen ? 'Commit ends' : 'Phase'}
                </span>
                <span className="block mt-2 text-lg font-bold text-[#F5F2E8]">
                  {isSettledOrLater
                    ? `${Number(auction.revealedCount)} / ${Number(auction.bidderCount)}`
                    : isRevealOpen
                    ? <Countdown endTime={revealEndMs} />
                    : isCommitOpen
                    ? <Countdown endTime={commitEndMs} />
                    : 'Ended'}
                </span>
              </div>
            </div>

            {/* ══════════════════════════════════════════════════════
                ACTION PANEL — switches by phase
                ══════════════════════════════════════════════════════ */}
            <div className="mt-8 rounded-2xl border border-white/10 bg-[#151512] p-7">

              {/* ── COMMIT PHASE ─────────────────────────────── */}
              {isCommitOpen && (
                <>
                  <h2 className="text-lg font-bold text-[#F5F2E8]">Your Maximum Bid</h2>

                  {commitStatus === 'success' && commitTxHash ? (
                    <div className="mt-4 space-y-4">
                      <div className="flex items-center gap-3 p-4 rounded-xl bg-[#C9A45C]/10 border border-[#C9A45C]/30">
                        <div className="w-8 h-8 rounded-full bg-[#C9A45C] text-[#0A0A09] flex items-center justify-center font-bold text-sm flex-shrink-0">✓</div>
                        <div>
                          <p className="text-sm font-bold text-[#F5F2E8]">Bid locked</p>
                          <p className="text-xs text-[#A8A397]">Committed on BNB Chain</p>
                        </div>
                      </div>
                      <div className="p-4 rounded-xl bg-[#0A0A09] border border-white/10 space-y-2 text-xs">
                        <div className="flex justify-between">
                          <span className="text-[#A8A397]">Your maximum</span>
                          <span className="font-bold text-[#F5F2E8]">{committedMaxBid} BNB</span>
                        </div>
                        <div className="flex justify-between gap-4">
                          <span className="text-[#A8A397] flex-shrink-0">Tx hash</span>
                          <span className="font-mono text-[#C9A45C] truncate">{commitTxHash}</span>
                        </div>
                      </div>
                      <a href={`${bnbChain.blockExplorers.default.url}/tx/${commitTxHash}`} target="_blank" rel="noreferrer"
                        className="block text-center text-xs font-semibold text-[#C9A45C] hover:underline">
                        View transaction on BohrScan ↗
                      </a>
                      <p className="text-center text-xs text-[#A8A397]">Secret saved locally. Return here to reveal after commit phase ends.</p>
                    </div>
                  ) : (
                    <>
                      <p className="mt-2 text-sm leading-6 text-[#A8A397]">
                        Your maximum bid stays hidden from other bidders until the reveal phase.
                      </p>
                      <input
                        id="max-bid-input"
                        type="number" min="0" step="0.01"
                        placeholder="Enter maximum bid (BOT)"
                        value={maxBidInput}
                        onChange={(e) => { setMaxBidInput(e.target.value); setCommitError(null); if (commitStatus === 'error') setCommitStatus('idle'); }}
                        disabled={commitStatus === 'confirming'}
                        className="mt-6 w-full rounded-xl border border-white/10 bg-[#0A0A09] px-5 py-4 text-[#F5F2E8] outline-none focus:border-[#C9A45C]/60 disabled:opacity-50"
                      />
                      {commitError && (
                        <div className="mt-3 p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-xs text-rose-400">{commitError}</div>
                      )}
                      <button
                        id="commit-bid-button"
                        onClick={handleCommit}
                        disabled={commitStatus === 'confirming'}
                        className="mt-4 w-full rounded-xl bg-[#C9A45C] px-5 py-4 font-bold text-[#0A0A09] hover:bg-[#E6CC91] active:scale-[0.98] transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {commitStatus === 'confirming' ? 'CONFIRMING…' : 'COMMIT MAXIMUM BID'}
                      </button>
                      {!isConnected && <p className="mt-3 text-center text-xs text-[#A8A397]">Connect your wallet to place a bid.</p>}
                      {isConnected && commitStatus === 'idle' && (
                        <p className="mt-3 text-center text-xs text-[#A8A397]">Your bid amount will be locked as a deposit on BNB Chain.</p>
                      )}
                    </>
                  )}
                </>
              )}

              {/* ── REVEAL PHASE ─────────────────────────────── */}
              {isRevealOpen && (
                <>
                  <h2 className="text-lg font-bold text-[#F5F2E8]">Reveal Your Bid</h2>

                  {revealStatus === 'success' && revealTxHash ? (
                    <div className="mt-4 space-y-4">
                      <div className="flex items-center gap-3 p-4 rounded-xl bg-[#C9A45C]/10 border border-[#C9A45C]/30">
                        <div className="w-8 h-8 rounded-full bg-[#C9A45C] text-[#0A0A09] flex items-center justify-center font-bold text-sm flex-shrink-0">✓</div>
                        <div>
                          <p className="text-sm font-bold text-[#F5F2E8]">Bid revealed</p>
                          <p className="text-xs text-[#A8A397]">Your maximum bid was revealed on-chain.</p>
                        </div>
                      </div>
                      <div className="p-4 rounded-xl bg-[#0A0A09] border border-white/10 space-y-2 text-xs">
                        <div className="flex justify-between">
                          <span className="text-[#A8A397]">Revealed maximum</span>
                          <span className="font-bold text-[#F5F2E8]">{storedSecret?.maxBid ?? '—'} BNB</span>
                        </div>
                        <div className="flex justify-between gap-4">
                          <span className="text-[#A8A397] flex-shrink-0">Tx hash</span>
                          <span className="font-mono text-[#C9A45C] truncate">{revealTxHash}</span>
                        </div>
                      </div>
                      <a href={`${bnbChain.blockExplorers.default.url}/tx/${revealTxHash}`} target="_blank" rel="noreferrer"
                        className="block text-center text-xs font-semibold text-[#C9A45C] hover:underline">
                        View transaction on BohrScan ↗
                      </a>
                    </div>
                  ) : alreadyRevealed ? (
                    <div className="mt-4 p-4 rounded-xl bg-[#C9A45C]/5 border border-[#C9A45C]/20">
                      <p className="text-sm text-[#F5F2E8] font-semibold">You have already revealed your bid.</p>
                      <p className="mt-1 text-xs text-[#A8A397]">Your maximum bid of {storedSecret?.maxBid} BNB was submitted on-chain.</p>
                    </div>
                  ) : hasCommitted ? (
                    <>
                      <p className="mt-2 text-sm leading-6 text-[#A8A397]">
                        The commit phase has ended. Reveal your sealed bid using your original committed amount.
                      </p>
                      <div className="mt-4 p-4 rounded-xl bg-[#0A0A09] border border-white/10 text-xs">
                        <div className="flex justify-between">
                          <span className="text-[#A8A397]">Your committed maximum</span>
                          <span className="font-bold text-[#F5F2E8]">{storedSecret?.maxBid} BNB</span>
                        </div>
                        <p className="mt-2 text-[#A8A397] opacity-70">The reveal will use your original committed values — you cannot change them.</p>
                      </div>
                      {revealError && (
                        <div className="mt-3 p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-xs text-rose-400">{revealError}</div>
                      )}
                      <button
                        id="reveal-bid-button"
                        onClick={handleReveal}
                        disabled={revealStatus === 'confirming'}
                        className="mt-4 w-full rounded-xl bg-[#C9A45C] px-5 py-4 font-bold text-[#0A0A09] hover:bg-[#E6CC91] active:scale-[0.98] transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {revealStatus === 'confirming' ? 'CONFIRMING…' : 'REVEAL YOUR BID'}
                      </button>
                    </>
                  ) : (
                    <div className="mt-4 p-4 rounded-xl bg-white/[0.03] border border-white/10">
                      <p className="text-sm text-[#A8A397]">You did not commit a bid during the commit phase. Reveal is only available to committed bidders.</p>
                    </div>
                  )}
                </>
              )}

              {/* ── AWAITING SETTLEMENT (reveal ended, not yet settled) ── */}
              {canSettle && (
                <>
                  <h2 className="text-lg font-bold text-[#F5F2E8]">Settle Auction</h2>
                  <p className="mt-2 text-sm leading-6 text-[#A8A397]">
                    The reveal phase has ended. Anyone can settle the auction — the contract will determine the winner and distribute refunds.
                  </p>

                  {settleError && (
                    <div className="mt-3 p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-xs text-rose-400">{settleError}</div>
                  )}

                  {settleStatus !== 'success' && (
                    <>
                      <button
                        id="settle-auction-button"
                        onClick={handleSettle}
                        disabled={settleStatus === 'confirming' || !isConnected}
                        className="mt-4 w-full rounded-xl bg-[#C9A45C] px-5 py-4 font-bold text-[#0A0A09] hover:bg-[#E6CC91] active:scale-[0.98] transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {settleStatus === 'confirming' ? 'CONFIRMING…' : 'SETTLE AUCTION'}
                      </button>
                      {!isConnected && <p className="mt-3 text-center text-xs text-[#A8A397]">Connect your wallet to settle.</p>}
                    </>
                  )}

                  {settleStatus === 'success' && settleTxHash && (
                    <div className="mt-4 space-y-3">
                      <div className="flex items-center gap-3 p-4 rounded-xl bg-[#C9A45C]/10 border border-[#C9A45C]/30">
                        <div className="w-8 h-8 rounded-full bg-[#C9A45C] text-[#0A0A09] flex items-center justify-center font-bold text-sm flex-shrink-0">✓</div>
                        <div>
                          <p className="text-sm font-bold text-[#F5F2E8]">Auction settled</p>
                          <p className="text-xs text-[#A8A397]">Winner and refunds determined on-chain.</p>
                        </div>
                      </div>
                      <a href={`${bnbChain.blockExplorers.default.url}/tx/${settleTxHash}`} target="_blank" rel="noreferrer"
                        className="block text-center text-xs font-semibold text-[#C9A45C] hover:underline">
                        View settlement transaction on BohrScan ↗
                      </a>
                    </div>
                  )}
                </>
              )}

              {/* ── SETTLED / INSPECTION / COMPLETED ON-CHAIN ─────────────────────────── */}
              {isSettledOrLater && (
                <>
                  <h2 className="text-lg font-bold text-[#F5F2E8]">Auction Result</h2>

                  {hasWinner ? (
                    <div className="mt-4 space-y-3">
                      {/* Winner banner — shown to the winner only */}
                      {isWinner && (
                        <div className="flex flex-col gap-3 p-5 rounded-xl bg-[#C9A45C]/10 border border-[#C9A45C]/30 shadow-[0_0_20px_rgba(201,164,92,0.15)]">
                          <div className="flex items-center gap-3">
                            <span className="text-2xl">🏆</span>
                            <div>
                              <p className="text-sm font-bold text-[#E6CC91] uppercase tracking-wider">You won this {datasetMeta?.assetType || 'digital asset'}</p>
                              <p className="text-xs text-[#A8A397]">
                                {isCompletedOnChain 
                                ? (datasetMeta?.deliveryMethod === 'nft-transfer' ? 'Payment is settled. Coordinate the NFT transfer with the seller using the token details above.' : 'Your access is unlocked. You can now download the full asset.') 
                                  : 'Your access has been unlocked for inspection. Review the dataset before finalizing.'}
                              </p>
                            </div>
                          </div>
                          
                          {isCompletedOnChain && datasetMeta?.deliveryMethod !== 'nft-transfer' && (
                            <div className="mt-4 pt-4 border-t border-[#C9A45C]/20">
                              {unlockError && (
                                <div className="mb-3 p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-xs text-rose-400">{unlockError}</div>
                              )}
                              <button
                                onClick={handleUnlockDataset}
                                disabled={unlockStatus === 'signing' || unlockStatus === 'downloading' || unlockStatus === 'decrypting'}
                                className="w-full py-4 text-xs font-bold uppercase tracking-wider rounded-xl bg-[#C9A45C] text-[#0A0A09] hover:bg-[#E6CC91] transition-colors disabled:opacity-50"
                              >
                                {unlockStatus === 'signing' ? 'SIGN IN WALLET...' :
                                 unlockStatus === 'downloading' ? 'DOWNLOADING ENCRYPTED DATA...' :
                                 unlockStatus === 'decrypting' ? 'DECRYPTING LOCALLY...' :
                                 unlockStatus === 'success' ? 'DOWNLOAD AGAIN' :
                                 'DOWNLOAD FULL DATASET'}
                              </button>
                              <div className="mt-3 flex justify-between text-[10px] uppercase font-mono tracking-widest text-[#A8A397]">
                                <span>Encryption: AES-256-GCM</span>
                                <span>Access: WINNER ONLY</span>
                              </div>
                            </div>
                          )}

                          {(isInspectionOnChain || isRefundRequestedOnChain || isUnderReviewOnChain) && (
                            <div className="mt-6 pt-6 border-t border-[#C9A45C]/20">
                              <h3 className="text-[10px] font-bold text-[#A8A397] uppercase tracking-widest mb-4">ASSET INSPECTION</h3>
                              
                              {!inspectionData ? (
                                <button onClick={fetchInspectionData} className="w-full py-3 text-xs font-bold uppercase tracking-wider border-b border-white/10 text-[#C9A45C] hover:text-[#E6CC91] text-left transition-colors">
                                  View Dataset Inspection (Requires Signature) →
                                </button>
                              ) : (
                                <div className="text-sm font-mono text-[#A8A397]">
                                  <div className="text-[#F5F2E8] mb-4">
                                    {datasetMeta?.assetType || 'Digital asset'}
                                  </div>
                                  {privateDeliveryInfo?.accessInstructions && <div className="mb-4 p-4 border border-[#C9A45C]/20 bg-[#C9A45C]/5"><div className="text-[#E6CC91] text-[10px] uppercase tracking-widest mb-2">Private delivery instructions</div><div className="whitespace-pre-wrap">{privateDeliveryInfo.accessInstructions}</div></div>}
                                  <hr className="border-white/10 mb-4" />
                                  
                                  {datasetMeta?.assetType === 'dataset' && <div className="mb-4">
                                    <div className="text-[#F5F2E8] mb-2 tracking-widest uppercase text-[10px]">VERIFIED</div>
                                    <div>{inspectionData.format} · {inspectionData.recordCount} records · {inspectionData.columnCount} columns</div>
                                    <div>Duplicates: {(inspectionData.duplicateRate * 100).toFixed(2)}%</div>
                                  </div>}

                                  <hr className="border-white/10 my-4" />

                                  {inspectionData.schema && inspectionData.schema.length > 0 && (
                                    <div className="mb-4">
                                      <div className="text-[#F5F2E8] mb-2 tracking-widest uppercase text-[10px]">SCHEMA</div>
                                      <div className="space-y-1">
                                        {inspectionData.schema.map((s: any, idx: number) => (
                                          <div key={idx} className="flex justify-between">
                                            <span className="text-[#F5F2E8]">{s.name}</span>
                                            <span>{s.type}</span>
                                          </div>
                                        ))}
                                      </div>
                                    </div>
                                  )}
                                  <hr className="border-white/10 my-4" />

                                  {inspectionData.sample && inspectionData.sample.length > 0 && (
                                    <div className="mb-4">
                                      <div className="text-[#F5F2E8] mb-4 tracking-widest uppercase text-[10px]">LIMITED INSPECTION SAMPLE</div>
                                      <div className="overflow-x-auto">
                                        <table className="w-full text-left border-collapse whitespace-nowrap text-xs">
                                          <thead>
                                            <tr>
                                              {inspectionData.columns.map((c: string) => (
                                                <th key={c} className="pr-6 pb-3 text-[#F5F2E8] font-normal border-b border-white/10">{c}</th>
                                              ))}
                                            </tr>
                                          </thead>
                                          <tbody>
                                            {inspectionData.sample.map((row: any, i: number) => (
                                              <tr key={i} className="group hover:bg-white/[0.02]">
                                                {inspectionData.columns.map((c: string) => (
                                                  <td key={c} className="pr-6 py-2 border-b border-white/5">{String(row[c])}</td>
                                                ))}
                                              </tr>
                                            ))}
                                          </tbody>
                                        </table>
                                      </div>
                                    </div>
                                  )}
                                </div>
                              )}

                              {isInspectionOnChain && (
                                <>
                                  <p className="text-xs text-[#A8A397] mt-6 mb-4">
                                    {datasetMeta?.assetType === 'nft' ? 'The NFT is held by VEILIO during inspection. Delivery and payment finalize automatically when inspection expires; report a mismatch here to request a refund.' : 'Does this dataset match the listing? If not, you can report a mismatch.'}
                                  </p>

                              {showRefundForm ? (
                                <RefundForm 
                                  auctionId={auctionId} 
                                  listingCriteria={inspectionData || {}}
                                  onSubmit={async (hash) => {
                                    await handleRequestRefund(hash);
                                  }}
                                  onCancel={() => setShowRefundForm(false)} 
                                />
                              ) : (
                                <div className="flex gap-4">
                                  {datasetMeta?.assetType !== 'nft' && <button onClick={handleAcceptDataset} className="flex-1 py-3 text-xs font-bold uppercase tracking-wider rounded-xl bg-[#C9A45C] text-[#0A0A09] hover:bg-[#E6CC91] transition-colors">
                                    {datasetMeta?.assetType === 'dataset' || !datasetMeta?.assetType ? 'Accept Dataset' : 'Confirm Delivery'}
                                  </button>}
                                  <button onClick={() => setShowRefundForm(true)} className="flex-1 py-3 text-xs font-bold uppercase tracking-wider rounded-xl bg-transparent border border-[#A8A397]/30 text-[#A8A397] hover:text-[#F5F2E8] hover:border-[#F5F2E8]/50 transition-colors">
                                    Report Mismatch
                                  </button>
                                </div>
                              )}
                              </>
                            )}
                            </div>
                          )}

                          {isRefundedOnChain && (
                            <div className="mt-4 pt-4 border-t border-[#C9A45C]/20">
                              <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/30">
                                <h4 className="text-sm font-bold text-emerald-400 uppercase tracking-wider">Refund Approved</h4>
                                <p className="text-xs text-[#A8A397] mt-1">Your refund request was approved by the reviewer. You can withdraw your refund below.</p>
                              </div>
                            </div>
                          )}

                          {isCompletedOnChain && auction.reviewReason && (
                            <div className="mt-4 pt-4 border-t border-[#C9A45C]/20">
                              <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/30">
                                <h4 className="text-sm font-bold text-rose-400 uppercase tracking-wider">Refund Rejected</h4>
                                <p className="text-xs text-[#A8A397] mt-1">Your refund request was rejected by the reviewer.</p>
                                <div className="mt-3 p-3 bg-[#0A0A09] border border-white/10 rounded-lg">
                                  <span className="text-[10px] text-[#A8A397] uppercase tracking-widest block mb-1">Reason:</span>
                                  <p className="text-sm text-[#F5F2E8]">{auction.reviewReason}</p>
                                </div>
                              </div>
                            </div>
                          )}
                        </div>
                      )}

                      {/* On-chain result — all values from the contract */}
                      <div className="p-4 rounded-xl bg-[#0A0A09] border border-white/10 space-y-3 text-xs">
                        <div className="flex justify-between gap-4">
                          <span className="text-[#A8A397]">Winner</span>
                          <span className="font-mono text-[#F5F2E8] truncate max-w-[220px]">{auction.highestBidder}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-[#A8A397]">Price paid</span>
                          <span className="font-bold text-[#F5F2E8]">{formatEther(winningPrice)} BNB</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-[#A8A397]">Bidders revealed</span>
                          <span className="text-[#F5F2E8]">{Number(auction.revealedCount)} / {Number(auction.bidderCount)}</span>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="mt-4 p-4 rounded-xl bg-white/[0.03] border border-white/10">
                      <p className="text-sm text-[#A8A397]">
                        No valid bids were revealed above the starting price. The auction ended with no winner.
                        Any deposited BNB has been refunded (minus a 5% anti-abort penalty for unrevealed bids).
                      </p>
                    </div>
                  )}

                  {/* ROLE-BASED SETTLEMENT PANEL */}
                  {isConnected && address && pendingRefund !== null && (
                    <>
                      {/* SELLER PROCEEDS */}
                      {isSeller && (isCompletedOnChain || isCancelledOnChain) && (pendingRefund > BigInt(0) || withdrawStatus === 'success') && (
                        <div className="mt-4 rounded-xl border border-white/10 bg-[#0A0A09] p-4">
                          <p className="text-xs font-semibold uppercase tracking-wider text-[#A8A397] mb-3">Seller Proceeds</p>
                          {withdrawStatus === 'success' && withdrawTxHash ? (
                            <div className="space-y-2">
                              <div className="flex items-center gap-2 text-emerald-400 text-xs font-semibold">
                                <span>✓</span>
                                <span>Earnings withdrawn successfully</span>
                              </div>
                              <a href={`${bnbChain.blockExplorers.default.url}/tx/${withdrawTxHash}`} target="_blank" rel="noreferrer"
                                className="block text-xs font-semibold text-emerald-400 hover:underline">
                                View on BohrScan ↗
                              </a>
                            </div>
                          ) : (
                            <>
                              <div className="flex items-center justify-between mb-3">
                                <span className="text-xs text-[#A8A397]">Your Earnings</span>
                                <span className="font-bold text-[#F5F2E8]">{formatEther(pendingRefund!)} BNB</span>
                              </div>
                              <div className="flex items-center justify-between mb-4">
                                <span className="text-xs text-[#A8A397]">Platform fee</span>
                                <span className="text-xs text-[#A8A397]">{formatEther((winningPrice * BigInt(10)) / BigInt(100))} BNB</span>
                              </div>
                              {withdrawError && (
                                <div className="mb-3 p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-xs text-rose-400">{withdrawError}</div>
                              )}
                              <button
                                id="withdraw-earnings-button"
                                onClick={handleWithdraw}
                                disabled={withdrawStatus === 'confirming'}
                                className="w-full rounded-xl bg-white/[0.03] border border-white/10 px-5 py-3 text-sm font-bold text-[#F5F2E8] hover:bg-white/[0.05] active:scale-[0.98] transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
                              >
                                {withdrawStatus === 'confirming' ? 'CONFIRMING…' : 'WITHDRAW EARNINGS'}
                              </button>
                            </>
                          )}
                        </div>
                      )}

                      {/* WINNER REFUNDS (EXCESS DEPOSIT OR APPROVED DISPUTE) */}
                      {isWinner && !isCompletedOnChain && (pendingRefund > BigInt(0) || withdrawStatus === 'success') && (
                        <div className="mt-4 rounded-xl border border-white/10 bg-[#0A0A09] p-4">
                          <p className="text-xs font-semibold uppercase tracking-wider text-[#A8A397] mb-3">
                            {isRefundedOnChain ? 'Approved Dispute Refund' : 'Excess Deposit Refund'}
                          </p>
                          {withdrawStatus === 'success' && withdrawTxHash ? (
                            <div className="space-y-2">
                              <div className="flex items-center gap-2 text-[#C9A45C] text-xs font-semibold">
                                <span>✓</span>
                                <span>Refund withdrawn successfully</span>
                              </div>
                              <a href={`${bnbChain.blockExplorers.default.url}/tx/${withdrawTxHash}`} target="_blank" rel="noreferrer"
                                className="block text-xs font-semibold text-[#C9A45C] hover:underline">
                                View on BohrScan ↗
                              </a>
                            </div>
                          ) : (
                            <>
                              <div className="flex items-center justify-between mb-3">
                                <span className="text-xs text-[#A8A397]">Refund available</span>
                                <span className="font-bold text-[#C9A45C]">{formatEther(pendingRefund!)} BNB</span>
                              </div>
                              {withdrawError && (
                                <div className="mb-3 p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-xs text-rose-400">{withdrawError}</div>
                              )}
                              <button
                                id="withdraw-refund-button"
                                onClick={handleWithdraw}
                                disabled={withdrawStatus === 'confirming'}
                                className="w-full rounded-xl border border-[#C9A45C]/40 text-[#C9A45C] px-5 py-3 text-sm font-bold hover:bg-[#C9A45C]/10 active:scale-[0.98] transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
                              >
                                {withdrawStatus === 'confirming' ? 'CONFIRMING…' : 'WITHDRAW REFUND'}
                              </button>
                            </>
                          )}
                        </div>
                      )}

                      {/* LOSING BIDDER REFUNDS */}
                      {!isSeller && !isWinner && hasCommitted && isSettledOrLater && (pendingRefund > BigInt(0) || withdrawStatus === 'success') && (
                        <div className="mt-4 rounded-xl border border-white/10 bg-[#0A0A09] p-4">
                          <p className="text-xs font-semibold uppercase tracking-wider text-[#A8A397] mb-3">Your Refund (Losing Bid)</p>
                          {withdrawStatus === 'success' && withdrawTxHash ? (
                            <div className="space-y-2">
                              <div className="flex items-center gap-2 text-[#C9A45C] text-xs font-semibold">
                                <span>✓</span>
                                <span>Refund withdrawn successfully</span>
                              </div>
                              <a href={`${bnbChain.blockExplorers.default.url}/tx/${withdrawTxHash}`} target="_blank" rel="noreferrer"
                                className="block text-xs font-semibold text-[#C9A45C] hover:underline">
                                View on BohrScan ↗
                              </a>
                            </div>
                          ) : (
                            <>
                              <div className="flex items-center justify-between mb-3">
                                <span className="text-xs text-[#A8A397]">Refund available</span>
                                <span className="font-bold text-[#C9A45C]">{formatEther(pendingRefund!)} BNB</span>
                              </div>
                              {withdrawError && (
                                <div className="mb-3 p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-xs text-rose-400">{withdrawError}</div>
                              )}
                              <button
                                id="withdraw-losing-bid-button"
                                onClick={handleWithdraw}
                                disabled={withdrawStatus === 'confirming'}
                                className="w-full rounded-xl border border-[#C9A45C]/40 text-[#C9A45C] px-5 py-3 text-sm font-bold hover:bg-[#C9A45C]/10 active:scale-[0.98] transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
                              >
                                {withdrawStatus === 'confirming' ? 'CONFIRMING…' : 'WITHDRAW REFUND'}
                              </button>
                            </>
                          )}
                        </div>
                      )}
                    </>
                  )}
                </>
              )}
            </div>

            {/* VERIFICATION */}
            <div className="mt-6 rounded-2xl border border-white/10 p-6">
              <h3 className="text-sm font-bold uppercase tracking-wider text-[#F5F2E8]">Technical Verification</h3>
              <div className="mt-4 space-y-4 text-xs">
                <div className="flex justify-between gap-6">
                  <span className="text-[#A8A397]">Auction ID</span>
                  <span className="font-mono text-[#F5F2E8]">#{auction.id.toString()}</span>
                </div>
                <div className="flex justify-between gap-6">
                  <span className="text-[#A8A397]">Phase</span>
                  <span className="font-mono text-[#C9A45C]">{phaseLabel}</span>
                </div>
                <div className="flex justify-between gap-6">
                  <span className="text-[#A8A397]">On-chain state</span>
                  <span className="font-mono text-[#F5F2E8]">{auction.state}</span>
                </div>
                <div className="flex justify-between gap-6">
                  <span className="text-[#A8A397]">Seller</span>
                  <span className="font-mono text-[#F5F2E8] truncate max-w-[280px]">{auction.seller}</span>
                </div>
                <div className="flex justify-between gap-6">
                  <span className="text-[#A8A397]">Contract</span>
                  <span className="font-mono text-[#F5F2E8] truncate max-w-[280px]">{VEIL_V3_CONTRACT_ADDRESS}</span>
                </div>
              </div>
            </div>

          </div>
        </div>
      </div>
    </div>
  );
}
