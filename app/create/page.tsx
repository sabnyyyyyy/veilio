'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useAccount, useWriteContract, usePublicClient, useSignMessage } from 'wagmi';
import { parseEther, decodeEventLog, isAddress } from 'viem';
import { VEIL_V3_CONTRACT_ADDRESS, VEIL_V3_ABI, VEIL_V4_CONTRACT_ADDRESS } from '@/lib/contract';
import { saveCreatedAuction } from '@/lib/secretStorage';
import { uploadMetadataToIpfs, IpfsUploadResponse } from '@/lib/ipfs';
import { bnbChain } from '@/lib/chain';
import WalletButton from '@/components/WalletButton';
import ImageUploader from '@/components/ImageUploader';
import { assetUploadMessage, datasetLinkMessage } from '@/lib/assetAuth';
import { sanitizeAssetFileName } from '@/lib/assetPolicy';
import { upload as uploadPrivateBlob } from '@vercel/blob/client';

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

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [statusStep, setStatusStep] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<`0x${string}` | null>(null);
  const [createdAuctionId, setCreatedAuctionId] = useState<string>('1');
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
    if (!isConnected || !address) {
      setErrorMsg('Connect your wallet before uploading an asset.');
      e.target.value = '';
      return;
    }
    setDatasetFile(file);
    setPublishSamplePreview(false);
    setIsUploadingDataset(true);
    setErrorMsg(null);

    try {
      const fileName = sanitizeAssetFileName(file.name);
      const timestamp = Date.now();
      const nonce = crypto.randomUUID();
      const datasetId = crypto.randomUUID();

      if (process.env.NODE_ENV !== 'production') {
        const signature = await signMessageAsync({ message: assetUploadMessage({ address, assetType, fileName, fileSize: file.size, timestamp, nonce }) });
        const formData = new FormData();
        formData.append('file', file);
        formData.append('assetType', assetType);
        formData.append('walletAddress', address);
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
      const signature = await signMessageAsync({ message: assetUploadMessage({ address, assetType, fileName, fileSize: file.size, timestamp, nonce, datasetId, fileHashHex }) });
      const clientPayload = JSON.stringify({
        datasetId,
        walletAddress: address,
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
        const statusResponse = await fetch(`/api/datasets/upload?id=${encodeURIComponent(datasetId)}&address=${encodeURIComponent(address)}`, { cache: 'no-store' });
        const statusData = await statusResponse.json();
        if (statusData.status === 'ready') {
          setDatasetInfo(statusData.dataset);
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

    if (!isConnected || !address) {
      setErrorMsg('Wallet not connected.');
      return;
    }
    if (!VEIL_V3_CONTRACT_ADDRESS) {
      setErrorMsg('V3 contract is not configured in the environment. Please deploy first.');
      return;
    }
    if (assetType === 'nft' && !VEIL_V4_CONTRACT_ADDRESS) {
      setErrorMsg('NFT escrow is not active yet. Deploy the VEILIO V4 contract and configure NEXT_PUBLIC_V4_CONTRACT_ADDRESS first.');
      return;
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

    const commitDurationSec = BigInt(commitHours) * BigInt(3600);
    const revealDurationSec = BigInt(revealHours) * BigInt(3600);
    const inspectionDurationSec = BigInt(3600); // fixed internally to 1 hour

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
          licenseType,
          usageRights,
          format: formatSpec || (datasetInfo?.manifest?.format) || (datasetInfo ? datasetInfo.fileName.split('.').pop()?.toUpperCase() : undefined),
          fileSize: datasetInfo ? `${(datasetInfo.size / (1024 * 1024)).toFixed(2)} MB` : undefined,
          region,
          language,
          dataPeriod,
          updateFrequency,
          schemaOrSpecification: schemaOrSpec || undefined,
          agentCompatible,
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

      // STEP 2: Create Auction Smart Contract Transaction
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
        const approvalAbi = [{ type: 'function', name: 'isApprovedForAll', stateMutability: 'view', inputs: [{ name: 'owner', type: 'address' }, { name: 'operator', type: 'address' }], outputs: [{ type: 'bool' }] }, { type: 'function', name: 'setApprovalForAll', stateMutability: 'nonpayable', inputs: [{ name: 'operator', type: 'address' }, { name: 'approved', type: 'bool' }], outputs: [] }] as const;
        const approved = await publicClient.readContract({ address: nftAddress, abi: approvalAbi, functionName: 'isApprovedForAll', args: [address, VEIL_V3_CONTRACT_ADDRESS] });
        if (!approved) {
          setStatusStep('Approve VEILIO to escrow your NFT...');
          const approvalHash = await writeContractAsync({ address: nftAddress, abi: approvalAbi, functionName: 'setApprovalForAll', args: [VEIL_V3_CONTRACT_ADDRESS, true] });
          await publicClient.waitForTransactionReceipt({ hash: approvalHash });
        }
        const nftArgs = [itemName, description, metadataRes.uri, startingPriceWei, commitDurationSec, revealDurationSec, inspectionDurationSec, assetDetails.tokenStandard === 'ERC-721' ? 1 : 2, nftAddress, BigInt(assetDetails.tokenId), BigInt(assetDetails.tokenAmount)] as const;
        await publicClient.simulateContract({ address: VEIL_V3_CONTRACT_ADDRESS, abi: VEIL_V3_ABI, functionName: 'createNftAuction', args: nftArgs, account: address });
        hash = await writeContractAsync({ address: VEIL_V3_CONTRACT_ADDRESS, abi: VEIL_V3_ABI, functionName: 'createNftAuction', args: nftArgs });
      } else {
        const auctionArgs = [itemName, description, metadataRes.uri, startingPriceWei, commitDurationSec, revealDurationSec, inspectionDurationSec] as const;
        await publicClient.simulateContract({ address: VEIL_V3_CONTRACT_ADDRESS, abi: VEIL_V3_ABI, functionName: 'createAuction', args: auctionArgs, account: address });
        hash = await writeContractAsync({ address: VEIL_V3_CONTRACT_ADDRESS, abi: VEIL_V3_ABI, functionName: 'createAuction', args: auctionArgs });
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

// Link auctionId to dataset record (could add an API endpoint for this if we want it fully server-side, 
// but for MVP we can just let it exist or add a small API call to update the DB).
// Actually, I'll do a simple fetch to a new endpoint to link them, or just skip linking 
// since the download endpoint can find it if we pass datasetId or rely on auctionId... 
// Wait, the API relies on `getDatasetRecordByAuctionId`. Let's just create an API call here.
try {
  if (!datasetInfo) throw new Error('File-backed asset record is missing');
  const linkTimestamp = Date.now();
  const linkMessage = datasetLinkMessage({ datasetId: datasetInfo.datasetId, auctionId, address, timestamp: linkTimestamp });
  const linkSignature = await signMessageAsync({ message: linkMessage });
  const linkRes = await fetch('/api/datasets/link', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ datasetId: datasetInfo.datasetId, auctionId, address, timestamp: linkTimestamp, signature: linkSignature }),
  });
  if (!linkRes.ok) throw new Error('Could not securely link the uploaded asset to this auction. Contact support before bidders participate.');
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
      });

      setTxHash(hash);
    } catch (err: any) {
      console.error('Create auction error:', err);
      setErrorMsg(err.message || 'Failed to submit transaction to BNB Chain.');
    } finally {
      setIsSubmitting(false);
      setStatusStep(null);
    }
  };

  const retryAssetLink = async () => {
    if (!datasetInfo || !address) return;
    try {
      const timestamp = Date.now();
      const message = datasetLinkMessage({ datasetId: datasetInfo.datasetId, auctionId: createdAuctionId, address, timestamp });
      const signature = await signMessageAsync({ message });
      const res = await fetch('/api/datasets/link', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ datasetId: datasetInfo.datasetId, auctionId: createdAuctionId, address, timestamp, signature }) });
      if (!res.ok) throw new Error('Asset link was rejected by the server.');
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
                <p className="text-xs text-[#A8A397]">Auction ID #{createdAuctionId} • BNB Chain Testnet</p>
              </div>
            </div>

            <div className="p-4 rounded-xl bg-[#0A0A09] border border-white/10 space-y-2 text-xs font-mono">
              <div className="text-[#A8A397]">Transaction Hash:</div>
              <div className="text-[#C9A45C] break-all">{txHash}</div>
            </div>
            {assetLinkWarning && <div className="p-4 border border-rose-500/30 bg-rose-500/10 text-sm text-rose-300 flex flex-wrap items-center justify-between gap-3"><span>{assetLinkWarning}</span><button type="button" onClick={retryAssetLink} className="px-4 py-2 border border-rose-300/30 uppercase tracking-wider text-xs">Retry secure link</button></div>}

            <div className="flex flex-wrap gap-4 pt-2">
              <Link
                href={`/auctions/${createdAuctionId}`}
                className="px-6 py-3 text-xs font-bold uppercase tracking-wider rounded-xl bg-[#C9A45C] text-[#0A0A09] hover:bg-[#E6CC91] transition-colors"
              >
                View auction &rarr;
              </Link>
              <button
                onClick={() => {
                  navigator.clipboard.writeText(window.location.origin + `/auctions/${createdAuctionId}`);
                  alert('Auction link copied to clipboard!');
                }}
                className="px-6 py-3 text-xs font-bold uppercase tracking-wider rounded-xl bg-white/[0.04] border border-white/10 text-[#F5F2E8] hover:bg-white/[0.08] transition-colors"
              >
                Share auction
              </button>
              <a
                href={`${bnbChain.blockExplorers.default.url}/tx/${txHash}`}
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
              <label className="block text-[11px] uppercase tracking-widest text-[#A8A397]">Digital asset type</label>
              <select value={assetType} onChange={(e) => { setAssetType(e.target.value as typeof assetType); setDatasetFile(null); setDatasetInfo(null); setPublishSamplePreview(false); setErrorMsg(null); }} className="w-full px-4 py-3 bg-[#0A0A09] border border-white/10 text-[#F5F2E8]">
                <option value="dataset">Datasets (AI Training, Tabular, CSV, Parquet)</option>
                <option value="ai-model">AI Models & Weights (Safetensors, GGUF, LoRA)</option>
                <option value="data-license">Data Licenses (Commercial / Research Rights)</option>
                <option value="api-license">API Access Pass / Credential Quota</option>
                <option value="software-license">Software License / Enterprise Core</option>
                <option value="nft">NFT Escrow (ERC-721 / ERC-1155)</option>
                <option value="digital-asset">General Digital Asset</option>
              </select>
              {assetType === 'nft' ? <>
              <div className="grid sm:grid-cols-4 gap-3"><select value={assetDetails.tokenStandard} onChange={e => setAssetDetails({...assetDetails,tokenStandard:e.target.value,tokenAmount:e.target.value === 'ERC-721' ? '1' : assetDetails.tokenAmount})} className="px-3 py-3 bg-[#0A0A09] border border-white/10 text-[#F5F2E8]"><option>ERC-721</option><option>ERC-1155</option></select><input required placeholder="NFT contract address" value={assetDetails.tokenAddress} onChange={e=>setAssetDetails({...assetDetails,tokenAddress:e.target.value})} className="px-3 py-3 bg-[#0A0A09] border border-white/10 text-[#F5F2E8]"/><input required placeholder="Token ID" value={assetDetails.tokenId} onChange={e=>setAssetDetails({...assetDetails,tokenId:e.target.value})} className="px-3 py-3 bg-[#0A0A09] border border-white/10 text-[#F5F2E8]"/><input required type="number" min="1" step="1" disabled={assetDetails.tokenStandard === 'ERC-721'} placeholder="Amount" value={assetDetails.tokenAmount} onChange={e=>setAssetDetails({...assetDetails,tokenAmount:e.target.value})} className="px-3 py-3 bg-[#0A0A09] border border-white/10 text-[#F5F2E8] disabled:opacity-50"/></div>
                <p className="text-xs text-amber-300">{VEIL_V4_CONTRACT_ADDRESS ? 'NFT transfers into VEILIO escrow during listing. After inspection ends, anyone can trigger automatic delivery to the winner; a keeper service does this for you.' : 'NFT escrow requires VEILIO V4 deployment and NEXT_PUBLIC_V4_CONTRACT_ADDRESS configuration before creating NFT listings.'}</p>
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

              {/* PROFESSIONAL METADATA & RIGHTS */}
              <div className="pt-6 border-t border-white/10 space-y-4">
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
              </div>
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
                  <label className="block text-[11px] uppercase tracking-widest text-[#A8A397]">Starting price (BNB)</label>
                  <input
                    type="number"
                    required
                    min="0.00001"
                    step="0.00001"
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
              <p className="border border-[#C9A45C]/20 bg-[#C9A45C]/5 px-4 py-3 text-xs leading-5 text-[#A8A397]">
                Successful sales pay a 10% VEILIO fee from the winning bid. The remaining 90% is credited to the seller for withdrawal. The active contract uses first-price settlement: the winner pays their revealed bid.
              </p>
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
                      <div className="text-[#F5F2E8] text-sm font-mono mt-1">{startingPrice} BNB</div>
                    </div>
                    <div className="col-span-2">
                      <div className="text-[#A8A397] text-[10px] uppercase tracking-widest">Durations</div>
                      <div className="text-[#F5F2E8] font-mono mt-1 text-xs space-y-1">
                        <div>Commit: {commitDuration} HOURS</div>
                        <div>Reveal: {revealDuration} HOURS</div>
                        <div>Inspection: 1 HOUR</div>
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
              disabled={isSubmitting || (!datasetInfo && assetType !== 'nft')}
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
