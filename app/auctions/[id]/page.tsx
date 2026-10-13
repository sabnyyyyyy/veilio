'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Shield, Clock, AlertTriangle, EyeOff, Lock, Unlock, Download, ChevronRight, FileSearch } from 'lucide-react';
import RefundForm from '@/components/RefundForm';
import AiValidatorPanel from '@/components/transaction/AiValidatorPanel';
import TransactionChat from '@/components/transaction/TransactionChat';
import DeliveryReviewPanel from '@/components/transaction/DeliveryReviewPanel';
import DisputeModal from '@/components/transaction/DisputeModal';
import type { GeminiValidationOutput } from '@/lib/server/gemini';
import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import { useAccount, usePublicClient, useWriteContract, useSignMessage, useChainId, useSwitchChain } from 'wagmi';
import { formatEther, parseEther } from 'viem';

import { getAuctionContractConfig } from '@/lib/contract';
import Countdown from '@/components/Countdown';
import { resolveIpfsUri } from '@/lib/ipfs';
import { computeCommitmentHash, generateRandomSecret } from '@/lib/commitment';
import {
  confirmBidSecret,
  discardPendingBidSecret,
  exportBidSecrets,
  findBidSecretForCommitment,
  getBidSecret,
  saveBidSecret,
  savePendingBidSecret,
  type StoredSecret,
} from '@/lib/secretStorage';
import { baseSepoliaChain, bnbChain } from '@/lib/chain';
import { decryptDatasetClientSide, triggerDownload, unpackEncryptedAssetBundle } from '@/lib/client/decryption';
import {
  auctionPlatformFeeBps,
  datasetDownloadMessageFor,
  datasetInspectMessageFor,
  datasetPreviewMessageFor,
  noWinnerRefundText,
  sameWallet,
  type AuctionNetworkId,
} from '@/lib/auctionNetwork';
import { buildAuctionAuth, connectSolanaWallet, sendSolanaAuctionInstructions, signForNetwork } from '@/lib/client/auctionWallet';
import {
  computeSealedBidCommitment,
  createAcceptDatasetInstruction,
  createClaimRefundInstruction,
  createCommitBidInstruction,
  createFinalizeInspectionTimeoutInstruction,
  createFinalizeRefundTimeoutInstruction,
  createRequestRefundInstruction,
  createRevealBidInstruction,
  createSettleAuctionInstruction,
  findAuctionPda,
  getSolanaAuctionProgramId,
} from '@/lib/cross-chain/solanaAuction';
import {
  fetchSolanaAuctionStateById,
  fetchSolanaBidCommitment,
  formatSolLamports,
  SOLANA_DEFAULT_PUBKEY,
} from '@/lib/solanaAuctions';
import type { DecodedBidCommitment } from '@/lib/cross-chain/solanaAuction';

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
  /** Solana only: per-auction reviewer and refund request time (unix seconds). */
  reviewer?: string;
  refundRequestedAt?: bigint;
}

/** Solana program: reviewer has 7 days to decide before the winner can reclaim escrow. */
const SOLANA_REFUND_REVIEW_TIMEOUT_SECONDS = 7 * 24 * 60 * 60;

/** True when the wallet definitely did not send the transaction (user rejected the prompt). */
function isUserRejection(err: unknown): boolean {
  let current: any = err;
  for (let depth = 0; current && depth < 6; depth++) {
    if (current.name === 'UserRejectedRequestError' || current.code === 4001 || current.code === 'ACTION_REJECTED') return true;
    const message = typeof current.message === 'string' ? current.message : '';
    if (/user rejected|user denied|rejected the request|request rejected/i.test(message)) return true;
    current = current.cause;
  }
  return false;
}

function bytes32FromHex(value: string): Buffer {
  const hex = value.startsWith('0x') ? value.slice(2) : value;
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) throw new Error('Evidence hash must be a 32-byte hex value.');
  return Buffer.from(hex, 'hex');
}

interface AssetMetadata {
  assetType?: string; deliveryMethod?: string;
  tokenStandard?: string; tokenAddress?: string; tokenId?: string; tokenAmount?: string; licenseType?: string;
  samplePreview?: { columns: string[]; rows: Array<Record<string, string>> };
  fileName?: string;
  size?: number;
  manifest?: { format?: string; recordCount?: number; columnCount?: number; columns?: string[] };
  professionalMetadata?: {
    licenseType?: string;
    usageRights?: string;
    format?: string;
    region?: string;
    language?: string;
    dataPeriod?: string;
    updateFrequency?: string;
    schemaOrSpecification?: string;
    [key: string]: unknown;
  };
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

function normalizeSamplePreview(value: unknown): AssetMetadata['samplePreview'] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const preview = value as Record<string, unknown>;
  if (!Array.isArray(preview.columns) || !Array.isArray(preview.rows)) return undefined;
  const columns = preview.columns.filter((column): column is string => typeof column === 'string' && column.length > 0).slice(0, 50);
  if (!columns.length || new Set(columns).size !== columns.length) return undefined;
  const rows = preview.rows.slice(0, 10).filter((row) => typeof row === 'object' && row !== null && !Array.isArray(row)).map((row) =>
    Object.fromEntries(columns.map((column) => {
      const cell = (row as Record<string, unknown>)[column];
      return [column, typeof cell === 'string' || typeof cell === 'number' || typeof cell === 'boolean' ? String(cell).slice(0, 200) : ''];
    }))
  );
  return rows.length ? { columns, rows } : undefined;
}

/** Parse a contract/wallet error into a readable user-facing message. */
function parseError(err: unknown, action = 'transaction', chainName = 'BNB Chain Testnet', symbol = 'BNB'): string {
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
    return `Insufficient ${symbol} balance for gas.`;
  if (m.toLowerCase().includes('requested resource not available') || m.toLowerCase().includes('resource unavailable'))
    return `The wallet or ${chainName} RPC could not prepare the ${action} transaction. It may not have been submitted. Check that your wallet is on ${chainName}, then retry shortly.`;
  if (m.includes('reverted on-chain'))
    return 'Transaction was reverted by the contract.';
  return m.length > 200 ? m.substring(0, 200) + '…' : m;
}

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

// ── Component ──────────────────────────────────────────────────────────────

