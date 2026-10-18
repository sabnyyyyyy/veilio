'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import ServicesNav from '@/components/services/ServicesNav';
import { useAccount, useChainId, useSwitchChain, useSignMessage, useWriteContract, usePublicClient } from 'wagmi';
import {
  Sparkles,
  Bot,
  UserCheck,
  Plus,
  Trash2,
  ArrowLeft,
  Loader2,
  CheckCircle2,
  AlertCircle,
  ExternalLink,
  ShieldCheck,
  Lock,
} from 'lucide-react';
import {
  VEIL_SERVICE_REGISTRY_ABI,
  getServiceRegistryAddress,
} from '@/lib/serviceContract';
import {
  buildCanonicalMetadata,
  hashCanonicalMetadata,
  formatServiceRegistryId,
} from '@/lib/serviceRegistry';
import { createServiceAuthMessage, generateAuthNonce } from '@/lib/serviceAuth';
import { Connection, PublicKey, Transaction, TransactionInstruction } from '@solana/web3.js';
import { createRegisterServiceInstruction, DEFAULT_SOLANA_SERVICE_REGISTRY_PROGRAM_ID, encodeBase58 } from '@/lib/cross-chain/solanaServiceRegistry';

const CATEGORIES = [
  'AI Development',
  'Data Engineering',
  'Smart Contract Audit',
  'Design & Media',
  'Content & Translation',
  'Advisory & Research',
];

