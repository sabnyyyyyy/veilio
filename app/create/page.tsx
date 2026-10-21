'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useAccount, useWriteContract, usePublicClient, useSignMessage, useChainId, useSwitchChain } from 'wagmi';
import { parseEther, decodeEventLog, isAddress } from 'viem';
import { getAuctionContractConfig, VEIL_V3_CONTRACT_ADDRESS, VEIL_V3_ABI, VEIL_V4_CONTRACT_ADDRESS } from '@/lib/contract';
import { saveCreatedAuction } from '@/lib/secretStorage';
import { uploadMetadataToIpfs, IpfsUploadResponse } from '@/lib/ipfs';
import { baseSepoliaChain, bnbChain } from '@/lib/chain';
import WalletButton from '@/components/WalletButton';
import ImageUploader from '@/components/ImageUploader';
import { assetUploadMessage } from '@/lib/assetAuth';
import { datasetLinkMessageFor, type AuctionNetworkId } from '@/lib/auctionNetwork';
import { connectSolanaWallet, signForNetwork } from '@/lib/client/auctionWallet';
import { sanitizeAssetFileName } from '@/lib/assetPolicy';
import { upload as uploadPrivateBlob } from '@vercel/blob/client';
import { Connection, PublicKey, Transaction, TransactionInstruction } from '@solana/web3.js';
import { createCreateAuctionInstruction } from '@/lib/cross-chain/solanaAuction';
import { Buffer } from 'buffer';

const DEFAULT_SOLANA_AUCTION_PROGRAM_ID = '5Tw1iJGN1hhyRzepbD5eLoaRoZTEiKcqrh2HoZYhYEta';

/**
 * Platform-operated refund reviewer for Solana auctions. When configured the
 * seller cannot choose the reviewer (a seller-chosen reviewer could be the
 * seller's own second wallet and reject every refund).
 */
const PLATFORM_SOLANA_REVIEWER = (process.env.NEXT_PUBLIC_SOLANA_AUCTION_REVIEWER || '').trim();

/**
 * Inspection window options (hours). Both the EVM contracts and the Solana
 * program require at least 1 hour and set no upper bound; the UI caps at 7 days.
 */
const INSPECTION_HOUR_OPTIONS = [1, 24, 72, 168] as const;
const DEFAULT_INSPECTION_HOURS = 24;

function inspectionLabel(hours: number) {
  return hours < 24 ? `${hours} hour${hours === 1 ? '' : 's'}` : `${hours / 24} day${hours === 24 ? '' : 's'}`;
}

function networkIdForTarget(target: 'bnb' | 'base' | 'solana'): AuctionNetworkId {
  return target === 'solana' ? 'solana:devnet' : target === 'base' ? 'base:84532' : 'bnb:97';
}

function parseSolLamports(value: string) {
  if (!/^\d+(\.\d{1,9})?$/.test(value)) throw new Error('Enter a valid SOL price with up to 9 decimal places.');
  const [whole, fraction = ''] = value.split('.');
  return BigInt(whole) * 1_000_000_000n + BigInt(fraction.padEnd(9, '0'));
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, Math.min(offset + 0x8000, bytes.length)));
  return window.btoa(binary);
}