export default function AuctionDetailPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const networkParam = searchParams?.get('network');
  const isSolana = networkParam === 'solana' || networkParam === 'solana:devnet';
  const isBase = networkParam === 'base';
  const targetChainId = isBase ? baseSepoliaChain.id : bnbChain.id;
  const publicClient = usePublicClient({ chainId: targetChainId });
  const auctionContract = getAuctionContractConfig(targetChainId);
  const walletChainId = useChainId();
  const { switchChain } = useSwitchChain();
  const currencySymbol = isSolana ? 'SOL' : isBase ? 'ETH' : 'BNB';
  const explorerBase = isSolana
    ? 'https://explorer.solana.com'
    : isBase
    ? baseSepoliaChain.blockExplorers.default.url
    : bnbChain.blockExplorers.default.url;
  const explorerName = isSolana ? 'Solana Explorer' : isBase ? 'BaseScan' : 'BscScan';
  const networkName = isSolana ? 'Solana Devnet' : isBase ? 'Base Sepolia' : 'BNB Chain Testnet';
  const networkId: AuctionNetworkId = isSolana ? 'solana:devnet' : isBase ? 'base:84532' : 'bnb:97';
  const { address, isConnected } = useAccount();
  const { writeContractAsync } = useWriteContract();

  // ── Solana wallet (Phantom-style injected provider) ──────────────────
  const [solanaWallet, setSolanaWallet] = useState<string | null>(null);
  const [solanaCommitment, setSolanaCommitment] = useState<DecodedBidCommitment | null>(null);
  const [solanaCommitmentLoaded, setSolanaCommitmentLoaded] = useState(false);
  useEffect(() => {
    if (!isSolana || typeof window === 'undefined') return;
    const provider = (window as any).solana;
    const existing = provider?.publicKey?.toString?.();
    if (existing) { setSolanaWallet(existing); return; }
    provider?.connect?.({ onlyIfTrusted: true })
      .then((resp: any) => { const key = resp?.publicKey?.toString?.(); if (key) setSolanaWallet(key); })
      .catch(() => {});
  }, [isSolana]);
  const ensureSolanaWallet = useCallback(async () => {
    const key = await connectSolanaWallet();
    setSolanaWallet(key);
    return key;
  }, []);
  /** The wallet that acts on this auction: Solana wallet on Solana, wagmi account on EVM. */
  const viewerAddress = isSolana ? solanaWallet : (address ?? null);
  const viewerConnected = isSolana ? !!solanaWallet : isConnected && !!address;
  const formatAmount = (value: bigint) => (isSolana ? formatSolLamports(value) : formatEther(value));

  const auctionId = params?.id ? String(params.id) : '';
  const secretStorageAuctionId = isSolana ? `solana:devnet:${auctionId}` : targetChainId === bnbChain.id ? auctionId : `${targetChainId}:${auctionId}`;

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
  const [previewPublishing, setPreviewPublishing] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [nftDeliveryState, setNftDeliveryState] = useState<string>('Checking escrow status...');
  const [inspectionData, setInspectionData] = useState<any>(null);
  const [privateDeliveryInfo, setPrivateDeliveryInfo] = useState<Record<string, string> | undefined>(undefined);

  // ── Pending refund (read after settle or on load when settled) ───────
  const [pendingRefund, setPendingRefund] = useState<bigint | null>(null);
  const [refundLoading, setRefundLoading] = useState(false);

  // ── Commit state ─────────────────────────────────────────────────────
  const [maxBidInput, setMaxBidInput] = useState('');
  const [depositInput, setDepositInput] = useState('');
  const [commitStatus, setCommitStatus] = useState<'idle' | 'confirming' | 'success' | 'error'>('idle');
  const [commitTxHash, setCommitTxHash] = useState<string | null>(null);
  const [commitError, setCommitError] = useState<string | null>(null);
  const [committedMaxBid, setCommittedMaxBid] = useState<string>('');
  const [committedDeposit, setCommittedDeposit] = useState<string>('');

  // ── Reveal state ─────────────────────────────────────────────────────
  const [revealStatus, setRevealStatus] = useState<'idle' | 'confirming' | 'success' | 'error'>('idle');
  const [revealTxHash, setRevealTxHash] = useState<string | null>(null);
  const [revealError, setRevealError] = useState<string | null>(null);

  // ── Settle state ─────────────────────────────────────────────────────
  const [settleStatus, setSettleStatus] = useState<'idle' | 'confirming' | 'success' | 'error'>('idle');
  const [settleTxHash, setSettleTxHash] = useState<string | null>(null);
  const [settleError, setSettleError] = useState<string | null>(null);

  // ── Withdraw state ───────────────────────────────────────────────────
  const [withdrawStatus, setWithdrawStatus] = useState<'idle' | 'confirming' | 'success' | 'error'>('idle');
  const [withdrawTxHash, setWithdrawTxHash] = useState<string | null>(null);
  const [withdrawError, setWithdrawError] = useState<string | null>(null);

  // ── Unlock / Download state ──────────────────────────────────────────
  const { signMessageAsync } = useSignMessage();
  const [unlockStatus, setUnlockStatus] = useState<'idle' | 'signing' | 'downloading' | 'decrypting' | 'success' | 'error'>('idle');
  const [unlockError, setUnlockError] = useState<string | null>(null);

  // ── Load auction from chain ──────────────────────────────────────────
  const loadAuction = useCallback(async (quiet = false) => {
    if (!auctionId) return;
    if (!isSolana && !publicClient) return;

    try {
      if (!quiet) setLoading(true);
      setError(null);
      setImageError(false);

      let data: AuctionData;
      let imageURI: string;

      if (isSolana) {
        const decoded = await fetchSolanaAuctionStateById(auctionId);
        if (!decoded) {
          throw new Error(`Auction #${auctionId} not found on Solana Devnet.`);
        }
        // Normalize to the EVM numbering used below: Created/Bidding/Revealing => 0 (active).
        const rawState = Number(decoded.state);
        data = {
          id: decoded.auctionId,
          seller: decoded.seller,
          itemName: decoded.itemName,
          description: decoded.description,
          imageURI: decoded.imageUri,
          startingPrice: decoded.startingPrice,
          commitEndTime: BigInt(decoded.commitEndTime),
          revealEndTime: BigInt(decoded.revealEndTime),
          inspectionEndTime: BigInt(decoded.inspectionEndTime),
          state: rawState <= 2 ? 0 : rawState,
          highestBidder: decoded.highestBidder === SOLANA_DEFAULT_PUBKEY ? '' : decoded.highestBidder,
          highestBid: decoded.highestBid,
          bidderCount: BigInt(decoded.bidderCount),
          revealedCount: BigInt(decoded.revealedCount),
          finalTxHash: '',
          evidenceHash: decoded.evidenceHash,
          reviewReason: decoded.reviewReason,
          reviewer: decoded.reviewer,
          refundRequestedAt: BigInt(decoded.refundRequestedAt),
        };
        imageURI = decoded.imageUri;
      } else {
        if (!publicClient) return;

        const raw = await publicClient.readContract({
          address: auctionContract.address,
          abi: auctionContract.abi,
          functionName: 'auctions',
          args: [BigInt(auctionId)],
        });

        let id, seller, itemName, description, rawImageURI;
        let startingPrice, commitEndTime, revealEndTime;
        let inspectionDuration, inspectionEndTime;
        let state, highestBidder, highestBid;
        let bidderCount, revealedCount, finalTxHash, evidenceHash, reviewReason;

        const values = raw as any[];

        if (values.length === 15) {
          // BlindBid V1 fallback
          [
            id, seller, itemName, description, rawImageURI,
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
            id, seller, itemName, description, rawImageURI,
            startingPrice, commitEndTime, revealEndTime,
            inspectionDuration, inspectionEndTime,
            state, highestBidder, highestBid,
            bidderCount, revealedCount, finalTxHash, evidenceHash, reviewReason
          ] = values;
        }

        if (Number(id) === 0) throw new Error(`Auction not found on ${targetChainId === baseSepoliaChain.id ? 'Base Sepolia' : 'BNB Chain'}.`);

        data = {
          id, seller, itemName, description, imageURI: rawImageURI,
          startingPrice, commitEndTime, revealEndTime,
          inspectionEndTime, state, highestBidder, highestBid,
          bidderCount, revealedCount, finalTxHash, evidenceHash, reviewReason
        };
        imageURI = rawImageURI;

        console.log('[AuctionDetail] On-chain:', {
          id: id.toString(), state,
          commitEndTime: commitEndTime.toString(),
          revealEndTime: revealEndTime.toString(),
          highestBidder, highestBid: highestBid.toString(),
        });
      }

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
              ...(asset.assetType === 'dataset' ? { samplePreview: normalizeSamplePreview(asset.samplePreview) } : {}),
            };
            setDatasetMeta(publicAsset);
            if (!isSolana && publicClient && publicAsset.assetType === 'nft' && auctionContract.address) {
              try {
                const nft = await publicClient.readContract({ address: auctionContract.address, abi: auctionContract.abi, functionName: 'nftAssets', args: [BigInt(auctionId)] }) as readonly [number, string, bigint, bigint, boolean, boolean];
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
      setError(err instanceof Error ? err.message : `Failed to load auction from ${targetChainId === baseSepoliaChain.id ? 'Base Sepolia' : 'BNB Chain'}.`);
    } finally {
      if (!quiet) setLoading(false);
    }
  }, [publicClient, auctionId, auctionContract.address, auctionContract.abi, targetChainId, isSolana]);

  useEffect(() => { loadAuction(); }, [loadAuction]);

  // ── Solana: the viewer's bid commitment PDA (null once refunded/paid out) ──
  const loadSolanaCommitment = useCallback(async () => {
    if (!isSolana || !solanaWallet || !auctionId) return;
    try {
      setSolanaCommitment(await fetchSolanaBidCommitment(auctionId, solanaWallet));
    } catch (e) {
      console.warn('[Solana] Failed to read bid commitment:', e);
      setSolanaCommitment(null);
    } finally {
      setSolanaCommitmentLoaded(true);
    }
  }, [isSolana, solanaWallet, auctionId]);

  useEffect(() => { void loadSolanaCommitment(); }, [loadSolanaCommitment, auction?.state]);

  useEffect(() => {
    if (!auctionId || datasetMeta?.assetType !== 'dataset' || datasetMeta.samplePreview) return;
    let cancelled = false;
    void fetch(`/api/datasets/preview?auctionId=${encodeURIComponent(auctionId)}&network=${encodeURIComponent(networkId)}`, { cache: 'no-store' })
      .then(async (response) => response.ok ? response.json() : null)
      .then((data) => {
        const preview = normalizeSamplePreview(data?.preview);
        if (!cancelled && preview) setDatasetMeta((current) => current ? { ...current, samplePreview: preview } : current);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [auctionId, datasetMeta?.assetType, datasetMeta?.samplePreview, networkId]);

  async function handlePublishPreview() {
    setPreviewPublishing(true);
    setPreviewError(null);
    try {
      const signer = isSolana ? await ensureSolanaWallet() : address;
      if (!signer || (!isSolana && !isConnected)) throw new Error('Connect the seller wallet first.');
      const timestamp = Date.now();
      const message = datasetPreviewMessageFor(networkId, { auctionId, address: signer, timestamp });
      const signature = await signForNetwork(networkId, message, signMessageAsync);
      const response = await fetch('/api/datasets/preview', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ auctionId, address: signer, signature, timestamp, network: networkId }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not publish the preview.');
      const preview = normalizeSamplePreview(data.preview);
      if (!preview) throw new Error('No valid sample rows were returned.');
      setDatasetMeta((current) => current ? { ...current, samplePreview: preview } : current);
    } catch (error) {
      setPreviewError(error instanceof Error ? error.message : 'Could not publish the preview.');
    } finally {
      setPreviewPublishing(false);
    }
  }

  useEffect(() => {
    if (datasetMeta?.assetType !== 'nft') return;
    const timer = setInterval(() => { void loadAuction(true); }, 15_000);
    return () => clearInterval(timer);
  }, [datasetMeta?.assetType, loadAuction]);

  useEffect(() => {
    if (!auctionId || targetChainId !== bnbChain.id) return;
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
  }, [auctionId, targetChainId]);

  // ── Read pending refund from chain ───────────────────────────────────
  const loadPendingRefund = useCallback(async () => {
    // Solana has no pull-payment ledger; refunds are claimed per commitment PDA.
    if (isSolana || !publicClient || !address) return;
    try {
      setRefundLoading(true);
      const refund = await publicClient.readContract({
        address: auctionContract.address,
        abi: auctionContract.abi,
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
  }, [isSolana, publicClient, address, auctionContract.address, auctionContract.abi]);

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
    if (!auction) { setCommitError('Auction data not loaded yet.'); return; }

    const maxBidTrimmed = maxBidInput.trim();
    const depositTrimmed = depositInput.trim();
    if (!maxBidTrimmed || !depositTrimmed) {
      setCommitError('Enter both your maximum bid and the public deposit amount.');
      return;
    }

    if (isSolana) {
      let pendingSecret: StoredSecret | null = null;
      try {
        setCommitStatus('confirming');
        const bidderPubkey = await ensureSolanaWallet();

        const maxBidLamports = BigInt(Math.round(parseFloat(maxBidTrimmed) * 1e9));
        const depositLamports = BigInt(Math.round(parseFloat(depositTrimmed) * 1e9));
        if (maxBidLamports <= 0n) throw new Error('Maximum bid must be greater than zero.');
        if (maxBidLamports < auction.startingPrice) throw new Error(`Maximum bid must be at least ${formatSolLamports(auction.startingPrice)} SOL.`);
        if (depositLamports < maxBidLamports) throw new Error('Public deposit must be equal to or greater than your maximum bid.');

        const salt = new Uint8Array(32);
        window.crypto.getRandomValues(salt);

        const programId = getSolanaAuctionProgramId();
        const { pda: auctionPda } = findAuctionPda(auction.id, programId);
        const commitment = computeSealedBidCommitment({
          auctionPubkey: auctionPda,
          bidderPubkey,
          maxBidLamports,
          salt,
        });

        // Persist the salt BEFORE sending; savePendingBidSecret throws if storage fails.
        const candidate: StoredSecret = {
          auctionId: secretStorageAuctionId,
          bidder: bidderPubkey,
          maxBid: maxBidTrimmed,
          secret: (`0x${Buffer.from(salt).toString('hex')}` as `0x${string}`),
          commitment: (`0x${commitment.toString('hex')}` as `0x${string}`),
          timestamp: Date.now(),
          networkId: 'solana:devnet',
        };
        savePendingBidSecret(candidate);
        pendingSecret = candidate;

        const inst = createCommitBidInstruction({
          auctionId: auction.id,
          bidder: bidderPubkey,
          commitment,
          depositLamports,
          programId,
        });
        const signature = await sendSolanaAuctionInstructions([inst], bidderPubkey, 'Solana bid commitment');
        confirmBidSecret(secretStorageAuctionId, bidderPubkey, signature);

        setCommitTxHash(signature);
        setCommittedMaxBid(maxBidTrimmed);
        setCommittedDeposit(depositTrimmed);
        setCommitStatus('success');
        void loadAuction(true);
        void loadSolanaCommitment();
      } catch (err: any) {
        console.error('Solana commit error:', err);
        if (pendingSecret && isUserRejection(err)) {
          discardPendingBidSecret(pendingSecret.auctionId, pendingSecret.bidder, pendingSecret.commitment);
        }
        setCommitError(
          pendingSecret && !isUserRejection(err)
            ? `${err?.message || 'Failed to submit commitment on Solana Devnet.'} Your bid secret was kept locally in case the transaction landed; download a backup before retrying.`
            : err?.message || 'Failed to submit commitment on Solana Devnet.'
        );
        setCommitStatus('error');
      }
      return;
    }

    if (!isConnected || !address) { setCommitError('Please connect your wallet first.'); return; }
    if (!publicClient) { setCommitError('Blockchain client unavailable.'); return; }

    if (walletChainId !== targetChainId) {
      if (switchChain) {
        try {
          await switchChain({ chainId: targetChainId });
        } catch {
          setCommitError(`Please switch your wallet to ${networkName} before bidding.`);
          return;
        }
      } else {
        setCommitError(`Please switch your wallet to ${networkName} before bidding.`);
        return;
      }
    }

    let pendingSecret: StoredSecret | null = null;
    let submittedHash: `0x${string}` | null = null;
    try {
      setCommitStatus('confirming');
      const secret = generateRandomSecret();
      const maxBidWei = parseEther(maxBidTrimmed);
      const depositWei = parseEther(depositTrimmed);
      if (maxBidWei <= 0n) throw new Error('Maximum bid must be greater than zero.');
      if (maxBidWei < auction.startingPrice) throw new Error(`Maximum bid must be at least ${formatEther(auction.startingPrice)} ${currencySymbol}.`);
      if (depositWei < maxBidWei) throw new Error('Public deposit must be equal to or greater than your maximum bid.');
      const commitment = computeCommitmentHash(auction.id, address, maxBidTrimmed, secret);

      console.log('[CommitBid] auctionId:', auction.id.toString());
      console.log('[CommitBid] bidder:', address);
      console.log('[CommitBid] maxBid:', maxBidTrimmed, currencySymbol, '; public deposit:', depositTrimmed, currencySymbol);
      console.log('[CommitBid] commitment:', commitment);

      // Persist the secret BEFORE the wallet prompt: if the tx lands but the
      // receipt never arrives (RPC timeout, closed tab) the bid can still be revealed.
      const candidate: StoredSecret = {
        auctionId: secretStorageAuctionId,
        bidder: address,
        maxBid: maxBidTrimmed,
        secret,
        commitment,
        timestamp: Date.now(),
        networkId,
        chainId: targetChainId,
      };
      savePendingBidSecret(candidate);
      pendingSecret = candidate;

      // commitBid(uint256 auctionId, bytes32 commitment) payable
      const hash = await writeContractAsync({
        chainId: targetChainId,
        address: auctionContract.address,
        abi: auctionContract.abi,
        functionName: 'commitBid',
        args: [auction.id, commitment],
        value: depositWei,
      });
      submittedHash = hash;
      saveBidSecret({ ...pendingSecret, status: 'pending', txHash: hash });

      console.log('[CommitBid] Tx submitted:', hash);
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      console.log('[CommitBid] Receipt status:', receipt.status);

      if (receipt.status !== 'success') {
        // A mined-but-reverted commit stored nothing on-chain: safe to drop the secret.
        discardPendingBidSecret(pendingSecret.auctionId, pendingSecret.bidder, pendingSecret.commitment);
        pendingSecret = null;
        throw new Error(`Transaction reverted on-chain (tx: ${hash}).`);
      }

      confirmBidSecret(secretStorageAuctionId, address, hash);
      setCommitTxHash(hash);
      setCommittedMaxBid(maxBidTrimmed);
      setCommittedDeposit(depositTrimmed);
      setCommitStatus('success');
    } catch (err: unknown) {
      console.error('[CommitBid] Error:', err);
      const rejected = !submittedHash && isUserRejection(err);
      if (pendingSecret && rejected) {
        discardPendingBidSecret(pendingSecret.auctionId, pendingSecret.bidder, pendingSecret.commitment);
      }
      const base = parseError(err, 'bid commitment', networkName, currencySymbol);
      setCommitError(
        pendingSecret && !rejected
          ? `${base} Your bid secret was kept locally in case the transaction was mined${submittedHash ? ` (tx: ${submittedHash})` : ''}; download a backup before retrying.`
          : base
      );
      setCommitStatus('error');
    }
  }

  function handleDownloadSecretBackup() {
    try {
      const json = exportBidSecrets(viewerAddress || undefined);
      const blob = new Blob([json], { type: 'application/json' });
      triggerDownload(blob, `veilio-bid-secrets-${Date.now()}.json`);
    } catch (err) {
      console.error('[SecretBackup] Export failed:', err);
    }
  }

  // ── REVEAL handler ───────────────────────────────────────────────────
  async function handleReveal() {
    setRevealError(null);
    if (!auction) { setRevealError('Auction data not loaded yet.'); return; }

    if (isSolana) {
      try {
        setRevealStatus('confirming');
        const bidderPubkey = await ensureSolanaWallet();

        // Use the stored salt whose commitment matches the on-chain commitment PDA.
        const onchain = await fetchSolanaBidCommitment(auction.id, bidderPubkey);
        if (!onchain) throw new Error('No on-chain bid commitment was found for this Solana wallet.');
        const stored = findBidSecretForCommitment(secretStorageAuctionId, bidderPubkey, onchain.commitment);
        if (!stored) {
          throw new Error('No saved bid secret matches your on-chain commitment for this auction and Solana wallet. Import your bid secret backup and retry.');
        }

        const saltHex = stored.secret.startsWith('0x') ? stored.secret.slice(2) : stored.secret;
        const salt = Buffer.from(saltHex, 'hex');
        const maxBidLamports = BigInt(Math.round(parseFloat(stored.maxBid) * 1e9));

        const programId = getSolanaAuctionProgramId();
        const inst = createRevealBidInstruction({
          auctionId: auction.id,
          bidder: bidderPubkey,
          maxBidLamports,
          salt,
          programId,
        });
        const signature = await sendSolanaAuctionInstructions([inst], bidderPubkey, 'Solana bid reveal');

        saveBidSecret({ ...stored, auctionId: secretStorageAuctionId, status: 'confirmed', revealed: true });
        setRevealTxHash(signature);
        setRevealStatus('success');
        void loadAuction(true);
        void loadSolanaCommitment();
      } catch (err: any) {
        console.error('Solana reveal error:', err);
        setRevealError(err?.message || 'Failed to reveal bid on Solana Devnet.');
        setRevealStatus('error');
      }
      return;
    }

    if (!isConnected || !address) { setRevealError('Please connect your wallet first.'); return; }
    if (!publicClient) { setRevealError('Blockchain client unavailable.'); return; }

    if (walletChainId !== targetChainId) {
      if (switchChain) {
        try {
          await switchChain({ chainId: targetChainId });
        } catch {
          setRevealError(`Please switch your wallet to ${networkName} before revealing.`);
          return;
        }
      } else {
        setRevealError(`Please switch your wallet to ${networkName} before revealing.`);
        return;
      }
    }

    let stored = getBidSecret(secretStorageAuctionId, address);
    try {
      // Pick the locally stored secret that matches the on-chain commitment
      // (handles retries where an older pending secret is the one that landed).
      const onchain = await publicClient.readContract({
        address: auctionContract.address,
        abi: auctionContract.abi,
        functionName: 'commitments',
        args: [auction.id, address],
      }) as readonly [`0x${string}`, bigint, boolean, bigint];
      const matched = findBidSecretForCommitment(secretStorageAuctionId, address, onchain[0]);
      if (matched) stored = matched;
    } catch (e) {
      console.warn('[RevealBid] Could not read on-chain commitment; using the latest stored secret.', e);
    }
    if (!stored) {
      setRevealError('No committed bid found for this wallet. You must commit before revealing (or import your bid secret backup).');
      return;
    }

    const { maxBid: storedMaxBid, secret: storedSecret } = stored;

    console.log('[RevealBid] auctionId:', auctionId);
    console.log('[RevealBid] bidder:', address);
    console.log('[RevealBid] original maxBid:', storedMaxBid, currencySymbol);

    try {
      setRevealStatus('confirming');
      const maxBidWei = parseEther(storedMaxBid);

      // revealBid(uint256 auctionId, uint256 maxBid, bytes32 secret) nonpayable
      const hash = await writeContractAsync({
        chainId: targetChainId,
        address: auctionContract.address,
        abi: auctionContract.abi,
        functionName: 'revealBid',
        args: [auction.id, maxBidWei, storedSecret],
      });

      console.log('[RevealBid] Tx submitted:', hash);
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      console.log('[RevealBid] Receipt status:', receipt.status);

      if (receipt.status !== 'success') {
        throw new Error(`Transaction reverted on-chain (tx: ${hash}).`);
      }

      saveBidSecret({ ...stored, auctionId: secretStorageAuctionId, status: 'confirmed', revealed: true });
      setRevealTxHash(hash);
      setRevealStatus('success');
    } catch (err: unknown) {
      console.error('[RevealBid] Error:', err);
      setRevealError(parseError(err, 'bid reveal', networkName, currencySymbol));
      setRevealStatus('error');
    }
  }

  // ── SETTLE handler ───────────────────────────────────────────────────
  async function handleSettle() {
    setSettleError(null);
    if (!auction) { setSettleError('Auction data not loaded yet.'); return; }

    if (isSolana) {
      try {
        setSettleStatus('confirming');
        const callerPubkey = await ensureSolanaWallet();

        const programId = getSolanaAuctionProgramId();
        const inst = createSettleAuctionInstruction({
          auctionId: auction.id,
          programId,
        });
        const signature = await sendSolanaAuctionInstructions([inst], callerPubkey, 'Solana settle');

        setSettleTxHash(signature);
        setSettleStatus('success');
        void loadAuction(true);
      } catch (err: any) {
        console.error('Solana settle error:', err);
        setSettleError(err?.message || 'Failed to settle auction on Solana Devnet.');
        setSettleStatus('error');
      }
      return;
    }

    if (!isConnected || !address) { setSettleError('Please connect your wallet first.'); return; }
    if (!publicClient) { setSettleError('Blockchain client unavailable.'); return; }

    if (walletChainId !== targetChainId) {
      if (switchChain) {
        try {
          await switchChain({ chainId: targetChainId });
        } catch {
          setSettleError(`Please switch your wallet to ${networkName} before settling.`);
          return;
        }
      } else {
        setSettleError(`Please switch your wallet to ${networkName} before settling.`);
        return;
      }
    }

    console.log('[SettleAuction] auctionId:', auctionId);

    try {
      setSettleStatus('confirming');

      // settleAuction(uint256 auctionId) nonpayable — permissionless
      const hash = await writeContractAsync({
        chainId: targetChainId,
        address: auctionContract.address,
        abi: auctionContract.abi,
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
      setSettleError(parseError(err, 'auction settlement', networkName, currencySymbol));
      setSettleStatus('error');
    }
  }

  // ── WITHDRAW REFUND handler ──────────────────────────────────────────
  async function handleWithdraw() {
    setWithdrawError(null);
    if (!isConnected || !address) { setWithdrawError('Please connect your wallet first.'); return; }
    if (!publicClient) { setWithdrawError('Blockchain client unavailable.'); return; }

    if (walletChainId !== targetChainId) {
      if (switchChain) {
        try {
          await switchChain({ chainId: targetChainId });
        } catch {
          setWithdrawError(`Please switch your wallet to ${networkName} before withdrawing.`);
          return;
        }
      } else {
        setWithdrawError(`Please switch your wallet to ${networkName} before withdrawing.`);
        return;
      }
    }

    console.log('[WithdrawRefund] address:', address);

    try {
      setWithdrawStatus('confirming');

      // withdrawRefund() nonpayable — pull-based
      const hash = await writeContractAsync({
        chainId: targetChainId,
        address: auctionContract.address,
        abi: auctionContract.abi,
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
      setWithdrawError(parseError(err, 'refund withdrawal', networkName, currencySymbol));
      setWithdrawStatus('error');
    }
  }

  // ── UNLOCK / DOWNLOAD handler ──────────────────────────────────────────
  async function handleUnlockDataset() {
    setUnlockError(null);
    if (!isSolana && (!isConnected || !address)) { setUnlockError('Please connect your wallet first.'); return; }
    
    try {
      setUnlockStatus('signing');
      const signer = isSolana ? await ensureSolanaWallet() : address!;
      const timestamp = Date.now();
      const message = datasetDownloadMessageFor(networkId, { auctionId, address: signer, timestamp });
      
      const signature = await signForNetwork(networkId, message, signMessageAsync);
      
      setUnlockStatus('downloading');
      
      const res = await fetch('/api/datasets/download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          auctionId,
          address: signer,
          signature,
          timestamp,
          network: networkId,
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
    if (!auctionId) return;
    if (!isSolana && (!isConnected || !address || !signMessageAsync)) return;
    if (datasetMeta?.deliveryMethod === 'nft-transfer') {
      setInspectionData({ format: 'NFT transfer', recordCount: 0, columnCount: 0 });
      return;
    }
    try {
      const signer = isSolana ? await ensureSolanaWallet() : address!;
      const timestamp = Date.now();
      const message = datasetInspectMessageFor(networkId, { auctionId, address: signer, timestamp });
      const signature = await signForNetwork(networkId, message, signMessageAsync);
      
      const res = await fetch('/api/datasets/inspect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ auctionId, address: signer, signature, timestamp, network: networkId })
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
  }, [isConnected, address, auctionId, signMessageAsync, datasetMeta, networkId, isSolana, ensureSolanaWallet]);

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
  const [showDisputeModal, setShowDisputeModal] = useState(false);
  const [transactionTab, setTransactionTab] = useState<'delivery' | 'chat' | 'validator'>('delivery');
  const [aiReport, setAiReport] = useState<GeminiValidationOutput | null>(null);
  const [aiLoading, setAiLoading] = useState(false);

  const fetchAiValidation = async () => {
    try {
      setAiLoading(true);
      const res = await fetch(`/api/transactions/${auctionId}/validate?network=${encodeURIComponent(networkId)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (data.success && data.report) {
        setAiReport(data.report);
      }
    } catch (err) {
      console.error('Failed to run AI validation:', err);
    } finally {
      setAiLoading(false);
    }
  };

  // ── Post-settlement lifecycle actions ────────────────────────────────
  const [lifecycleStatus, setLifecycleStatus] = useState<'idle' | 'confirming' | 'success' | 'error'>('idle');
  const [lifecycleAction, setLifecycleAction] = useState<string | null>(null);
  const [lifecycleTxHash, setLifecycleTxHash] = useState<string | null>(null);
  const [lifecycleError, setLifecycleError] = useState<string | null>(null);

  async function ensureEvmWalletOnTargetChain() {
    if (!isConnected || !address) throw new Error('Please connect your wallet first.');
    if (!publicClient) throw new Error('Blockchain client unavailable.');
    if (walletChainId !== targetChainId) {
      if (!switchChain) throw new Error(`Please switch your wallet to ${networkName}.`);
      try {
        await switchChain({ chainId: targetChainId });
      } catch {
        throw new Error(`Please switch your wallet to ${networkName}.`);
      }
    }
    return { account: address, client: publicClient };
  }

  /** Runs one lifecycle transaction with shared status/error handling. */
  async function runLifecycleAction(label: string, action: () => Promise<string>) {
    setLifecycleAction(label);
    setLifecycleError(null);
    setLifecycleTxHash(null);
    setLifecycleStatus('confirming');
    try {
      const hash = await action();
      setLifecycleTxHash(hash);
      setLifecycleStatus('success');
      await loadAuction(true);
      await loadPendingRefund();
      void loadSolanaCommitment();
    } catch (err: unknown) {
      console.error(`[${label}] Error:`, err);
      setLifecycleError(isSolana ? (err instanceof Error ? err.message : `${label} failed.`) : parseError(err, label, networkName, currencySymbol));
      setLifecycleStatus('error');
    }
  }

  async function sendEvmAuctionTx(functionName: 'acceptDataset' | 'finalizeSettlement', label: string) {
    const { client } = await ensureEvmWalletOnTargetChain();
    const hash = await writeContractAsync({
      chainId: targetChainId,
      address: auctionContract.address,
      abi: auctionContract.abi,
      functionName,
      args: [BigInt(auctionId)],
    });
    const receipt = await client.waitForTransactionReceipt({ hash });
    if (receipt.status !== 'success') throw new Error(`${label} transaction reverted on-chain (tx: ${hash}).`);
    return hash;
  }

  const handleAcceptDataset = async () => {
    if (!auction) return;
    await runLifecycleAction('accept delivery', async () => {
      if (isSolana) {
        const winner = await ensureSolanaWallet();
        const inst = createAcceptDatasetInstruction({ auctionId: auction.id, seller: auction.seller, winner });
        return sendSolanaAuctionInstructions([inst], winner, 'Solana accept');
      }
      return sendEvmAuctionTx('acceptDataset', 'Accept');
    });
  };

  /**
   * EVM `finalizeSettlement`: anyone may call once the inspection window has
   * ended without a refund request. Pays the seller (minus the 10% fee) and,
   * for NFT auctions, releases the escrowed NFT to the winner — the only way
   * NFT auctions complete, since `acceptDataset` is blocked for NFTs in V4.
   * Solana equivalent: `finalize_inspection_timeout`.
   */
  const handleFinalizeSettlement = async () => {
    if (!auction) return;
    await runLifecycleAction('finalize settlement', async () => {
      if (isSolana) {
        const caller = await ensureSolanaWallet();
        const inst = createFinalizeInspectionTimeoutInstruction({ auctionId: auction.id, seller: auction.seller, winner: auction.highestBidder, caller });
        return sendSolanaAuctionInstructions([inst], caller, 'Solana inspection timeout');
      }
      return sendEvmAuctionTx('finalizeSettlement', 'Finalize settlement');
    });
  };

  /** Solana: winner reclaims escrow if the reviewer did not decide within 7 days. */
  const handleFinalizeRefundTimeout = async () => {
    if (!auction) return;
    await runLifecycleAction('refund timeout', async () => {
      const winner = await ensureSolanaWallet();
      const inst = createFinalizeRefundTimeoutInstruction({ auctionId: auction.id, winner });
      return sendSolanaAuctionInstructions([inst], winner, 'Solana refund timeout');
    });
  };

  /** Solana: losing / unrevealed bidders reclaim their full deposit (no penalty). */
  const handleClaimSolanaRefund = async () => {
    if (!auction) return;
    await runLifecycleAction('claim refund', async () => {
      const bidder = await ensureSolanaWallet();
      const inst = createClaimRefundInstruction({ auctionId: auction.id, bidder });
      return sendSolanaAuctionInstructions([inst], bidder, 'Solana claim refund');
    });
  };

  const signAuctionAuth = async (action: string) => {
    const signer = isSolana ? await ensureSolanaWallet() : address;
    if (!signer) throw new Error('Please connect your wallet first.');
    return buildAuctionAuth({ action, networkId, auctionId, address: signer, signEvm: signMessageAsync });
  };

  const handleRequestRefund = async (evidenceHash: string) => {
    try {
      if (!auction) return;
      if (isSolana) {
        const winner = await ensureSolanaWallet();
        const inst = createRequestRefundInstruction({ auctionId: auction.id, winner, evidenceHash: bytes32FromHex(evidenceHash) });
        await sendSolanaAuctionInstructions([inst], winner, 'Solana refund request');
        await loadAuction(true);
        setShowRefundForm(false);
        return;
      }

      // Same VeilNFTV4 ABI on BNB Testnet and Base Sepolia (getAuctionContractConfig).
      const { client } = await ensureEvmWalletOnTargetChain();
      const hash = await writeContractAsync({
        chainId: targetChainId,
        address: auctionContract.address,
        abi: auctionContract.abi,
        functionName: 'requestRefund',
        args: [BigInt(auctionId), evidenceHash],
      });

      const receipt = await client.waitForTransactionReceipt({ hash });
      if (receipt.status !== 'success') throw new Error(`Transaction reverted on-chain (tx: ${hash}).`);
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
        <p className="text-[#A8A397]">Loading auction from {isSolana ? 'Solana Devnet' : targetChainId === baseSepoliaChain.id ? 'Base Sepolia' : 'BNB Chain'}...</p>
      </div>
    );
  }

  if (error || !auction) {
    return (
      <div className="min-h-screen bg-[#0A0A09] px-6 pt-32">
        <div className="max-w-3xl mx-auto rounded-2xl border border-white/10 bg-[#151512] p-12 text-center">
          <h1 className="text-2xl font-bold text-[#F5F2E8]">Auction not found</h1>
          <p className="mt-4 text-[#A8A397]">{error || `This auction does not exist on ${isSolana ? 'Solana Devnet' : targetChainId === baseSepoliaChain.id ? 'Base Sepolia' : 'BNB Chain'}.`}</p>
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

  // States: Created/active=0 (Solana Bidding/Revealing normalized to 0), Inspection=3, RefundRequested=4, UnderReview=5, Completed=6, Refunded=7, Cancelled=8
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
  const storedSecret = viewerConnected && viewerAddress ? getBidSecret(secretStorageAuctionId, viewerAddress) : null;
  const hasCommitted = storedSecret !== null || (isSolana && !!solanaCommitment);
  const alreadyRevealed = storedSecret?.revealed === true || (isSolana && solanaCommitment?.revealed === true);

  // Winner detection — straight from chain data, never from local state
  const hasWinner = !!auction?.highestBidder && auction.highestBidder !== ZERO_ADDRESS;
  const isSeller = viewerConnected && sameWallet(auction?.seller, viewerAddress, networkId);
  const isWinner = viewerConnected && hasWinner && sameWallet(auction?.highestBidder, viewerAddress, networkId);

  // Inspection / refund windows (on-chain unix seconds)
  const inspectionEndMs = Number(auction.inspectionEndTime) * 1000;
  const inspectionWindowOpen = isInspectionOnChain && now <= inspectionEndMs;
  const inspectionExpired = isInspectionOnChain && inspectionEndMs > 0 && now > inspectionEndMs;
  const isNftAuction = datasetMeta?.assetType === 'nft' || datasetMeta?.deliveryMethod === 'nft-transfer';
  const solanaRefundTimeoutMs = isSolana && auction.refundRequestedAt
    ? (Number(auction.refundRequestedAt) + SOLANA_REFUND_REVIEW_TIMEOUT_SECONDS) * 1000
    : 0;
  const canFinalizeRefundTimeout = isSolana && isWinner && isRefundRequestedOnChain && solanaRefundTimeoutMs > 0 && now >= solanaRefundTimeoutMs;
  // Solana: any non-winning commitment (revealed or not), or the winner's after an approved refund,
  // can be closed back to the bidder once the auction is settled.
  const canClaimSolanaRefund = isSolana && !!solanaCommitment && isSettledOrLater && !isCancelledOnChain
    && (!isWinner || isRefundedOnChain);
  const platformFeeBps = auctionPlatformFeeBps(networkId);

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

        <div className="mb-8 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/10 bg-[#12120F] px-4 py-3 text-sm">
          <span className="text-[#A8A397]">Viewing {isSolana ? 'Solana Devnet' : targetChainId === baseSepoliaChain.id ? 'Base Sepolia' : 'BNB Chain Testnet'} auction · pay in {currencySymbol}</span>
          {!isSolana && isConnected && walletChainId !== targetChainId && <button type="button" onClick={() => switchChain?.({ chainId: targetChainId })} className="rounded-lg bg-[#C9A45C] px-3 py-2 text-xs font-bold text-[#0A0A09]">Switch wallet network</button>}
          {isSolana && (solanaWallet
            ? <span className="font-mono text-xs text-[#C9A45C] truncate max-w-[220px]">Solana wallet: {solanaWallet}</span>
            : <button type="button" onClick={() => { void ensureSolanaWallet().catch((e) => console.warn('[Solana] connect failed', e)); }} className="rounded-lg bg-[#C9A45C] px-3 py-2 text-xs font-bold text-[#0A0A09]">Connect Solana wallet</button>)}
        </div>


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
            <div className="mb-2 flex items-center justify-between">
              <span className="text-[#A8A397] text-[10px] uppercase font-bold tracking-widest">DIGITAL ASSET · {datasetMeta?.assetType || 'DATASET'}</span>
              {targetChainId === bnbChain.id && (
                <Link
                  href={`/verify/${auction.id}`}
                  className="inline-flex items-center gap-1 text-[11px] font-bold uppercase tracking-wider text-[#C9A45C] hover:text-[#E6CC91] transition"
                >
                  Proof of Auction ↗
                </Link>
              )}
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
                    <div className="text-[#A8A397] truncate">{datasetMeta.deliveryMethod === 'nft-transfer' ? 'Digital token asset' : datasetMeta.samplePreview ? 'Private dataset · sample preview below' : 'Encrypted product file · details shown during inspection'}</div>
                  </div>
                  <div>
                    <div className="text-[#F5F2E8] font-bold mb-1">Size:</div>
                    <div className="text-[#A8A397]">{datasetMeta.deliveryMethod === 'nft-transfer' ? 'On-chain asset' : datasetMeta.samplePreview ? 'Full file stays private until inspection' : 'File details hidden until inspection'}</div>
                  </div>
                  {datasetMeta.tokenAddress && <div><div className="text-[#F5F2E8] font-bold mb-1">NFT delivery:</div><div>{datasetMeta.tokenStandard} · Token #{datasetMeta.tokenId}{datasetMeta.tokenStandard === 'ERC-1155' ? ` · Amount ${datasetMeta.tokenAmount || '1'}` : ''}</div><div className="break-all">{datasetMeta.tokenAddress}</div><div className="mt-2 text-[#C9A45C]">On-chain status: {nftDeliveryState}</div></div>}
                  {datasetMeta.licenseType && <div><div className="text-[#F5F2E8] font-bold mb-1">License:</div><div>{datasetMeta.licenseType}</div></div>}
                  {privateDeliveryInfo?.accessInstructions && <div><div className="text-[#F5F2E8] font-bold mb-1">Private delivery instructions:</div><div className="whitespace-pre-wrap">{privateDeliveryInfo.accessInstructions}</div></div>}
                </div>
              </div>
            )}

            {datasetMeta?.samplePreview && (
              <section className="mt-6 p-5 rounded-2xl border border-[#C9A45C]/25 bg-[#151512] space-y-4">
                <div>
                  <h2 className="text-xs font-bold uppercase tracking-widest text-[#E6CC91]">Dataset Preview</h2>
                  <p className="mt-2 text-xs text-[#A8A397]">{datasetMeta.samplePreview.rows.length} sample rows shared publicly by the seller. The full dataset stays private.</p>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse whitespace-nowrap text-xs">
                    <thead><tr>{datasetMeta.samplePreview.columns.map((column) => <th key={column} className="pr-5 pb-3 text-[#F5F2E8] font-semibold border-b border-white/10">{column}</th>)}</tr></thead>
                    <tbody>{datasetMeta.samplePreview.rows.map((row, rowIndex) => (
                      <tr key={rowIndex} className="hover:bg-white/[0.02]">
                        {datasetMeta.samplePreview!.columns.map((column) => <td key={column} className="max-w-64 truncate pr-5 py-2 text-[#A8A397] border-b border-white/5" title={row[column]}>{row[column]}</td>)}
                      </tr>
                    ))}</tbody>
                  </table>
                </div>
              </section>
            )}

            {datasetMeta?.assetType === 'dataset' && !datasetMeta.samplePreview && isSeller && isCommitOpen && (
              <section className="mt-6 p-5 rounded-2xl border border-[#C9A45C]/25 bg-[#151512]">
                <h2 className="text-sm font-bold text-[#F5F2E8]">Pre-review is not published yet</h2>
                <p className="mt-2 text-sm leading-6 text-[#A8A397]">Publish up to 10 sample rows so bidders can inspect the dataset before bidding. These rows and column names will be public; the full file stays private. Your wallet only signs an authorization message, with no gas fee.</p>
                <button onClick={handlePublishPreview} disabled={previewPublishing} className="mt-4 rounded-lg bg-[#E6CC91] px-5 py-3 text-sm font-bold text-[#0A0A09] disabled:opacity-50">
                  {previewPublishing ? 'Waiting for wallet…' : 'Publish 10-row pre-review'}
                </button>
                {previewError && <p role="alert" className="mt-3 text-sm text-red-400">{previewError}</p>}
              </section>
            )}

            {/* STATS */}
            <div className="mt-8 grid grid-cols-3 rounded-2xl border border-white/10 bg-[#151512] overflow-hidden">
              <div className="p-5 border-r border-white/10">
                <span className="block text-xs uppercase tracking-wider text-[#A8A397]">Starting At</span>
                <span className="block mt-2 text-xl font-bold text-[#F5F2E8]">{isSolana ? formatSolLamports(auction.startingPrice) : formatEther(auction.startingPrice)} {currencySymbol}</span>
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
                          <p className="text-xs text-[#A8A397]">Committed on {isSolana ? 'Solana Devnet' : targetChainId === baseSepoliaChain.id ? 'Base Sepolia' : 'BNB Chain'}</p>
                        </div>
                      </div>
                      <div className="p-4 rounded-xl bg-[#0A0A09] border border-white/10 space-y-2 text-xs">
                        <div className="flex justify-between">
                          <span className="text-[#A8A397]">Maximum bid saved for reveal</span>
                          <span className="font-bold text-[#F5F2E8]">{committedMaxBid} {currencySymbol}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-[#A8A397]">Public deposit</span>
                          <span className="font-bold text-[#F5F2E8]">{committedDeposit} {currencySymbol}</span>
                        </div>
                        <div className="flex justify-between gap-4">
                          <span className="text-[#A8A397] flex-shrink-0">Tx hash</span>
                          <span className="font-mono text-[#C9A45C] truncate">{commitTxHash}</span>
                        </div>
                      </div>
                      <a href={isSolana ? `https://explorer.solana.com/tx/${commitTxHash}?cluster=devnet` : `${explorerBase}/tx/${commitTxHash}`} target="_blank" rel="noreferrer"
                        className="block text-center text-xs font-semibold text-[#C9A45C] hover:underline">
                        View transaction on {explorerName} ↗
                      </a>
                      <p className="text-center text-xs text-[#A8A397]">Secret saved locally. Return here to reveal after commit phase ends.</p>
                      <button type="button" onClick={handleDownloadSecretBackup} className="block w-full text-center text-xs font-semibold text-[#C9A45C] hover:underline">
                        Download bid secret backup (keep it private) ↓
                      </button>
                    </div>
                  ) : (
                    <>
                      <p className="mt-2 text-sm leading-6 text-[#A8A397]">
                        The commitment hash hides your bid until reveal. Your wallet address and deposit are public on-chain. A deposit equal to your maximum reveals that maximum; a higher deposit only gives others an upper bound. {isSolana ? 'Any excess is returned to your wallet automatically when you reveal.' : 'Any excess becomes claimable after you reveal.'}
                      </p>
                      <label htmlFor="max-bid-input" className="mt-6 block text-xs font-semibold uppercase tracking-wider text-[#A8A397]">Maximum bid ({currencySymbol})</label>
                      <input
                        id="max-bid-input"
                        type="number" min="0.000000000000000001" step="0.000000000000000001"
                        placeholder="Your maximum amount"
                        value={maxBidInput}
                        onChange={(e) => { setMaxBidInput(e.target.value); setCommitError(null); if (commitStatus === 'error') setCommitStatus('idle'); }}
                        disabled={commitStatus === 'confirming'}
                        className="mt-2 w-full rounded-xl border border-white/10 bg-[#0A0A09] px-5 py-4 text-[#F5F2E8] outline-none focus:border-[#C9A45C]/60 disabled:opacity-50"
                      />
                      <label htmlFor="public-deposit-input" className="mt-4 block text-xs font-semibold uppercase tracking-wider text-[#A8A397]">Public deposit ({currencySymbol})</label>
                      <input
                        id="public-deposit-input"
                        type="number" min="0.000000000000000001" step="0.000000000000000001"
                        placeholder="Must be at least your maximum bid"
                        value={depositInput}
                        onChange={(e) => { setDepositInput(e.target.value); setCommitError(null); if (commitStatus === 'error') setCommitStatus('idle'); }}
                        disabled={commitStatus === 'confirming'}
                        className="mt-2 w-full rounded-xl border border-white/10 bg-[#0A0A09] px-5 py-4 text-[#F5F2E8] outline-none focus:border-[#C9A45C]/60 disabled:opacity-50"
                      />
                      {commitError && (
                        <div className="mt-3 p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-xs text-rose-400">
                          {commitError}
                          {hasCommitted && (
                            <button type="button" onClick={handleDownloadSecretBackup} className="mt-2 block font-semibold text-[#C9A45C] hover:underline">Download bid secret backup ↓</button>
                          )}
                        </div>
                      )}
                      <button
                        id="commit-bid-button"
                        onClick={handleCommit}
                        disabled={commitStatus === 'confirming'}
                        className="mt-4 w-full rounded-xl bg-[#C9A45C] px-5 py-4 font-bold text-[#0A0A09] hover:bg-[#E6CC91] active:scale-[0.98] transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {commitStatus === 'confirming' ? 'CONFIRMING…' : 'COMMIT SEALED BID'}
                      </button>
                      {!viewerConnected && <p className="mt-3 text-center text-xs text-[#A8A397]">Connect your {isSolana ? 'Solana ' : ''}wallet to place a bid.</p>}
                      {viewerConnected && commitStatus === 'idle' && (
                        <p className="mt-3 text-center text-xs text-[#A8A397]">
                          {isSolana
                            ? 'Your deposit is locked in a Solana Devnet program account; excess over your revealed bid is returned at reveal. Non-winning bidders reclaim their full deposit with no penalty.'
                            : `Your deposit is locked on ${networkName}; excess over your revealed bid becomes claimable after reveal. Unrevealed bids lose 5% of their deposit.`}
                        </p>
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
                          <span className="font-bold text-[#F5F2E8]">{storedSecret?.maxBid ?? '—'} {currencySymbol}</span>
                        </div>
                        <div className="flex justify-between gap-4">
                          <span className="text-[#A8A397] flex-shrink-0">Tx hash</span>
                          <span className="font-mono text-[#C9A45C] truncate">{revealTxHash}</span>
                        </div>
                      </div>
                      <a href={isSolana ? `https://explorer.solana.com/tx/${revealTxHash}?cluster=devnet` : `${explorerBase}/tx/${revealTxHash}`} target="_blank" rel="noreferrer"
                        className="block text-center text-xs font-semibold text-[#C9A45C] hover:underline">
                        View transaction on {explorerName} ↗
                      </a>
                    </div>
                  ) : alreadyRevealed ? (
                    <div className="mt-4 p-4 rounded-xl bg-[#C9A45C]/5 border border-[#C9A45C]/20">
                      <p className="text-sm text-[#F5F2E8] font-semibold">You have already revealed your bid.</p>
                      <p className="mt-1 text-xs text-[#A8A397]">Your maximum bid of {storedSecret?.maxBid} {currencySymbol} was submitted on-chain.</p>
                    </div>
                  ) : hasCommitted ? (
                    <>
                      <p className="mt-2 text-sm leading-6 text-[#A8A397]">
                        The commit phase has ended. Reveal your sealed bid using your original committed amount.
                      </p>
                      <div className="mt-4 p-4 rounded-xl bg-[#0A0A09] border border-white/10 text-xs">
                        <div className="flex justify-between">
                          <span className="text-[#A8A397]">Your committed maximum</span>
                          <span className="font-bold text-[#F5F2E8]">{storedSecret?.maxBid ?? 'secret not found on this device'} {storedSecret ? currencySymbol : ''}</span>
                        </div>
                        <p className="mt-2 text-[#A8A397] opacity-70">The reveal will use your original committed values — you cannot change them.</p>
                        <button type="button" onClick={handleDownloadSecretBackup} className="mt-2 font-semibold text-[#C9A45C] hover:underline">Download bid secret backup ↓</button>
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
                        disabled={settleStatus === 'confirming' || (!isSolana && !isConnected)}
                        className="mt-4 w-full rounded-xl bg-[#C9A45C] px-5 py-4 font-bold text-[#0A0A09] hover:bg-[#E6CC91] active:scale-[0.98] transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {settleStatus === 'confirming' ? 'CONFIRMING…' : 'SETTLE AUCTION'}
                      </button>
                      {!viewerConnected && <p className="mt-3 text-center text-xs text-[#A8A397]">Connect your {isSolana ? 'Solana ' : ''}wallet to settle.</p>}
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
                      <a href={isSolana ? `https://explorer.solana.com/tx/${settleTxHash}?cluster=devnet` : `${explorerBase}/tx/${settleTxHash}`} target="_blank" rel="noreferrer"
                        className="block text-center text-xs font-semibold text-[#C9A45C] hover:underline">
                        View settlement transaction on {explorerName} ↗
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
                                ? (isNftAuction ? 'Payment is settled and the escrowed NFT was released to your wallet.' : 'Your access is unlocked. You can now download the full asset.') 
                                  : isNftAuction
                                    ? 'The NFT stays in VEILIO escrow during inspection. It is delivered to you when the inspection period ends and anyone finalizes settlement.'
                                    : 'Your access has been unlocked for inspection. Review the dataset before finalizing.'}
                              </p>
                            </div>
                          </div>
                          
                          {isCompletedOnChain && !isNftAuction && (
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
                                <div className="mt-6 space-y-4">
                                  {isNftAuction ? (
                                    <div className="rounded-2xl border border-blue-400/25 bg-blue-400/[0.04] p-5 space-y-3">
                                      <h4 className="text-xs font-bold uppercase tracking-wider text-blue-200">{networkName} NFT escrow</h4>
                                      <p className="text-xs leading-relaxed text-[#A8A397]">
                                        The VeilNFTV4 contract releases the escrowed NFT only when settlement is finalized after the inspection period
                                        {inspectionEndMs > 0 ? ` (ends ${new Date(inspectionEndMs).toLocaleString()})` : ''}. Until then you can request a refund if the asset does not match the listing.
                                      </p>
                                    </div>
                                  ) : null}

                                  {/* Workspace Tabs */}
                                  <div className="flex border-b border-white/10 gap-2 pb-2">
                                    <button
                                      onClick={() => setTransactionTab('delivery')}
                                      className={`px-4 py-2 text-xs font-bold uppercase tracking-wider rounded-xl transition-colors ${
                                        transactionTab === 'delivery'
                                          ? 'bg-[#C9A45C] text-[#0A0A09]'
                                          : 'text-[#A8A397] hover:text-[#F5F2E8]'
                                      }`}
                                    >
                                      Verifikasi Delivery
                                    </button>
                                    {targetChainId === bnbChain.id && !isSolana && (
                                      <button
                                        onClick={() => setTransactionTab('chat')}
                                        className={`px-4 py-2 text-xs font-bold uppercase tracking-wider rounded-xl transition-colors ${
                                          transactionTab === 'chat'
                                            ? 'bg-[#C9A45C] text-[#0A0A09]'
                                            : 'text-[#A8A397] hover:text-[#F5F2E8]'
                                        }`}
                                      >
                                        Transaction Chat
                                      </button>
                                    )}
                                    <button
                                      onClick={() => {
                                        setTransactionTab('validator');
                                        if (!aiReport) fetchAiValidation();
                                      }}
                                      className={`px-4 py-2 text-xs font-bold uppercase tracking-wider rounded-xl transition-colors ${
                                        transactionTab === 'validator'
                                          ? 'bg-[#C9A45C] text-[#0A0A09]'
                                          : 'text-[#A8A397] hover:text-[#F5F2E8]'
                                      }`}
                                    >
                                      VEILIO AI Validator
                                    </button>
                                  </div>

                                  {transactionTab === 'delivery' && (
                                    <DeliveryReviewPanel
                                      auctionId={auctionId}
                                      assetType={datasetMeta?.assetType || 'dataset'}
                                      isWinner={isWinner}
                                      deliverable={
                                        datasetMeta
                                          ? {
                                              fileName: datasetMeta.fileName,
                                              size: datasetMeta.size,
                                              manifest: datasetMeta.manifest,
                                              professionalMetadata: datasetMeta.professionalMetadata,
                                            }
                                          : null
                                      }
                                      deliveryStatus={datasetMeta ? 'delivery_submitted' : 'pending_delivery'}
                                      isInspectionActive={inspectionWindowOpen}
                                      onConfirmDelivery={handleAcceptDataset}
                                      onOpenChat={() => setTransactionTab(targetChainId === bnbChain.id && !isSolana ? 'chat' : 'delivery')}
                                      onRequestRefund={() => setShowDisputeModal(true)}
                                    />
                                  )}

                                  {transactionTab === 'chat' && targetChainId === bnbChain.id && !isSolana && (
                                    <TransactionChat
                                      transactionId={auctionId}
                                      currentUserAddress={address || ''}
                                      isBuyer={isWinner}
                                      isSeller={isSeller}
                                      onRequestValidation={fetchAiValidation}
                                    />
                                  )}

                                  {transactionTab === 'validator' && (
                                    <AiValidatorPanel
                                      report={aiReport}
                                      loading={aiLoading}
                                      onRefresh={fetchAiValidation}
                                    />
                                  )}

                                  <DisputeModal
                                    auctionId={auctionId}
                                    networkId={networkId}
                                    isOpen={showDisputeModal}
                                    onClose={() => setShowDisputeModal(false)}
                                    signAuth={signAuctionAuth}
                                    onSubmitOnchain={async (evidenceHash) => {
                                      await handleRequestRefund(evidenceHash);
                                    }}
                                  />
                                </div>
                              )}
                            </div>
                          )}

                          {isRefundRequestedOnChain && isSolana && (
                            <div className="mt-4 pt-4 border-t border-[#C9A45C]/20">
                              <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/30">
                                <h4 className="text-sm font-bold text-amber-300 uppercase tracking-wider">Refund requested</h4>
                                <p className="text-xs text-[#A8A397] mt-1">
                                  The auction reviewer decides on-chain. If no decision is made by {solanaRefundTimeoutMs ? new Date(solanaRefundTimeoutMs).toLocaleString() : 'the 7-day deadline'}, you can reclaim your full escrow yourself.
                                </p>
                                {canFinalizeRefundTimeout && (
                                  <button
                                    onClick={handleFinalizeRefundTimeout}
                                    disabled={lifecycleStatus === 'confirming'}
                                    className="mt-3 w-full rounded-xl border border-amber-400/40 px-5 py-3 text-xs font-bold uppercase tracking-wider text-amber-200 hover:bg-amber-400/10 disabled:opacity-50"
                                  >
                                    {lifecycleStatus === 'confirming' && lifecycleAction === 'refund timeout' ? 'CONFIRMING…' : 'Reclaim escrow (reviewer timeout)'}
                                  </button>
                                )}
                              </div>
                            </div>
                          )}

                          {isRefundedOnChain && (
                            <div className="mt-4 pt-4 border-t border-[#C9A45C]/20">
                              <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/30">
                                <h4 className="text-sm font-bold text-emerald-400 uppercase tracking-wider">Refund Approved</h4>
                                <p className="text-xs text-[#A8A397] mt-1">{isSolana ? 'Your refund was approved. The Solana program returned your full escrow to your wallet.' : 'Your refund request was approved by the reviewer. You can withdraw your refund below.'}</p>
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
                          <span className="font-bold text-[#F5F2E8]">{formatAmount(winningPrice)} {currencySymbol}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-[#A8A397]">Bidders revealed</span>
                          <span className="text-[#F5F2E8]">{Number(auction.revealedCount)} / {Number(auction.bidderCount)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-[#A8A397]">Platform fee</span>
                          <span className="text-[#F5F2E8]">{platformFeeBps === 0 ? '0% (seller receives the full winning bid)' : `${platformFeeBps / 100}%`}</span>
                        </div>
                        {(isInspectionOnChain || isRefundRequestedOnChain || isUnderReviewOnChain) && inspectionEndMs > 0 && (
                          <div className="flex justify-between">
                            <span className="text-[#A8A397]">Inspection ends</span>
                            <span className="text-[#F5F2E8]">{new Date(inspectionEndMs).toLocaleString()}</span>
                          </div>
                        )}
                      </div>

                      {/* FINALIZE AFTER INSPECTION — permissionless, required for NFT auctions */}
                      {inspectionExpired && (
                        <div className="rounded-xl border border-[#C9A45C]/30 bg-[#C9A45C]/5 p-4 space-y-3">
                          <p className="text-xs font-semibold uppercase tracking-wider text-[#E6CC91]">Inspection period ended</p>
                          <p className="text-xs leading-relaxed text-[#A8A397]">
                            No refund was requested in time. Anyone can finalize settlement:{' '}
                            {isSolana
                              ? 'the program pays the full winning bid to the seller.'
                              : `the contract credits the seller (minus the ${platformFeeBps / 100}% platform fee)${isNftAuction ? ' and delivers the escrowed NFT to the winner' : ''}.`}
                          </p>
                          <button
                            id="finalize-settlement-button"
                            onClick={handleFinalizeSettlement}
                            disabled={lifecycleStatus === 'confirming' || (!isSolana && !isConnected)}
                            className="w-full rounded-xl bg-[#C9A45C] px-5 py-3 text-sm font-bold text-[#0A0A09] hover:bg-[#E6CC91] active:scale-[0.98] transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            {lifecycleStatus === 'confirming' && lifecycleAction === 'finalize settlement' ? 'CONFIRMING…' : 'FINALIZE SETTLEMENT'}
                          </button>
                          {!viewerConnected && <p className="text-center text-xs text-[#A8A397]">Connect your {isSolana ? 'Solana ' : ''}wallet to finalize.</p>}
                        </div>
                      )}

                    </div>
                  ) : (
                    <div className="mt-4 p-4 rounded-xl bg-white/[0.03] border border-white/10">
                      <p className="text-sm text-[#A8A397]">
                        No valid bids were revealed above the starting price. The auction ended with no winner.
                        {' '}{noWinnerRefundText(networkId, currencySymbol)}
                      </p>
                    </div>
                  )}

                  {/* SOLANA: claim back a non-winning (or approved-refund) deposit */}
                  {canClaimSolanaRefund && (
                    <div className="mt-4 rounded-xl border border-white/10 bg-[#0A0A09] p-4">
                      <p className="text-xs font-semibold uppercase tracking-wider text-[#A8A397] mb-3">{isWinner ? 'Approved Refund' : 'Your Refund (Non-winning Bid)'}</p>
                      <div className="flex items-center justify-between mb-3">
                        <span className="text-xs text-[#A8A397]">Deposit held in your bid account</span>
                        <span className="font-bold text-[#C9A45C]">{formatSolLamports(solanaCommitment!.deposit)} SOL</span>
                      </div>
                      <p className="mb-3 text-[11px] text-[#77746B]">Solana auctions charge no penalty: revealed and unrevealed bids get the full deposit plus the account rent back.</p>
                      <button
                        id="claim-solana-refund-button"
                        onClick={handleClaimSolanaRefund}
                        disabled={lifecycleStatus === 'confirming'}
                        className="w-full rounded-xl border border-[#C9A45C]/40 text-[#C9A45C] px-5 py-3 text-sm font-bold hover:bg-[#C9A45C]/10 active:scale-[0.98] transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {lifecycleStatus === 'confirming' && lifecycleAction === 'claim refund' ? 'CONFIRMING…' : 'CLAIM REFUND'}
                      </button>
                    </div>
                  )}
                  {isSolana && solanaWallet && solanaCommitmentLoaded && !solanaCommitment && hasCommitted && isSettledOrLater && !isWinner && (
                    <p className="mt-4 text-xs text-[#A8A397]">Your Solana bid account is closed: the deposit has already been returned to your wallet.</p>
                  )}

                  {/* LIFECYCLE TX STATUS (accept / finalize / claim / timeout) */}
                  {lifecycleStatus === 'error' && lifecycleError && (
                    <div className="mt-4 p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-xs text-rose-400">{lifecycleError}</div>
                  )}
                  {lifecycleStatus === 'success' && lifecycleTxHash && (
                    <a
                      href={isSolana ? `https://explorer.solana.com/tx/${lifecycleTxHash}?cluster=devnet` : `${explorerBase}/tx/${lifecycleTxHash}`}
                      target="_blank" rel="noreferrer"
                      className="mt-4 block text-center text-xs font-semibold text-[#C9A45C] hover:underline"
                    >
                      ✓ {lifecycleAction} confirmed · view on {explorerName} ↗
                    </a>
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
                              <a href={`${explorerBase}/tx/${withdrawTxHash}`} target="_blank" rel="noreferrer"
                                className="block text-xs font-semibold text-emerald-400 hover:underline">
                                View on {explorerName} ↗
                              </a>
                            </div>
                          ) : (
                            <>
                              <div className="flex items-center justify-between mb-3">
                                <span className="text-xs text-[#A8A397]">Your Earnings</span>
                                <span className="font-bold text-[#F5F2E8]">{formatEther(pendingRefund!)} {currencySymbol}</span>
                              </div>
                              <div className="flex items-center justify-between mb-4">
                                <span className="text-xs text-[#A8A397]">Platform fee ({platformFeeBps / 100}%)</span>
                                <span className="text-xs text-[#A8A397]">{formatEther((winningPrice * BigInt(platformFeeBps)) / BigInt(10000))} {currencySymbol}</span>
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
                              <a href={`${explorerBase}/tx/${withdrawTxHash}`} target="_blank" rel="noreferrer"
                                className="block text-xs font-semibold text-[#C9A45C] hover:underline">
                                View on {explorerName} ↗
                              </a>
                            </div>
                          ) : (
                            <>
                              <div className="flex items-center justify-between mb-3">
                                <span className="text-xs text-[#A8A397]">Refund available</span>
                                <span className="font-bold text-[#C9A45C]">{formatEther(pendingRefund!)} {currencySymbol}</span>
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
                              <a href={`${explorerBase}/tx/${withdrawTxHash}`} target="_blank" rel="noreferrer"
                                className="block text-xs font-semibold text-[#C9A45C] hover:underline">
                                View on {explorerName} ↗
                              </a>
                            </div>
                          ) : (
                            <>
                              <div className="flex items-center justify-between mb-3">
                                <span className="text-xs text-[#A8A397]">Refund available</span>
                                <span className="font-bold text-[#C9A45C]">{formatEther(pendingRefund!)} {currencySymbol}</span>
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
                  <span className="font-mono text-[#F5F2E8] truncate max-w-[280px]">{auctionContract.address}</span>
                </div>
              </div>
            </div>

          </div>
        </div>
      </div>
    </div>
  );
}