export default function CreateServicePage() {
  const router = useRouter();
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const { switchChain } = useSwitchChain();
  const { signMessageAsync } = useSignMessage();
  const { writeContractAsync } = useWriteContract();
  const publicClient = usePublicClient();

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState(CATEGORIES[0]);
  const [price, setPrice] = useState('');
  const [deliveryTime, setDeliveryTime] = useState('3 Days');
  const [sellerType, setSellerType] = useState<'human' | 'agent'>('human');
  const [sellerName, setSellerName] = useState('');
  const [sampleDeliverables, setSampleDeliverables] = useState<string[]>(['']);
  const [listingNetwork, setListingNetwork] = useState<'bnb:97' | 'base:84532' | 'solana:devnet'>('bnb:97');

  // Transaction Lifecycle State
  const [txStage, setTxStage] = useState<'idle' | 'awaiting_signature' | 'awaiting_wallet' | 'mining' | 'verifying' | 'confirmed' | 'failed'>('idle');
  const [txHash, setTxHash] = useState<string | null>(null);
  const [createdServiceId, setCreatedServiceId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const isSolana = listingNetwork === 'solana:devnet';
  const listingChainId = listingNetwork === 'base:84532' ? 84532 : 97;
  const resolvedNetwork = isSolana ? 'solana:devnet' : listingNetwork;
  const listingCurrency = isSolana ? 'SOL' : listingChainId === 84532 ? 'ETH' : 'BNB';
  const listingNetworkName = isSolana ? 'Solana Devnet' : listingChainId === 84532 ? 'Base Sepolia' : 'BNB Chain Testnet';
  const listingExplorer = isSolana ? 'https://explorer.solana.com' : listingChainId === 84532 ? 'https://sepolia.basescan.org' : 'https://testnet.bscscan.com';
  const isWrongChain = !isSolana && isConnected && chainId !== listingChainId;
  const solanaProvider = typeof window !== 'undefined' ? (window as any).phantom?.solana || (window as any).solana : undefined;

  const addDeliverableField = () => {
    setSampleDeliverables([...sampleDeliverables, '']);
  };

  const removeDeliverableField = (index: number) => {
    setSampleDeliverables(sampleDeliverables.filter((_, i) => i !== index));
  };

  const updateDeliverable = (index: number, val: string) => {
    const copy = [...sampleDeliverables];
    copy[index] = val;
    setSampleDeliverables(copy);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    let sellerAddress = isSolana ? solanaProvider?.publicKey?.toString() : address;
    if (isSolana && !sellerAddress && solanaProvider?.connect) {
      const connected = await solanaProvider.connect();
      sellerAddress = connected.publicKey?.toString() || solanaProvider.publicKey?.toString();
    }
    if (!sellerAddress || (!isSolana && !isConnected)) {
      setErrorMessage(`Connect your ${isSolana ? 'Phantom' : 'EVM'} wallet first to publish a service.`);
      return;
    }

    if (isWrongChain) {
      setErrorMessage(`Switch your wallet to ${listingNetworkName} before registering.`);
      return;
    }

    if (!title.trim() || title.trim().length < 5) {
      setErrorMessage('Title must be at least 5 characters long.');
      return;
    }

    if (!description.trim() || description.trim().length < 15) {
      setErrorMessage('Description must be at least 15 characters long.');
      return;
    }

    if (!price || isNaN(Number(price)) || Number(price) <= 0) {
      setErrorMessage(`Please provide a valid positive price in ${listingCurrency}.`);
      return;
    }

    try {
      setTxStage('awaiting_signature');
      setErrorMessage(null);

      const generatedId = `srv-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
      // createdAt is hashed into the on-chain metadata hash and sent to the API, which
      // stores it verbatim so every later verification recomputes the same hash.
      const createdAt = Date.now();
      const resolvedSellerName = sellerName.trim() || (sellerType === 'agent' ? 'Autonomous AI Agent' : 'Verified Specialist');
      const filteredDeliverables = sampleDeliverables.map((s) => s.trim()).filter((s) => s.length > 0);

      // 1. Build canonical metadata and compute SHA-256 hash
      const canonicalMeta = buildCanonicalMetadata({
        id: generatedId,
        seller: sellerAddress,
        sellerType,
        sellerName: resolvedSellerName,
        title: title.trim(),
        description: description.trim(),
        category,
        price: String(Number(price)),
        currency: listingCurrency,
        deliveryTime: deliveryTime.trim(),
        sampleDeliverables: filteredDeliverables,
        createdAt,
      });

      const metadataHash = hashCanonicalMetadata(canonicalMeta);
      const metadataURI = `ipfs://QmServiceMeta-${generatedId}`;

      // 2. Authorize with the selected wallet (EIP-191 or Solana Ed25519).
      const authTimestamp = Date.now();
      const authNonce = generateAuthNonce();
      const authMessage = createServiceAuthMessage({
        action: 'create-service',
        orderId: generatedId,
        address: sellerAddress,
        timestamp: authTimestamp,
        nonce: authNonce,
      });

      let signature: string;
      if (isSolana) {
        if (!solanaProvider?.signMessage || !solanaProvider?.signTransaction) throw new Error('Install Phantom or a compatible Solana wallet with signMessage and signTransaction support.');
        await solanaProvider.connect();
        const signedMessage = await solanaProvider.signMessage(new TextEncoder().encode(authMessage), 'utf8');
        signature = encodeBase58(signedMessage.signature);
      } else {
        signature = await signMessageAsync({ message: authMessage });
      }

      // 3. Prompt On-Chain Transaction in Wallet
      setTxStage('awaiting_wallet');
      const serviceIdBytes32 = formatServiceRegistryId(generatedId);

      let onChainTxHash: string;
      if (isSolana) {
        const seller = new PublicKey(sellerAddress);
        const programId = new PublicKey(process.env.NEXT_PUBLIC_SOLANA_SERVICE_REGISTRY_PROGRAM_ID || DEFAULT_SOLANA_SERVICE_REGISTRY_PROGRAM_ID);
        const ix = createRegisterServiceInstruction({ programId: programId.toBase58(), seller: seller.toBase58(), serviceId: serviceIdBytes32, metadataHash, metadataUri: metadataURI });
        const connection = new Connection(process.env.NEXT_PUBLIC_SOLANA_RPC || 'https://api.devnet.solana.com', 'confirmed');
        const latestBlockhash = await connection.getLatestBlockhash('confirmed');
        const transaction = new Transaction({ feePayer: seller, ...latestBlockhash }).add(new TransactionInstruction({
          programId, keys: ix.accounts.map((account) => ({ pubkey: new PublicKey(account.pubkey), isSigner: account.isSigner, isWritable: account.isWritable })), data: Buffer.from(ix.data),
        }));
        const signedTx = await solanaProvider.signTransaction(transaction) as Transaction;
        onChainTxHash = await connection.sendRawTransaction(signedTx.serialize(), { preflightCommitment: 'confirmed' });
        const confirmation = await connection.confirmTransaction({ signature: onChainTxHash, ...latestBlockhash }, 'confirmed');
        if (confirmation.value.err) throw new Error('Solana service registry transaction failed on Devnet.');
      } else {
        onChainTxHash = await writeContractAsync({
          address: getServiceRegistryAddress(listingChainId), abi: VEIL_SERVICE_REGISTRY_ABI,
          functionName: 'registerService', args: [serviceIdBytes32, metadataHash, metadataURI],
        });
      }

      setTxHash(onChainTxHash);
      setTxStage('mining');

      // 4. Wait for on-chain block confirmation
      if (publicClient && !isSolana) {
        const receipt = await publicClient.waitForTransactionReceipt({ hash: onChainTxHash as `0x${string}` });
        if (receipt.status !== 'success') {
          throw new Error('On-chain service registration transaction failed or reverted.');
        }
      }

      // 5. Synchronize with database only after confirmed on-chain evidence
      setTxStage('verifying');
      const res = await fetch('/api/services', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: generatedId,
          sellerId: sellerAddress,
          sellerType,
          sellerName: resolvedSellerName,
          title: title.trim(),
          description: description.trim(),
          category,
          price: String(Number(price)),
          currency: listingCurrency,
          network: resolvedNetwork,
          createdAt,
          deliveryTime: deliveryTime.trim(),
          sampleDeliverables: filteredDeliverables,
          txHash: onChainTxHash,
          metadataHash,
          metadataURI,
          auth: {
            address: sellerAddress,
            signature,
            timestamp: authTimestamp,
            nonce: authNonce,
          },
        }),
      });

      const data = await res.json();
      if (data.success && data.service) {
        setCreatedServiceId(data.service.id);
        setTxStage('confirmed');
      } else {
        throw new Error(data.error || 'Failed to synchronize service with database.');
      }
    } catch (err: any) {
      console.error('Service registration error:', err);
      const isRejection = err?.message?.includes('User rejected') || err?.code === 4001;
      setErrorMessage(
        isRejection
          ? 'Transaction or signature was rejected in your wallet.'
          : (err?.shortMessage || err?.message || 'Failed to register service on-chain.')
      );
      setTxStage('failed');
    }
  };

  return (
    <div className="w-full pb-20 selection:bg-[#C9A45C]/30">
      <ServicesNav />

      <div className="max-w-3xl mx-auto px-4 sm:px-6 pt-6 sm:pt-8 space-y-8">
        <Link
          href="/services"
          className="inline-flex items-center gap-2 text-xs text-[#A8A397] hover:text-[#C9A45C] transition-colors font-semibold"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          <span>Back to All Services</span>
        </Link>

        {/* Network Mismatch Notice */}
        {isWrongChain && (
          <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-300 flex items-center justify-between gap-4">
            <div className="flex items-center gap-2.5 text-xs">
              <AlertCircle className="w-4 h-4 shrink-0 text-amber-400" />
              <span>
                Your wallet is connected to Chain ID {chainId}. Switch to <strong>{listingNetworkName} ({listingChainId})</strong> to register this service.
              </span>
            </div>
            <button
              onClick={() => switchChain && switchChain({ chainId: listingChainId })}
              className="px-3 py-1.5 bg-amber-500/20 hover:bg-amber-500/30 text-amber-200 border border-amber-500/30 rounded-lg text-xs font-bold uppercase tracking-wider transition-colors shrink-0"
            >
              Switch Network
            </button>
          </div>
        )}

        {/* On-Chain Transaction Lifecycle Banner */}
        {txStage !== 'idle' && (
          <div className={`p-4 rounded-xl border text-xs space-y-2 ${
            txStage === 'confirmed'
              ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-300'
              : txStage === 'failed'
              ? 'bg-rose-500/10 border-rose-500/20 text-rose-300'
              : 'bg-[#C9A45C]/10 border-[#C9A45C]/30 text-[#E6CC91]'
          }`}>
            <div className="flex items-center gap-2 font-bold">
              {txStage === 'confirmed' ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
              ) : txStage === 'failed' ? (
                <AlertCircle className="w-4 h-4 text-rose-400" />
              ) : (
                <Loader2 className="w-4 h-4 animate-spin text-[#C9A45C]" />
              )}
              <span className="uppercase tracking-wider">
                {txStage === 'awaiting_signature' && 'Step 1/3: Awaiting EIP-191 Wallet Authorization'}
                {txStage === 'awaiting_wallet' && 'Step 2/3: Awaiting Registry Transaction Approval'}
                {txStage === 'mining' && 'Step 3/3: Mining On-Chain Registry Transaction'}
                {txStage === 'verifying' && 'Verifying ServiceRegistered Contract Event...'}
                {txStage === 'confirmed' && 'Service Successfully Registered On-Chain!'}
                {txStage === 'failed' && 'Registration Encountered an Error'}
              </span>
            </div>

            <p className="text-[11px] text-[#A8A397]">
              {txStage === 'awaiting_signature' && 'Sign the cryptographic message in your wallet to authorize this listing without spending gas.'}
              {txStage === 'awaiting_wallet' && 'Confirm the registerService transaction in MetaMask or Rabby to anchor your listing ID and metadata hash on-chain.'}
              {txStage === 'mining' && `Transaction submitted to ${listingNetworkName}. Waiting for block inclusion...`}
              {txStage === 'verifying' && 'Validating the ServiceRegistered event logs and synchronizing off-chain registry...'}
              {txStage === 'confirmed' && 'Your service is now verifiable on-chain by buyers and VEILIO AI agents.'}
              {txStage === 'failed' && (errorMessage || 'Please try again.')}
            </p>

            {txHash && (
              <div className="pt-1 flex items-center gap-2">
                <span className="text-[10px] text-[#A8A397]">Transaction Hash:</span>
                <a
                  href={isSolana ? `${listingExplorer}/tx/${txHash}?cluster=devnet` : `${listingExplorer}/tx/${txHash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[#C9A45C] hover:underline font-mono text-[11px] inline-flex items-center gap-1"
                >
                  <span>{txHash.slice(0, 10)}...{txHash.slice(-8)}</span>
                  <ExternalLink className="w-3 h-3" />
                </a>
              </div>
            )}

            {txStage === 'confirmed' && createdServiceId && (
              <div className="pt-2">
                <button
                  onClick={() => router.push(`/services/${createdServiceId}`)}
                  className="px-4 py-2 bg-emerald-500 hover:bg-emerald-600 text-[#0A0A09] rounded-lg text-xs font-bold uppercase tracking-wider transition-colors"
                >
                  View Registered Service →
                </button>
              </div>
            )}
          </div>
        )}

        <div className="p-8 rounded-2xl bg-[#151512] border border-white/5 space-y-8">
          <div className="space-y-2">
            <label className="text-[10px] uppercase tracking-widest text-[#A8A397] font-bold block">Settlement network</label>
            <select value={listingNetwork} onChange={(event) => setListingNetwork(event.target.value as typeof listingNetwork)} className="w-full bg-[#0A0A09] border border-white/10 rounded-xl px-4 py-3 text-sm text-[#F5F2E8]">
              <option value="bnb:97">BNB Chain Testnet · BNB</option>
              <option value="base:84532">Base Sepolia · ETH</option>
              <option value="solana:devnet">Solana Devnet · SOL</option>
            </select>
          </div>
          <div className="space-y-2">
            <div className="inline-flex items-center gap-2 px-3 py-1 bg-[#C9A45C]/10 text-[#C9A45C] border border-[#C9A45C]/20 rounded-full text-xs font-bold uppercase tracking-wider">
              <Sparkles className="w-3.5 h-3.5" />
              <span>On-Chain Verified Service Listing</span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-extrabold text-[#F5F2E8]">
              Publish a Service Listing
            </h1>
            <p className="text-xs text-[#A8A397]">
              Advertise your specialized human skills or autonomous AI agent services. Your listing ID and metadata content hash are anchored on-chain in <strong>VeilServiceRegistry</strong> on {listingNetworkName}.
            </p>
          </div>

          {/* Seller Blockchain Identity Card */}
          <div className="p-4 rounded-xl bg-[#0A0A09] border border-white/5 flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-full bg-[#C9A45C]/10 border border-[#C9A45C]/20 flex items-center justify-center">
                <ShieldCheck className="w-4 h-4 text-[#C9A45C]" />
              </div>
              <div>
                <span className="text-[10px] uppercase font-bold tracking-wider text-[#A8A397] block">
                  Seller Blockchain Identity
                </span>
                <span className="text-xs font-mono text-[#F5F2E8]">
                  {(isSolana ? solanaProvider?.publicKey?.toString() : address) ? `${(isSolana ? solanaProvider?.publicKey?.toString() : address).slice(0, 10)}...${(isSolana ? solanaProvider?.publicKey?.toString() : address).slice(-8)}` : 'Connect Wallet'}
                </span>
              </div>
            </div>
            <div className="text-right">
              <span className="text-[10px] uppercase font-bold tracking-wider text-[#A8A397] block">
                Network
              </span>
              <span className="text-xs font-bold text-[#C9A45C]">
                {listingNetworkName} ({listingChainId})
              </span>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Seller Type Selector */}
            <div className="space-y-2">
              <label className="text-[10px] uppercase tracking-widest text-[#A8A397] font-bold block">
                Seller Identity Type
              </label>
              <div className="grid grid-cols-2 gap-4">
                <button
                  type="button"
                  onClick={() => setSellerType('human')}
                  className={`p-4 rounded-xl border flex items-center gap-3 transition-all ${
                    sellerType === 'human'
                      ? 'bg-[#C9A45C]/10 border-[#C9A45C] text-[#F5F2E8]'
                      : 'bg-[#0A0A09] border-white/5 text-[#A8A397] hover:border-white/10'
                  }`}
                >
                  <UserCheck className={`w-5 h-5 ${sellerType === 'human' ? 'text-[#C9A45C]' : 'text-[#A8A397]'}`} />
                  <div className="text-left">
                    <div className="text-xs font-bold uppercase tracking-wider">Human Specialist</div>
                    <div className="text-[10px] text-[#A8A397]">Professional or Freelancer</div>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => setSellerType('agent')}
                  className={`p-4 rounded-xl border flex items-center gap-3 transition-all ${
                    sellerType === 'agent'
                      ? 'bg-[#C9A45C]/10 border-[#C9A45C] text-[#F5F2E8]'
                      : 'bg-[#0A0A09] border-white/5 text-[#A8A397] hover:border-white/10'
                  }`}
                >
                  <Bot className={`w-5 h-5 ${sellerType === 'agent' ? 'text-[#C9A45C]' : 'text-[#A8A397]'}`} />
                  <div className="text-left">
                    <div className="text-xs font-bold uppercase tracking-wider">AI Agent</div>
                    <div className="text-[10px] text-[#A8A397]">Autonomous Agent Service</div>
                  </div>
                </button>
              </div>
            </div>

            {/* Seller Display Name */}
            <div className="space-y-1.5">
              <label className="text-[10px] uppercase tracking-widest text-[#A8A397] font-bold block">
                {sellerType === 'agent' ? 'Agent Name / Handle' : 'Specialist Name / Brand'}
              </label>
              <input
                type="text"
                value={sellerName}
                onChange={(e) => setSellerName(e.target.value)}
                placeholder={sellerType === 'agent' ? 'e.g. SentinEL Audit Agent v4' : 'e.g. Elena Rostova'}
                className="w-full bg-[#0A0A09] border border-white/10 rounded-xl px-4 py-3 text-xs text-[#F5F2E8] placeholder:text-[#A8A397]/40 focus:outline-none focus:border-[#C9A45C]"
              />
            </div>

            {/* Title */}
            <div className="space-y-1.5">
              <label className="text-[10px] uppercase tracking-widest text-[#A8A397] font-bold block">
                Service Title *
              </label>
              <input
                type="text"
                required
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Comprehensive Smart Contract Security Audit & Slither Scan"
                className="w-full bg-[#0A0A09] border border-white/10 rounded-xl px-4 py-3 text-xs text-[#F5F2E8] placeholder:text-[#A8A397]/40 focus:outline-none focus:border-[#C9A45C]"
              />
            </div>

            {/* Category & Delivery Time */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-[10px] uppercase tracking-widest text-[#A8A397] font-bold block">
                  Category *
                </label>
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  className="w-full bg-[#0A0A09] border border-white/10 rounded-xl px-4 py-3 text-xs text-[#F5F2E8] focus:outline-none focus:border-[#C9A45C]"
                >
                  {CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1.5">
                <label className="text-[10px] uppercase tracking-widest text-[#A8A397] font-bold block">
                  Estimated Delivery Time *
                </label>
                <input
                  type="text"
                  required
                  value={deliveryTime}
                  onChange={(e) => setDeliveryTime(e.target.value)}
                  placeholder="e.g. 3 Days or 48 Hours"
                  className="w-full bg-[#0A0A09] border border-white/10 rounded-xl px-4 py-3 text-xs text-[#F5F2E8] placeholder:text-[#A8A397]/40 focus:outline-none focus:border-[#C9A45C]"
                />
              </div>
            </div>

            {/* Price (BNB) */}
            <div className="space-y-1.5">
              <label className="text-[10px] uppercase tracking-widest text-[#A8A397] font-bold block">
                Base Price in {listingCurrency} (Native Escrow) *
              </label>
              <div className="relative">
                <input
                  type="number"
                  step="0.001"
                  min="0.0001"
                  required
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                  placeholder="0.05"
                  className="w-full bg-[#0A0A09] border border-white/10 rounded-xl pl-4 pr-16 py-3 text-xs text-[#F5F2E8] placeholder:text-[#A8A397]/40 focus:outline-none focus:border-[#C9A45C] font-mono"
                />
                <span className="absolute right-4 top-1/2 -translate-y-1/2 text-xs font-mono font-bold text-[#C9A45C]">
                  {listingChainId === 84532 ? 'ETH' : 'tBNB'}
                </span>
              </div>
            </div>

            {/* Description */}
            <div className="space-y-1.5">
              <label className="text-[10px] uppercase tracking-widest text-[#A8A397] font-bold block">
                Detailed Service Scope & Description *
              </label>
              <textarea
                rows={5}
                required
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Explain the exact deliverables, methodology, tools, and expectations. Content will be hashed and verified on-chain."
                className="w-full bg-[#0A0A09] border border-white/10 rounded-xl p-4 text-xs text-[#F5F2E8] placeholder:text-[#A8A397]/40 focus:outline-none focus:border-[#C9A45C] leading-relaxed"
              />
            </div>

            {/* Sample Deliverables */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <label className="text-[10px] uppercase tracking-widest text-[#A8A397] font-bold block">
                  Sample Deliverable References (IPFS CIDs or URLs)
                </label>
                <button
                  type="button"
                  onClick={addDeliverableField}
                  className="text-xs text-[#C9A45C] hover:underline flex items-center gap-1 font-semibold"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Add Deliverable</span>
                </button>
              </div>

              {sampleDeliverables.map((item, idx) => (
                <div key={idx} className="flex items-center gap-2">
                  <input
                    type="text"
                    value={item}
                    onChange={(e) => updateDeliverable(idx, e.target.value)}
                    placeholder="e.g. ipfs://QmSampleReport... or https://github.com/..."
                    className="flex-1 bg-[#0A0A09] border border-white/10 rounded-xl px-4 py-2.5 text-xs text-[#F5F2E8] placeholder:text-[#A8A397]/40 focus:outline-none focus:border-[#C9A45C]"
                  />
                  {sampleDeliverables.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeDeliverableField(idx)}
                      className="p-2.5 rounded-xl bg-white/5 hover:bg-rose-500/20 text-[#A8A397] hover:text-rose-400 border border-white/5 transition-colors"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              ))}
            </div>

            {/* Action Button */}
            <div className="pt-4 border-t border-white/5 flex flex-col sm:flex-row items-center justify-between gap-4">
              <p className="text-[11px] text-[#A8A397]">
                By registering, you authorize on-chain registry indexing for this listing.
              </p>

              <button
                type="submit"
                disabled={txStage === 'awaiting_signature' || txStage === 'awaiting_wallet' || txStage === 'mining' || txStage === 'verifying' || isWrongChain}
                className="w-full sm:w-auto py-3 px-8 bg-[#C9A45C] hover:bg-[#E6CC91] text-[#0A0A09] text-xs font-bold uppercase tracking-wider rounded-xl transition-all shadow-md flex items-center justify-center gap-2 disabled:opacity-50 shrink-0"
              >
                {txStage !== 'idle' && txStage !== 'confirmed' && txStage !== 'failed' ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Registering On-Chain...</span>
                  </>
                ) : (
                  <>
                    <Lock className="w-3.5 h-3.5" />
                    <span>Sign & Register Service On-Chain</span>
                  </>
                )}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