function bytesToHex(bytes: Uint8Array) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export default function CreateAuctionPage() {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const { switchChain } = useSwitchChain();
const { writeContractAsync } = useWriteContract();
const { signMessageAsync } = useSignMessage();
const publicClient = usePublicClient();

  const [itemName, setItemName] = useState('');
  const [description, setDescription] = useState('');
  const [assetType, setAssetType] = useState<
    'dataset' | 'ai-model' | 'data-license' | 'api-license' | 'software-license' | 'nft' | 'digital-asset' | '3d-asset' | 'digital-media'
  >('dataset');
  const [assetDetails, setAssetDetails] = useState({ tokenStandard: 'ERC-721', tokenAddress: '', tokenId: '', tokenAmount: '1', licenseType: '', accessInstructions: '' });
  
  // Professional Metadata State
  const [licenseType, setLicenseType] = useState<'commercial_use' | 'academic_or_research' | 'exclusive_transfer'>('commercial_use');
  const [usageRights, setUsageRights] = useState('Commercial deployment & analysis permitted with attribution');
  const [formatSpec, setFormatSpec] = useState('');
  const [region, setRegion] = useState('Global');
  const [language, setLanguage] = useState('English');
  const [dataPeriod, setDataPeriod] = useState('2024 - 2026');
  const [updateFrequency, setUpdateFrequency] = useState<'one_time' | 'monthly' | 'streaming'>('one_time');
  const [schemaOrSpec, setSchemaOrSpec] = useState('');
  const [agentCompatible, setAgentCompatible] = useState(true);

  const [ipfsImageRes, setIpfsImageRes] = useState<IpfsUploadResponse | null>(null);
  const [mounted, setMounted] = useState(false);
  const [publishSamplePreview, setPublishSamplePreview] = useState(false);

  React.useEffect(() => {
    setMounted(true);
  }, []);
  const [startingPrice, setStartingPrice] = useState('0.0001');
  
  const [commitDuration, setCommitDuration] = useState('24');
  const [revealDuration, setRevealDuration] = useState('1');
  const [inspectionHours, setInspectionHours] = useState<number>(DEFAULT_INSPECTION_HOURS);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [statusStep, setStatusStep] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [createdAuctionId, setCreatedAuctionId] = useState<string>('1');
  const [createdAuctionAddress, setCreatedAuctionAddress] = useState<string | null>(null);
  const [createdChain, setCreatedChain] = useState<'bnb' | 'base' | 'solana'>('bnb');
  const [targetChain, setTargetChain] = useState<'bnb' | 'base' | 'solana'>('bnb');
  const targetEvmChainId = targetChain === 'base' ? baseSepoliaChain.id : bnbChain.id;
  const targetAuctionContract = targetChain === 'solana' ? null : getAuctionContractConfig(targetEvmChainId);
  const usesProfessionalMetadata = assetType === 'dataset' || assetType === 'ai-model';
  const [solanaReviewerInput, setSolanaReviewer] = useState('');
  const solanaReviewer = PLATFORM_SOLANA_REVIEWER || solanaReviewerInput;
  // Which wallet family signed the uploaded asset; linking requires the auction's seller wallet.
  const [uploadFamily, setUploadFamily] = useState<'evm' | 'solana' | null>(null);
  const [solanaLimitAcknowledged, setSolanaLimitAcknowledged] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [assetLinkWarning, setAssetLinkWarning] = useState<string | null>(null);

  // Dataset State
  const [datasetFile, setDatasetFile] = useState<File | null>(null);
  const [isUploadingDataset, setIsUploadingDataset] = useState(false);
  const [datasetInfo, setDatasetInfo] = useState<{
    datasetId: string;
    fileName: string;
    size: number;
    fileHashHex: string;
    mimeType: string;
    manifest?: {
      format: string;
      recordCount: number;
      columnCount: number;
      columns: string[];
      sample?: Record<string, unknown>[];
    };
  } | null>(null);

  const handleDatasetUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || e.target.files.length === 0) return;
    const file = e.target.files[0];
    const solanaUpload = targetChain === 'solana';
    if (!solanaUpload && (!isConnected || !address)) {
      setErrorMsg('Connect your wallet before uploading an asset.');
      e.target.value = '';
      return;
    }
    setDatasetFile(file);
    setPublishSamplePreview(false);
    setIsUploadingDataset(true);
    setErrorMsg(null);

    try {
      // The uploader must be the wallet that will be the auction's on-chain
      // seller: Phantom for Solana listings, the EVM wallet otherwise.
      const uploader = solanaUpload ? await connectSolanaWallet() : address!;
      const uploadNetwork = networkIdForTarget(targetChain);
      const fileName = sanitizeAssetFileName(file.name);
      const timestamp = Date.now();
      const nonce = crypto.randomUUID();
      const datasetId = crypto.randomUUID();

      if (process.env.NODE_ENV !== 'production') {
        const signature = await signForNetwork(uploadNetwork, assetUploadMessage({ address: uploader, assetType, fileName, fileSize: file.size, timestamp, nonce }), signMessageAsync);
        const formData = new FormData();
        formData.append('file', file);
        formData.append('assetType', assetType);
        formData.append('walletAddress', uploader);
        formData.append('timestamp', String(timestamp));
        formData.append('nonce', nonce);
        formData.append('signature', signature);
        if (assetType === 'software-license') {
          formData.append('licenseType', assetDetails.licenseType);
          formData.append('accessInstructions', assetDetails.accessInstructions);
        }
        const res = await fetch('/api/datasets/upload/local', { method: 'POST', body: formData });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to upload asset');
        setDatasetInfo(data.dataset);
        setUploadFamily(solanaUpload ? 'solana' : 'evm');
        return;
      }

      setStatusStep('Encrypting asset in your browser...');
      const plainBytes = await file.arrayBuffer();
      const fileHashHex = bytesToHex(new Uint8Array(await crypto.subtle.digest('SHA-256', plainBytes)));
      const keyBytes = crypto.getRandomValues(new Uint8Array(32));
      const ivBytes = crypto.getRandomValues(new Uint8Array(12));
      const cryptoKey = await crypto.subtle.importKey('raw', keyBytes, { name: 'AES-GCM' }, false, ['encrypt']);
      const ciphertextWithTag = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: ivBytes, tagLength: 128 }, cryptoKey, plainBytes));
      const authTag = ciphertextWithTag.subarray(ciphertextWithTag.length - 16);
      const encryptedUpload = new Blob([ciphertextWithTag], { type: 'application/octet-stream' });
      const signature = await signForNetwork(uploadNetwork, assetUploadMessage({ address: uploader, assetType, fileName, fileSize: file.size, timestamp, nonce, datasetId, fileHashHex }), signMessageAsync);
      const clientPayload = JSON.stringify({
        datasetId,
        walletAddress: uploader,
        assetType,
        fileName,
        fileSize: file.size,
        timestamp,
        nonce,
        signature,
        fileHashHex,
        keyBase64: bytesToBase64(keyBytes),
        ivBase64: bytesToBase64(ivBytes),
        licenseType: assetType === 'software-license' ? assetDetails.licenseType : undefined,
        accessInstructions: assetType === 'software-license' ? assetDetails.accessInstructions : undefined,
      });

      setStatusStep('Uploading encrypted asset to private storage...');
      await uploadPrivateBlob(`veilio/incoming/${datasetId}.enc`, encryptedUpload, {
        access: 'private',
        contentType: 'application/octet-stream',
        handleUploadUrl: '/api/datasets/upload',
        clientPayload,
        multipart: true,
        onUploadProgress: ({ percentage }) => setStatusStep(`Uploading encrypted asset... ${Math.floor(percentage)}%`),
      });

      setStatusStep('Scanning and verifying encrypted asset...');
      for (let attempt = 0; attempt < 120; attempt++) {
        const statusResponse = await fetch(`/api/datasets/upload?id=${encodeURIComponent(datasetId)}&address=${encodeURIComponent(uploader)}`, { cache: 'no-store' });
        const statusData = await statusResponse.json();
        if (statusData.status === 'ready') {
          setDatasetInfo(statusData.dataset);
          setUploadFamily(solanaUpload ? 'solana' : 'evm');
          return;
        }
        if (statusData.status === 'rejected' || !statusResponse.ok) throw new Error(statusData.error || 'Asset verification failed.');
        await new Promise((resolve) => window.setTimeout(resolve, 1000));
      }
      throw new Error('Asset verification is taking longer than expected. Keep this page open and retry selecting the file if it does not finish.');
    } catch (err: any) {
      console.error(err);
      setErrorMsg(err.message || 'Error uploading dataset');
      setDatasetFile(null);
    } finally {
      setIsUploadingDataset(false);
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    
    console.log('[VEILIO CREATE]', {
      walletConnected: isConnected,
      addressConfigured: !!VEIL_V3_CONTRACT_ADDRESS,
      addressValue: VEIL_V3_CONTRACT_ADDRESS,
      datasetId: datasetInfo?.datasetId ? 'present' : 'missing',
      manifest: datasetInfo?.manifest ? 'present' : 'missing',
      startingPrice: startingPrice ? 'valid' : 'invalid',
      commitDuration: commitDuration ? 'valid' : 'invalid',
      imageURI: ipfsImageRes?.uri ? 'present' : 'missing'
    });

    if (targetChain !== 'solana' && (!isConnected || !address)) {
      setErrorMsg('Wallet not connected.');
      return;
    }
    if (datasetInfo && uploadFamily && uploadFamily !== (targetChain === 'solana' ? 'solana' : 'evm')) {
      setErrorMsg(`The asset was uploaded with your ${uploadFamily === 'solana' ? 'Solana' : 'EVM'} wallet. Upload it again with the wallet that will sell on this network.`);
      return;
    }
    if (targetChain !== 'solana' && chainId !== targetEvmChainId) {
      setErrorMsg(`Switch your wallet to ${targetChain === 'base' ? 'Base Sepolia' : 'BNB Chain Testnet'} before creating this auction.`);
      return;
    }
    if (targetChain === 'bnb' && !VEIL_V3_CONTRACT_ADDRESS) {
      setErrorMsg('V3 contract is not configured in the environment. Please deploy first.');
      return;
    }
    if (targetChain === 'bnb' && assetType === 'nft' && !VEIL_V4_CONTRACT_ADDRESS) {
      setErrorMsg('NFT escrow is not active yet. Deploy the VEILIO V4 contract and configure NEXT_PUBLIC_V4_CONTRACT_ADDRESS first.');
      return;
    }
    if (targetChain === 'solana' && assetType === 'nft') {
      setErrorMsg('NFT escrow is currently available on BNB Chain only.');
      return;
    }
    if (targetChain === 'solana' && !solanaLimitAcknowledged) {
      setErrorMsg('Please acknowledge the current Solana Devnet marketplace limitations before creating this listing.');
      return;
    }
    if (targetChain === 'solana') {
      if (!window.solana?.signTransaction) {
        setErrorMsg('Install Phantom or another injected Solana wallet that can sign transactions.');
        return;
      }
      try {
        new PublicKey(solanaReviewer.trim());
        parseSolLamports(startingPrice);
      } catch {
        setErrorMsg(PLATFORM_SOLANA_REVIEWER
          ? 'The configured platform reviewer (NEXT_PUBLIC_SOLANA_AUCTION_REVIEWER) is not a valid Solana address, or the starting price is invalid.'
          : 'Enter a valid independent Solana reviewer address and starting price.');
        return;
      }
      if (new TextEncoder().encode(itemName).length > 64 || new TextEncoder().encode(description).length > 128) {
        setErrorMsg('Solana listing name is limited to 64 bytes and description to 128 bytes.');
        return;
      }
    }
    if (assetType === 'nft' && (!isAddress(assetDetails.tokenAddress) || !/^\d+$/.test(assetDetails.tokenId) || !/^\d+$/.test(assetDetails.tokenAmount) || BigInt(assetDetails.tokenAmount || '0') < BigInt(1) || (assetDetails.tokenStandard === 'ERC-721' && assetDetails.tokenAmount !== '1'))) {
      setErrorMsg('Enter a valid NFT contract, token ID, and amount. ERC-721 amount must be 1.');
      return;
    }
    if (!datasetInfo && assetType !== 'nft') {
      setErrorMsg('Please upload the digital asset file before creating the auction.');
      return;
    }

    const commitHours = Math.floor(parseFloat(commitDuration));
    const revealHours = Math.floor(parseFloat(revealDuration));
    
    if (isNaN(commitHours) || commitHours < 1) {
      setErrorMsg('Commit duration must be at least 1 hour.');
      return;
    }
    if (isNaN(revealHours) || revealHours < 1) {
      setErrorMsg('Reveal duration must be at least 1 hour.');
      return;
    }

    if (!(INSPECTION_HOUR_OPTIONS as readonly number[]).includes(inspectionHours)) {
      setErrorMsg('Choose an inspection period between 1 hour and 7 days.');
      return;
    }

    const commitDurationSec = BigInt(commitHours) * BigInt(3600);
    const revealDurationSec = BigInt(revealHours) * BigInt(3600);
    // Contracts/program require >= 1 hour; the winner needs time to inspect and dispute.
    const inspectionDurationSec = BigInt(inspectionHours) * BigInt(3600);

    setErrorMsg(null);

    try {
      setIsSubmitting(true);

      // STEP 1: Upload Metadata JSON to IPFS
      setStatusStep('Uploading auction metadata to IPFS...');
      const metadataRes = await uploadMetadataToIpfs({
        name: itemName,
        description,
        image: ipfsImageRes?.uri || '',
        startingPrice,
        asset: {
          assetType,
          category: assetType,
          ...(usesProfessionalMetadata ? {
            licenseType,
            usageRights,
            format: formatSpec || (datasetInfo?.manifest?.format) || (datasetInfo ? datasetInfo.fileName.split('.').pop()?.toUpperCase() : undefined),
            region,
            language,
            dataPeriod,
            updateFrequency,
            schemaOrSpecification: schemaOrSpec || undefined,
            agentCompatible,
          } : {}),
          fileSize: datasetInfo ? `${(datasetInfo.size / (1024 * 1024)).toFixed(2)} MB` : undefined,
          deliveryMethod: assetType === 'nft' ? 'nft-transfer' : assetType === 'software-license' ? 'license-access' : assetType === 'api-license' ? 'license-access' : 'encrypted-download',
          ...(assetType === 'dataset' && publishSamplePreview && datasetInfo?.manifest?.columns?.length && datasetInfo.manifest.sample?.length ? {
            samplePreview: {
              columns: datasetInfo.manifest.columns,
              rows: datasetInfo.manifest.sample.slice(0, 10),
            },
          } : {}),
          ...(assetType === 'nft' ? { tokenStandard: assetDetails.tokenStandard, tokenAddress: assetDetails.tokenAddress, tokenId: assetDetails.tokenId, tokenAmount: assetDetails.tokenAmount } : {}),
          ...(assetType === 'software-license' ? { licenseType: assetDetails.licenseType || licenseType } : {}),
        }
      });

      if (targetChain === 'solana') {
        const provider = window.solana;
        if (!provider) throw new Error('Install Phantom or another injected Solana wallet to create a Solana auction.');
        if (!provider.signTransaction) throw new Error('This Solana wallet cannot sign transactions from the app.');
        const connected = await provider.connect();
        const seller = new PublicKey(connected.publicKey.toString());
        const reviewer = new PublicKey(solanaReviewer.trim());
        if (seller.equals(reviewer)) {
          throw new Error(PLATFORM_SOLANA_REVIEWER
            ? 'The seller wallet cannot be the platform reviewer wallet. Use a different Phantom account to list.'
            : 'Reviewer wallet must be different from the seller wallet.');
        }
        const nameBytes = new TextEncoder().encode(itemName);
        const descriptionBytes = new TextEncoder().encode(description);
        const imageUriBytes = new TextEncoder().encode(metadataRes.uri);
        if (nameBytes.length > 64) throw new Error('Asset name must be at most 64 UTF-8 bytes for Solana.');
        if (descriptionBytes.length > 128) throw new Error('Description must be at most 128 UTF-8 bytes for Solana.');
        if (imageUriBytes.length > 200) throw new Error('Metadata URI is too long for the Solana auction program.');

        const programId = new PublicKey(process.env.NEXT_PUBLIC_SOLANA_AUCTION_PROGRAM_ID || DEFAULT_SOLANA_AUCTION_PROGRAM_ID);
        const auctionId = BigInt(Date.now()) * 1_000_000n + BigInt(window.crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000);
        const startingPriceLamports = parseSolLamports(startingPrice);
        if (startingPriceLamports <= 0n) throw new Error('Starting price must be greater than zero.');
        // Shared builder: appends the read-only AuctionConfig PDA as the last account (required by
        // the upgraded program, ignored as a remaining account by the pre-upgrade one).
        const compiled = createCreateAuctionInstruction({
          programId: programId.toBase58(),
          seller: seller.toBase58(),
          reviewer: reviewer.toBase58(),
          auctionId,
          itemName,
          description,
          imageUri: metadataRes.uri,
          startingPriceLamports,
          commitDurationSeconds: commitHours * 3600,
          revealDurationSeconds: revealHours * 3600,
          inspectionDurationSeconds: Number(inspectionDurationSec),
        });
        const auctionPda = new PublicKey(compiled.accounts[0].pubkey);
        const instruction = new TransactionInstruction({
          programId,
          keys: compiled.accounts.map((a) => ({ pubkey: new PublicKey(a.pubkey), isSigner: a.isSigner, isWritable: a.isWritable })),
          data: Buffer.from(compiled.data),
        });
        const connection = new Connection(process.env.NEXT_PUBLIC_SOLANA_RPC || 'https://api.devnet.solana.com', 'confirmed');
        setStatusStep('Preparing Solana Devnet transaction...');
        const latestBlockhash = await connection.getLatestBlockhash('confirmed');
        const transaction = new Transaction({ feePayer: seller, ...latestBlockhash }).add(instruction);
        setStatusStep('Confirm the auction transaction in your Solana wallet...');
        const signed = await provider.signTransaction(transaction) as Transaction;
        const signature = await connection.sendRawTransaction(signed.serialize(), { preflightCommitment: 'confirmed' });
        const confirmation = await connection.confirmTransaction({ signature, ...latestBlockhash }, 'confirmed');
        if (confirmation.value.err) throw new Error('Solana auction transaction failed on Devnet.');

        setCreatedAuctionId(auctionId.toString());
        setCreatedAuctionAddress(auctionPda.toBase58());
        setCreatedChain('solana');
        setTxHash(signature);
        if (datasetInfo) {
          try {
            setStatusStep('Sign with Phantom to link the encrypted asset...');
            await linkAssetToAuction(auctionId.toString(), 'solana:devnet', seller.toBase58());
            setAssetLinkWarning(null);
          } catch (linkError) {
            console.error('Failed to link asset to Solana auction', linkError);
            setAssetLinkWarning('The auction was created, but the encrypted asset could not be linked. Do not accept bids until this is fixed.');
          }
        }
        return;
      }

      // STEP 2: Create Auction Smart Contract Transaction
      if (!address) throw new Error('Wallet not connected.');
      setStatusStep('Simulating transaction...');
      const startingPriceWei = parseEther(startingPrice);

      console.log('Sending to createAuction:', {
        itemName,
        description,
        imageURI: metadataRes.uri,
        startingPrice: startingPriceWei.toString(),
        commitDuration: commitDurationSec.toString(),
        revealDuration: revealDurationSec.toString(),
        inspectionDuration: inspectionDurationSec.toString()
      });

      if (!publicClient) {
        throw new Error('Blockchain client is not available.');
      }

      setStatusStep('Confirm transaction in MetaMask...');
      let hash: `0x${string}`;
      if (assetType === 'nft') {
        const nftAddress = assetDetails.tokenAddress as `0x${string}`;
        const auctionAddress = targetAuctionContract!.address;
        const approvalAbi = [{ type: 'function', name: 'isApprovedForAll', stateMutability: 'view', inputs: [{ name: 'owner', type: 'address' }, { name: 'operator', type: 'address' }], outputs: [{ type: 'bool' }] }, { type: 'function', name: 'setApprovalForAll', stateMutability: 'nonpayable', inputs: [{ name: 'operator', type: 'address' }, { name: 'approved', type: 'bool' }], outputs: [] }] as const;
        const approved = await publicClient.readContract({ address: nftAddress, abi: approvalAbi, functionName: 'isApprovedForAll', args: [address, auctionAddress] });
        if (!approved) {
          setStatusStep('Approve VEILIO to escrow your NFT...');
          const approvalHash = await writeContractAsync({ chainId: targetEvmChainId, address: nftAddress, abi: approvalAbi, functionName: 'setApprovalForAll', args: [auctionAddress, true] });
          await publicClient.waitForTransactionReceipt({ hash: approvalHash });
        }
        const nftArgs = [itemName, description, metadataRes.uri, startingPriceWei, commitDurationSec, revealDurationSec, inspectionDurationSec, assetDetails.tokenStandard === 'ERC-721' ? 1 : 2, nftAddress, BigInt(assetDetails.tokenId), BigInt(assetDetails.tokenAmount)] as const;
        await publicClient.simulateContract({ address: auctionAddress, abi: targetAuctionContract!.abi, functionName: 'createNftAuction', args: nftArgs, account: address });
        hash = await writeContractAsync({ chainId: targetEvmChainId, address: auctionAddress, abi: targetAuctionContract!.abi, functionName: 'createNftAuction', args: nftArgs });
      } else {
        const auctionArgs = [itemName, description, metadataRes.uri, startingPriceWei, commitDurationSec, revealDurationSec, inspectionDurationSec] as const;
        await publicClient.simulateContract({ address: targetAuctionContract!.address, abi: targetAuctionContract!.abi, functionName: 'createAuction', args: auctionArgs, account: address });
        hash = await writeContractAsync({ chainId: targetEvmChainId, address: targetAuctionContract!.address, abi: targetAuctionContract!.abi, functionName: 'createAuction', args: auctionArgs });
      }

      setStatusStep('Waiting for transaction confirmation...');
      const receipt = await publicClient.waitForTransactionReceipt({
        hash,
      });

      if (receipt.status === 'reverted') {
        throw new Error(`Create auction transaction reverted. Check block explorer for tx ${hash}`);
      }

      const auctionCreatedLog = receipt.logs.find((log) => {
        try {
          const parsed = decodeEventLog({
            abi: VEIL_V3_ABI,
            data: log.data,
            topics: log.topics,
          });

          return parsed.eventName === 'AuctionCreated';
        } catch {
          return false;
        }
      });

      if (!auctionCreatedLog) {
        throw new Error('AuctionCreated event not found in successful transaction receipt.');
      }

      const parsed = decodeEventLog({
        abi: VEIL_V3_ABI,
        data: auctionCreatedLog.data,
        topics: auctionCreatedLog.topics,
      });

      const auctionId = String(
        (parsed.args as unknown as { auctionId: bigint }).auctionId
      );

      setCreatedAuctionId(auctionId);
      setCreatedAuctionAddress(null);
      setCreatedChain(targetChain);

// Link auctionId to dataset record (could add an API endpoint for this if we want it fully server-side, 
// but for MVP we can just let it exist or add a small API call to update the DB).
// Actually, I'll do a simple fetch to a new endpoint to link them, or just skip linking 
// since the download endpoint can find it if we pass datasetId or rely on auctionId... 
// Wait, the API relies on `getDatasetRecordByAuctionId`. Let's just create an API call here.
try {
  if (!datasetInfo) throw new Error('File-backed asset record is missing');
  await linkAssetToAuction(auctionId, networkIdForTarget(targetChain), address);
} catch(e) {
  console.error('Failed to link asset to auctionId', e);
  if (datasetInfo) setAssetLinkWarning('The auction was created, but the encrypted asset could not be linked. Do not accept bids until this is fixed.');
}

      // STEP 3: Save created auction in local workspace storage
      saveCreatedAuction({
        id: auctionId,
        itemName,
        description,
        imageURI: metadataRes.uri,
        startingPrice,
        commitEndTime: Date.now() + Number(commitDurationSec) * 1000,
        revealEndTime: Date.now() + Number(commitDurationSec + revealDurationSec) * 1000,
        seller: address,
        createdAt: Date.now(),
        networkId: targetChain === 'base' ? 'base:84532' : 'bnb:97',
        chainId: targetEvmChainId,
      });

      setTxHash(hash);
    } catch (err: any) {
      console.error('Create auction error:', err);
      setErrorMsg(err.message || `Failed to submit transaction to ${targetChain === 'solana' ? 'Solana Devnet' : targetChain === 'base' ? 'Base Sepolia' : 'BNB Chain'}.`);
    } finally {
      setIsSubmitting(false);
      setStatusStep(null);
    }
  };

  /** Links the uploaded asset to the created auction, signed by the on-chain seller wallet. */
  async function linkAssetToAuction(auctionId: string, networkId: AuctionNetworkId, seller: string) {
    if (!datasetInfo) throw new Error('File-backed asset record is missing');
    const timestamp = Date.now();
    const message = datasetLinkMessageFor(networkId, { datasetId: datasetInfo.datasetId, auctionId, address: seller, timestamp });
    const signature = await signForNetwork(networkId, message, signMessageAsync);
    const res = await fetch('/api/datasets/link', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ datasetId: datasetInfo.datasetId, auctionId, address: seller, timestamp, signature, network: networkId }),
    });
    if (!res.ok) throw new Error('Could not securely link the uploaded asset to this auction. Contact support before bidders participate.');
  }

  const retryAssetLink = async () => {
    if (!datasetInfo) return;
    try {
      const networkId = networkIdForTarget(createdChain);
      const seller = createdChain === 'solana' ? await connectSolanaWallet() : address;
      if (!seller) throw new Error('Connect the seller wallet first.');
      await linkAssetToAuction(createdAuctionId, networkId, seller);
      setAssetLinkWarning(null);
    } catch (error) {
      console.error('Retry asset link failed:', error);
      setAssetLinkWarning('Asset is still not linked. Please retry the signature or contact support before bidders participate.');
    }
  };

  return (
    <div className="py-16 bg-[#0A0A09]">
      <div className="max-w-3xl mx-auto px-6">
        <div className="mb-10">
          <h1 className="text-4xl sm:text-5xl font-extrabold tracking-tight text-[#F5F2E8] uppercase">
            CREATE ASSET AUCTION
          </h1>
          <p className="mt-2 text-[#A8A397] text-base">
            List a digital asset for a private sealed-bid auction.
          </p>
          <p className="mt-3 max-w-3xl text-xs leading-5 text-[#A8A397]">
            Your uploaded file stays private. Auction details like the title, description, and price are public on-chain or on IPFS.
          </p>
        </div>

        {!mounted || !isConnected ? (
          <div className="p-8 rounded-2xl bg-[#151512] border border-white/10 text-center space-y-4">
            <p className="text-[#F5F2E8] text-sm">Please connect your wallet to create an auction.</p>
            <WalletButton />
          </div>
        ) : txHash ? (
          <div className="p-8 rounded-2xl bg-[#C9A45C]/10 border border-[#C9A45C]/30 space-y-6">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-[#C9A45C] text-[#0A0A09] flex items-center justify-center font-bold">
                ✓
              </div>
              <div>
                <h3 className="text-lg font-bold text-[#F5F2E8]">Auction created successfully.</h3>
                <p className="text-xs text-[#A8A397]">Auction ID #{createdAuctionId} • {createdChain === 'solana' ? 'Solana Devnet' : createdChain === 'base' ? 'Base Sepolia' : 'BNB Chain Testnet'}</p>
              </div>
            </div>

            <div className="p-4 rounded-xl bg-[#0A0A09] border border-white/10 space-y-2 text-xs font-mono">
              <div className="text-[#A8A397]">Transaction Hash:</div>
              <div className="text-[#C9A45C] break-all">{txHash}</div>
            </div>
            {assetLinkWarning && <div className={`p-4 border text-sm flex flex-wrap items-center justify-between gap-3 ${createdChain === 'solana' ? 'border-amber-500/25 bg-amber-500/[0.06] text-amber-200' : 'border-rose-500/30 bg-rose-500/10 text-rose-300'}`}><span>{assetLinkWarning}</span>{createdChain === 'bnb' && <button type="button" onClick={retryAssetLink} className="px-4 py-2 border border-rose-300/30 uppercase tracking-wider text-xs">Retry secure link</button>}</div>}

            <div className="flex flex-wrap gap-4 pt-2">
              <Link
                href={`/auctions/${createdAuctionId}${createdChain === 'solana' ? '?network=solana' : createdChain === 'base' ? '?network=base' : ''}`}
                className="px-6 py-3 text-xs font-bold uppercase tracking-wider rounded-xl bg-[#C9A45C] text-[#0A0A09] hover:bg-[#E6CC91] transition-colors"
              >
                View auction &rarr;
              </Link>
              {createdChain === 'solana' && createdAuctionAddress && (
                <a
                  href={`https://explorer.solana.com/address/${createdAuctionAddress}?cluster=devnet`}
                  target="_blank"
                  rel="noreferrer"
                  className="px-6 py-3 text-xs font-bold uppercase tracking-wider rounded-xl bg-white/[0.04] border border-white/10 text-[#F5F2E8] hover:bg-white/[0.08] transition-colors"
                >
                  View Solana account &rarr;
                </a>
              )}
              <button
                onClick={() => {
                  const shareUrl = `${window.location.origin}/auctions/${createdAuctionId}${createdChain === 'solana' ? '?network=solana' : createdChain === 'base' ? '?network=base' : ''}`;
                  void navigator.clipboard.writeText(shareUrl);
                  alert('Auction link copied to clipboard!');
                }}
                className="px-6 py-3 text-xs font-bold uppercase tracking-wider rounded-xl bg-white/[0.04] border border-white/10 text-[#F5F2E8] hover:bg-white/[0.08] transition-colors"
              >
                Share auction
              </button>
              <a
                href={createdChain === 'solana' ? `https://explorer.solana.com/tx/${txHash}?cluster=devnet` : `${createdChain === 'base' ? baseSepoliaChain.blockExplorers.default.url : bnbChain.blockExplorers.default.url}/tx/${txHash}`}
                target="_blank"
                rel="noreferrer"
                className="px-6 py-3 text-xs font-bold uppercase tracking-wider rounded-xl bg-transparent text-[#A8A397] hover:text-[#F5F2E8] transition-colors"
              >
                View on Explorer
              </a>
            </div>
          </div>
        ) : (
          <form onSubmit={handleCreate} className="p-8 rounded-2xl bg-[#151512] border border-white/10 space-y-6">

            <div className="space-y-3">
              <label className="block text-[11px] uppercase tracking-widest text-[#A8A397]">Listing network</label>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <button type="button" onClick={() => { if (uploadFamily === 'solana') { setDatasetInfo(null); setDatasetFile(null); setUploadFamily(null); } setTargetChain('bnb'); }} className={`rounded-xl border p-4 text-left transition ${targetChain === 'bnb' ? 'border-[#C9A45C]/50 bg-[#C9A45C]/[0.07]' : 'border-white/10 bg-[#0A0A09] hover:border-white/20'}`}>
                  <span className="block text-sm font-semibold text-[#F5F2E8]">BNB Chain Testnet</span><span className="mt-1 block text-xs text-[#89867D]">Pay and sign with your EVM wallet · BNB</span>
                </button>
                <button type="button" onClick={() => { if (uploadFamily === 'solana') { setDatasetInfo(null); setDatasetFile(null); setUploadFamily(null); } setTargetChain('base'); }} className={`rounded-xl border p-4 text-left transition ${targetChain === 'base' ? 'border-blue-400/50 bg-blue-400/[0.07]' : 'border-white/10 bg-[#0A0A09] hover:border-white/20'}`}>
                  <span className="block text-sm font-semibold text-[#F5F2E8]">Base Sepolia</span><span className="mt-1 block text-xs text-[#89867D]">Chain 84532 · ETH</span>
                </button>
                <button type="button" onClick={() => { if (uploadFamily === 'evm') { setDatasetInfo(null); setDatasetFile(null); setUploadFamily(null); } setTargetChain('solana'); setSolanaLimitAcknowledged(false); if (assetType === 'nft') setAssetType('dataset'); }} className={`rounded-xl border p-4 text-left transition ${targetChain === 'solana' ? 'border-[#8B7BFF]/50 bg-[#8B7BFF]/[0.07]' : 'border-white/10 bg-[#0A0A09] hover:border-white/20'}`}>
                  <span className="block text-sm font-semibold text-[#F5F2E8]">Solana Devnet</span><span className="mt-1 block text-xs text-[#89867D]">Pay and sign with Phantom · SOL</span>
                </button>
              </div>
              {targetChain !== 'solana' && chainId !== targetEvmChainId && <button type="button" onClick={() => switchChain?.({ chainId: targetEvmChainId })} className="rounded-lg border border-amber-400/25 px-3 py-2 text-xs font-semibold text-amber-200">Switch wallet to {targetChain === 'base' ? 'Base Sepolia' : 'BNB Chain Testnet'}</button>}
              {targetChain === 'base' && <p className="rounded-lg border border-blue-400/20 bg-blue-400/[0.05] px-3 py-2.5 text-xs leading-5 text-blue-100">Base Sepolia supports NFT escrow and encrypted file delivery, settled by the VeilNFTV4 contract on chain 84532.</p>}
              {targetChain === 'solana' && <p className="rounded-lg border border-[#8B7BFF]/15 bg-[#8B7BFF]/[0.04] px-3 py-2.5 text-xs leading-5 text-[#B9B2D8]">Phantom authorizes the encrypted asset upload, signs the Solana auction transaction and pays its Devnet fees. Use the same Phantom account for the upload and the listing.</p>}
            </div>

            <div className="space-y-3">
              <label className="block text-[11px] uppercase tracking-widest text-[#A8A397]">Digital asset type</label>
              <select value={assetType} onChange={(e) => { setAssetType(e.target.value as typeof assetType); setDatasetFile(null); setDatasetInfo(null); setPublishSamplePreview(false); setErrorMsg(null); }} className="w-full px-4 py-3 bg-[#0A0A09] border border-white/10 text-[#F5F2E8]">
                <option value="dataset">Datasets (AI Training, Tabular, CSV, Parquet)</option>
                <option value="ai-model">AI Models & Weights (Safetensors, GGUF, LoRA)</option>
                <option value="data-license">Data Licenses (Commercial / Research Rights)</option>
                <option value="api-license">API Access Pass / Credential Quota</option>
                <option value="software-license">Software License / Enterprise Core</option>
                <option value="nft" disabled={targetChain === 'solana'}>NFT Escrow (BNB / Base · ERC-721 / ERC-1155){targetChain === 'solana' ? ' — EVM only' : ''}</option>
                <option value="digital-asset">General Digital Asset</option>
              </select>
              {assetType === 'nft' ? <>
              <div className="grid sm:grid-cols-4 gap-3"><select value={assetDetails.tokenStandard} onChange={e => setAssetDetails({...assetDetails,tokenStandard:e.target.value,tokenAmount:e.target.value === 'ERC-721' ? '1' : assetDetails.tokenAmount})} className="px-3 py-3 bg-[#0A0A09] border border-white/10 text-[#F5F2E8]"><option>ERC-721</option><option>ERC-1155</option></select><input required placeholder="NFT contract address" value={assetDetails.tokenAddress} onChange={e=>setAssetDetails({...assetDetails,tokenAddress:e.target.value})} className="px-3 py-3 bg-[#0A0A09] border border-white/10 text-[#F5F2E8]"/><input required placeholder="Token ID" value={assetDetails.tokenId} onChange={e=>setAssetDetails({...assetDetails,tokenId:e.target.value})} className="px-3 py-3 bg-[#0A0A09] border border-white/10 text-[#F5F2E8]"/><input required type="number" min="1" step="1" disabled={assetDetails.tokenStandard === 'ERC-721'} placeholder="Amount" value={assetDetails.tokenAmount} onChange={e=>setAssetDetails({...assetDetails,tokenAmount:e.target.value})} className="px-3 py-3 bg-[#0A0A09] border border-white/10 text-[#F5F2E8] disabled:opacity-50"/></div>
                <p className="text-xs text-amber-300">{targetChain === 'base' || VEIL_V4_CONTRACT_ADDRESS ? 'NFT transfers into VEILIO escrow during listing. After the inspection period ends, anyone (including you or the winner) can press “Finalize settlement” on the auction page to deliver the NFT and pay you.' : 'NFT escrow requires VEILIO V4 deployment and NEXT_PUBLIC_V4_CONTRACT_ADDRESS configuration before creating NFT listings.'}</p>
              </> : null}
              {assetType === 'software-license' ? <div className="grid gap-3"><input placeholder="License type" value={assetDetails.licenseType} onChange={e=>setAssetDetails({...assetDetails,licenseType:e.target.value})} className="px-3 py-3 bg-[#0A0A09] border border-white/10 text-[#F5F2E8]"/><textarea placeholder="Post-settlement access instructions (never enter a secret license key here)" value={assetDetails.accessInstructions} onChange={e=>setAssetDetails({...assetDetails,accessInstructions:e.target.value})} className="px-3 py-3 bg-[#0A0A09] border border-white/10 text-[#F5F2E8]"/></div> : null}
            </div>

            {/* DATASET UPLOAD - HERO */}
            <div className="space-y-4">
              {assetType !== 'nft' && <p className="text-xs leading-5 text-[#A8A397]">
                Files are temporarily decrypted for a malware check by Verisys, then stored encrypted. Only upload data you’re authorized to share.
              </p>}
              
              {assetType === 'nft' ? <p className="p-5 border border-white/10 text-sm text-[#A8A397]">NFT listing uses the token contract and token ID above; no file upload is needed.</p> : !datasetInfo ? (
                <div className="relative p-12 border border-dashed border-[#A8A397]/40 hover:border-[#C9A45C] rounded-none bg-[#0A0A09] transition-all flex flex-col items-center justify-center text-center space-y-4">
                  <div className="text-[#F5F2E8] text-xl font-bold uppercase tracking-wider">
                    {isUploadingDataset ? 'Encrypting asset...' : 'Drop Digital Asset Here'}
                  </div>
                  {!isUploadingDataset && (
                    <div className="text-[#A8A397] text-sm">or browse files</div>
                  )}
                  <div className="text-[#C9A45C] text-xs font-bold uppercase tracking-widest mt-4">
                    CSV / JSON / PARQUET (datasets) or any digital file
                  </div>
                  <input
                    type="file"
                    onChange={handleDatasetUpload}
                    disabled={isUploadingDataset}
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer disabled:cursor-wait"
                  />
                  {isUploadingDataset && (
                    <div className="absolute inset-0 bg-[#0A0A09]/80 backdrop-blur-sm flex flex-col items-center justify-center text-[#C9A45C] font-mono text-sm tracking-widest uppercase">
                      <div className="mb-2">Verifying format...</div>
                      <div className="mb-2">Calculating SHA-256...</div>
                      <div>AES-256-GCM Encryption...</div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="p-6 rounded-none bg-[#0A0A09] border border-[#C9A45C]/30 space-y-6">
                  <div className="flex items-center gap-4">
                    <h3 className="text-[#C9A45C] text-lg font-bold uppercase tracking-wider">{assetType === 'dataset' ? 'Dataset Verified' : 'Asset Encrypted'}</h3>
                  </div>
                  
                  <div className="grid grid-cols-2 gap-y-4 gap-x-8 text-sm font-mono border-y border-white/10 py-6">
                    <div className="space-y-1">
                      <div className="text-[#A8A397] text-[10px] uppercase tracking-widest">File Type</div>
                      <div className="text-[#F5F2E8] truncate">{assetType === 'dataset' ? (datasetInfo.manifest?.format || 'Unknown') : datasetInfo.fileName.split('.').pop()?.toUpperCase()}</div>
                    </div>
                    <div className="space-y-1">
                      <div className="text-[#A8A397] text-[10px] uppercase tracking-widest">File Size</div>
                      <div className="text-[#F5F2E8]">{(datasetInfo.size / 1024 / 1024).toFixed(2)} MB</div>
                    </div>
                    {assetType === 'dataset' && <div className="space-y-1">
                      <div className="text-[#A8A397] text-[10px] uppercase tracking-widest">Records</div>
                      <div className="text-[#F5F2E8] truncate">{datasetInfo.manifest?.format === 'PARQUET' ? 'Not analyzed' : datasetInfo.manifest?.recordCount ?? 0}</div>
                    </div>}
                    {assetType === 'dataset' && <div className="space-y-1">
                      <div className="text-[#A8A397] text-[10px] uppercase tracking-widest">Columns</div>
                      <div className="text-[#F5F2E8]">{datasetInfo.manifest?.format === 'PARQUET' ? 'Not analyzed' : datasetInfo.manifest?.columnCount ?? 0}</div>
                    </div>}
                    <div className="space-y-1 col-span-2">
                      <div className="text-[#A8A397] text-[10px] uppercase tracking-widest">SHA-256 Hash</div>
                      <div className="text-[#F5F2E8] text-xs break-all">{datasetInfo.fileHashHex}</div>
                    </div>
                  </div>
                  <div className="text-xs text-[#A8A397] mt-2">
                    <p><strong>Note:</strong> {assetType !== 'dataset' ? 'The uploaded file hash is recorded as the content integrity reference.' : datasetInfo.manifest?.format === 'PARQUET' ? 'Parquet is encrypted and integrity-checked; schema and record counts are not analyzed yet.' : 'Dataset inspection stats are part of the listing baseline.'}</p>
                  </div>

                  {assetType === 'dataset' && datasetInfo.manifest?.sample?.length ? (
                    <label className="flex items-start gap-3 p-4 border border-white/10 bg-[#151512] cursor-pointer">
                      <input type="checkbox" checked={publishSamplePreview} onChange={(event) => setPublishSamplePreview(event.target.checked)} className="mt-1 accent-[#C9A45C]" />
                      <span className="space-y-1">
                        <span className="block text-sm text-[#F5F2E8]">Show a sample before bidding</span>
                        <span className="block text-xs leading-5 text-[#A8A397]">Up to 10 rows and the first 50 column names become public with the listing and may remain on IPFS. Keep sensitive information out of the sample; the full dataset stays private.</span>
                      </span>
                    </label>
                  ) : null}

                  <div className="bg-[#151512] p-4 border border-[#C9A45C]/20 text-center">
                    <h4 className="text-[#E6CC91] font-bold text-sm uppercase tracking-widest mb-1">Encrypted ✓</h4>
                    <p className="text-[#A8A397] text-xs font-mono mb-2">AES-256-GCM</p>
                    <p className="text-[#F5F2E8] text-xs font-bold uppercase tracking-widest bg-rose-500/10 text-rose-400 py-2">
                      Full asset locked until auction settlement
                    </p>
                  </div>

                  <button type="button" onClick={() => { setDatasetInfo(null); setDatasetFile(null); setPublishSamplePreview(false); }} className="text-[10px] uppercase tracking-widest text-[#A8A397] hover:text-white transition-colors">
                    Remove & Upload Different File
                  </button>
                </div>
              )}
            </div>

            {/* DATASET INFORMATION */}
            <div className="pt-8 border-t border-white/5 space-y-6">
              <h2 className="text-lg font-bold uppercase tracking-wider text-[#F5F2E8]">Asset Information</h2>
              
              <div className="space-y-2">
                <label className="block text-[11px] uppercase tracking-widest text-[#A8A397]">Asset Name</label>
                <input
                  type="text"
                  required
                  value={itemName}
                  onChange={(e) => setItemName(e.target.value)}
                  placeholder="Name this digital asset"
                  className="w-full px-4 py-3 bg-[#0A0A09] border border-white/10 rounded-none text-[#F5F2E8] focus:outline-none focus:border-[#C9A45C] transition-colors text-sm"
                />
              </div>

              <div className="space-y-2">
                <label className="block text-[11px] uppercase tracking-widest text-[#A8A397]">Description</label>
                <textarea
                  required
                  rows={4}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Describe the asset, usage rights, and delivery terms..."
                  className="w-full px-4 py-3 bg-[#0A0A09] border border-white/10 rounded-none text-[#F5F2E8] focus:outline-none focus:border-[#C9A45C] transition-colors text-sm"
                />
              </div>

              {/* PROFESSIONAL METADATA & RIGHTS: relevant to datasets and AI models */}
              {usesProfessionalMetadata && <div className="pt-6 border-t border-white/10 space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-sm font-bold uppercase tracking-wider text-[#E6CC91]">Professional Metadata & Rights</h3>
                    <p className="text-xs text-[#A8A397]">Machine-readable specifications for autonomous agents and institutional buyers.</p>
                  </div>
                  <label className="flex items-center gap-2 cursor-pointer text-xs text-[#F5F2E8]">
                    <input
                      type="checkbox"
                      checked={agentCompatible}
                      onChange={(e) => setAgentCompatible(e.target.checked)}
                      className="accent-[#C9A45C]"
                    />
                    <span className="font-mono text-[#C9A45C] font-semibold text-[11px] uppercase tracking-wider">AI-Agent Compatible</span>
                  </label>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="block text-[10px] uppercase tracking-widest text-[#A8A397]">License Type</label>
                    <select
                      value={licenseType}
                      onChange={(e) => setLicenseType(e.target.value as typeof licenseType)}
                      className="w-full px-3 py-2.5 bg-[#0A0A09] border border-white/10 text-[#F5F2E8] text-xs"
                    >
                      <option value="commercial_use">Commercial Use</option>
                      <option value="academic_or_research">Academic / Research Only</option>
                      <option value="exclusive_transfer">Exclusive Ownership Transfer</option>
                    </select>
                  </div>

                  <div className="space-y-1">
                    <label className="block text-[10px] uppercase tracking-widest text-[#A8A397]">Format Specification</label>
                    <input
                      type="text"
                      value={formatSpec}
                      onChange={(e) => setFormatSpec(e.target.value)}
                      placeholder="e.g. Parquet, GGUF, OpenAPI Key, Docker"
                      className="w-full px-3 py-2.5 bg-[#0A0A09] border border-white/10 text-[#F5F2E8] text-xs font-mono"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="block text-[10px] uppercase tracking-widest text-[#A8A397]">Geographic Region</label>
                    <input
                      type="text"
                      value={region}
                      onChange={(e) => setRegion(e.target.value)}
                      placeholder="e.g. Global, Southeast Asia, US"
                      className="w-full px-3 py-2.5 bg-[#0A0A09] border border-white/10 text-[#F5F2E8] text-xs"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="block text-[10px] uppercase tracking-widest text-[#A8A397]">Primary Language</label>
                    <input
                      type="text"
                      value={language}
                      onChange={(e) => setLanguage(e.target.value)}
                      placeholder="e.g. Multilingual, English, Indonesian"
                      className="w-full px-3 py-2.5 bg-[#0A0A09] border border-white/10 text-[#F5F2E8] text-xs"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="block text-[10px] uppercase tracking-widest text-[#A8A397]">Data Period / Checkpoint</label>
                    <input
                      type="text"
                      value={dataPeriod}
                      onChange={(e) => setDataPeriod(e.target.value)}
                      placeholder="e.g. 2024 - 2026, Q1 2026 Checkpoint"
                      className="w-full px-3 py-2.5 bg-[#0A0A09] border border-white/10 text-[#F5F2E8] text-xs"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="block text-[10px] uppercase tracking-widest text-[#A8A397]">Update Frequency</label>
                    <select
                      value={updateFrequency}
                      onChange={(e) => setUpdateFrequency(e.target.value as typeof updateFrequency)}
                      className="w-full px-3 py-2.5 bg-[#0A0A09] border border-white/10 text-[#F5F2E8] text-xs"
                    >
                      <option value="one_time">One-time Snapshot</option>
                      <option value="monthly">Monthly Recurring</option>
                      <option value="streaming">Real-time / Streaming Access</option>
                    </select>
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="block text-[10px] uppercase tracking-widest text-[#A8A397]">Usage Rights & Terms</label>
                  <input
                    type="text"
                    value={usageRights}
                    onChange={(e) => setUsageRights(e.target.value)}
                    placeholder="e.g. Commercial redistribution permitted with attribution"
                    className="w-full px-3 py-2.5 bg-[#0A0A09] border border-white/10 text-[#F5F2E8] text-xs"
                  />
                </div>

                <div className="space-y-1">
                  <label className="block text-[10px] uppercase tracking-widest text-[#A8A397]">Technical Schema / Specification (Optional)</label>
                  <textarea
                    rows={2}
                    value={schemaOrSpec}
                    onChange={(e) => setSchemaOrSpec(e.target.value)}
                    placeholder="e.g. Columns: timestamp, user_id, action, latency_ms (or Model arch details)"
                    className="w-full px-3 py-2.5 bg-[#0A0A09] border border-white/10 text-[#F5F2E8] text-xs font-mono"
                  />
                </div>
              </div>}
            </div>

            {/* DATASET COVER */}
            <div className="pt-8 border-t border-white/5 space-y-6">
              <div>
                <h2 className="text-lg font-bold uppercase tracking-wider text-[#F5F2E8]">Product Cover</h2>
                <p className="text-xs text-[#A8A397] mt-1">Optional cover image for this listing. JPG, PNG or WebP · Max 5 MB</p>
              </div>
              <ImageUploader
                onUploadSuccess={(res) => setIpfsImageRes(res)}
                onImageRemoved={() => setIpfsImageRes(null)}
              />
            </div>

            {/* AUCTION TERMS */}
            <div className="pt-8 border-t border-white/5 space-y-6">
              <h2 className="text-lg font-bold uppercase tracking-wider text-[#F5F2E8]">Auction Terms</h2>
              
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
                <div className="space-y-2">
                    <label className="block text-[11px] uppercase tracking-widest text-[#A8A397]">Starting price ({targetChain === 'solana' ? 'SOL' : targetChain === 'base' ? 'ETH' : 'BNB'})</label>
                  <input
                    type="number"
                    required
                    min={targetChain === 'solana' ? '0.000000001' : '0.00001'}
                    step={targetChain === 'solana' ? '0.000000001' : '0.00001'}
                    value={startingPrice}
                    onChange={(e) => setStartingPrice(e.target.value)}
                    className="w-full px-4 py-3 bg-[#0A0A09] border border-white/10 rounded-none text-[#F5F2E8] focus:outline-none focus:border-[#C9A45C] transition-colors text-sm font-mono"
                  />
                </div>

                <div className="space-y-2">
                  <label className="block text-[11px] uppercase tracking-widest text-[#A8A397]">Commit Duration</label>
                  <div className="flex border border-white/10 bg-[#0A0A09] focus-within:border-[#C9A45C] transition-colors">
                    <input
                      type="number"
                      required
                      min="1"
                      value={commitDuration}
                      onChange={(e) => setCommitDuration(e.target.value)}
                      className="min-w-0 flex-1 px-4 py-3 bg-transparent text-[#F5F2E8] focus:outline-none text-sm font-mono"
                    />
                    <div className="flex items-center px-4 bg-transparent text-[#A8A397] text-sm font-bold uppercase tracking-widest border-l border-white/10 select-none">
                      HOURS
                    </div>
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="block text-[11px] uppercase tracking-widest text-[#A8A397]">Reveal Duration</label>
                  <div className="flex border border-white/10 bg-[#0A0A09] focus-within:border-[#C9A45C] transition-colors">
                    <input
                      type="number"
                      required
                      min="1"
                      value={revealDuration}
                      onChange={(e) => setRevealDuration(e.target.value)}
                      className="min-w-0 flex-1 px-4 py-3 bg-transparent text-[#F5F2E8] focus:outline-none text-sm font-mono"
                    />
                    <div className="flex items-center px-4 bg-transparent text-[#A8A397] text-sm font-bold uppercase tracking-widest border-l border-white/10 select-none">
                      HOURS
                    </div>
                  </div>
                </div>
              </div>
              <div className="space-y-2">
                <label htmlFor="inspection-duration" className="block text-[11px] uppercase tracking-widest text-[#A8A397]">Inspection period</label>
                <select
                  id="inspection-duration"
                  value={inspectionHours}
                  onChange={(e) => setInspectionHours(Number(e.target.value))}
                  className="w-full px-4 py-3 bg-[#0A0A09] border border-white/10 text-[#F5F2E8] text-sm font-mono"
                >
                  {INSPECTION_HOUR_OPTIONS.map((hours) => (
                    <option key={hours} value={hours}>{inspectionLabel(hours)}{hours === DEFAULT_INSPECTION_HOURS ? ' (recommended)' : ''}</option>
                  ))}
                </select>
                <p className="text-xs leading-5 text-[#89867D]">After settlement the winner has this long to inspect the asset and request a refund. When it ends, anyone can finalize payment to you.</p>
              </div>
              {targetChain === 'solana' ? <>
                <div className="space-y-2">
                  <label className="block text-[11px] uppercase tracking-widest text-[#A8A397]">{PLATFORM_SOLANA_REVIEWER ? 'Refund reviewer (VEILIO platform)' : 'Independent reviewer wallet'}</label>
                  {PLATFORM_SOLANA_REVIEWER ? (
                    <>
                      <input type="text" readOnly value={PLATFORM_SOLANA_REVIEWER} className="w-full px-4 py-3 bg-[#0A0A09] border border-white/10 text-[#A8A397] font-mono text-xs" />
                      <p className="text-xs leading-5 text-[#89867D]">Refund disputes on Solana are reviewed by the VEILIO platform reviewer. Sellers cannot choose the reviewer.</p>
                    </>
                  ) : (
                    <>
                      <input type="text" required value={solanaReviewerInput} onChange={(event) => setSolanaReviewer(event.target.value.trim())} placeholder="Solana public key (must differ from seller)" className="w-full px-4 py-3 bg-[#0A0A09] border border-white/10 text-[#F5F2E8] font-mono text-xs" />
                      <p className="text-xs leading-5 text-amber-300">No platform reviewer is configured (NEXT_PUBLIC_SOLANA_AUCTION_REVIEWER). The wallet you enter decides refund disputes; bidders should only trust listings whose reviewer is independent from the seller.</p>
                    </>
                  )}
                </div>
                <p className="border border-[#8B7BFF]/20 bg-[#8B7BFF]/[0.05] px-4 py-3 text-xs leading-5 text-[#B9B2D8]">Solana auction bids and settlement are denominated in SOL. Successful sales pay a 7% platform fee; unrevealed bids have no additional penalty. NFT escrow is not available on Solana.</p>
                <label className="flex items-start gap-2.5 text-xs leading-5 text-[#A8A397]">
                  <input type="checkbox" checked={solanaLimitAcknowledged} onChange={(event) => setSolanaLimitAcknowledged(event.target.checked)} className="mt-1 accent-[#8B7BFF]" />
                  <span>I understand this creates an auction account on Solana Devnet (test network) and that refund disputes are decided by the reviewer shown above, with a 7-day timeout that returns the escrow to the winner.</span>
                </label>
              </> : <p className="border border-[#C9A45C]/20 bg-[#C9A45C]/5 px-4 py-3 text-xs leading-5 text-[#A8A397]">
                Successful sales pay a 7% VEILIO fee from the winning bid. The remaining 93% is credited to the seller for withdrawal. The active contract uses first-price settlement: the winner pays their revealed bid. Bidders who do not reveal lose 5% of their deposit on EVM networks.
              </p>}
            </div>

            {/* REVIEW SECTION */}
            {(datasetInfo || assetType === 'nft') && itemName && description && (
              <div className="pt-8 border-t border-white/5 space-y-6">
                <h2 className="text-lg font-bold uppercase tracking-wider text-[#F5F2E8]">Review Auction</h2>
                
                <div className="p-6 bg-[#0A0A09] border border-white/10 space-y-4">
                  <div>
                    <div className="text-[#A8A397] text-[10px] uppercase tracking-widest">{assetType}</div>
                    <div className="text-[#F5F2E8] font-bold text-base mt-1">{itemName}</div>
                    <div className="text-[#A8A397] text-xs font-mono mt-1">{datasetInfo ? `${(datasetInfo.size / 1024 / 1024).toFixed(2)} MB · ${datasetInfo.fileName}` : `${assetDetails.tokenStandard} · ${assetDetails.tokenAddress} · Token #${assetDetails.tokenId} · Amount ${assetDetails.tokenAmount}`}</div>
                  </div>
                  
                  {datasetInfo && <div className="pt-4 border-t border-white/5 space-y-2">
                    <div className="text-[#A8A397] text-[10px] uppercase tracking-widest">Security</div>
                    <div className="text-[#C9A45C] text-xs font-mono">✓ File Verified</div>
                    <div className="text-[#C9A45C] text-xs font-mono">✓ SHA-256 Recorded</div>
                    <div className="text-[#C9A45C] text-xs font-mono">✓ AES-256-GCM Encrypted</div>
                    <div className="text-rose-400 text-xs font-mono">🔒 Locked Until Settlement</div>
                    {assetType === 'dataset' && <div className="text-[#A8A397] text-xs font-mono">{publishSamplePreview ? `✓ ${Math.min(10, datasetInfo.manifest?.recordCount || 0)}-row sample preview enabled` : 'Sample preview disabled'}</div>}
                  </div>}

                  <div className="pt-4 border-t border-white/5 grid grid-cols-2 gap-4">
                    <div>
                      <div className="text-[#A8A397] text-[10px] uppercase tracking-widest">Starting Price</div>
                      <div className="text-[#F5F2E8] text-sm font-mono mt-1">{startingPrice} {targetChain === 'solana' ? 'SOL' : targetChain === 'base' ? 'ETH' : 'BNB'}</div>
                    </div>
                    <div className="col-span-2">
                      <div className="text-[#A8A397] text-[10px] uppercase tracking-widest">Durations</div>
                      <div className="text-[#F5F2E8] font-mono mt-1 text-xs space-y-1">
                        <div>Commit: {commitDuration} HOURS</div>
                        <div>Reveal: {revealDuration} HOURS</div>
                        <div>Inspection: {inspectionLabel(inspectionHours).toUpperCase()}</div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {errorMsg && (
              <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs font-mono mt-8 mb-4">
                {errorMsg}
              </div>
            )}

            <button
              type="submit"
              disabled={isSubmitting || (!datasetInfo && assetType !== 'nft') || (targetChain === 'solana' && assetType === 'nft')}
              className="w-full py-5 text-sm font-bold uppercase tracking-widest rounded-none bg-[#C9A45C] text-[#0A0A09] hover:bg-[#E6CC91] active:scale-[0.99] transition-all duration-200 disabled:opacity-50 mt-4"
            >
              {isSubmitting
                ? statusStep || 'Creating auction...'
                : 'Create Auction'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
