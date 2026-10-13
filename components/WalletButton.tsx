'use client';

import React, { useState, useRef, useEffect } from 'react';
import { useAccount, useConnect, useDisconnect, useChainId, useSwitchChain, useBalance, useSignMessage } from 'wagmi';
import type { Connector } from 'wagmi';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { formatEther } from 'viem';
import { createSiweMessage, generateSiweNonce } from 'viem/siwe';
import { Check, ChevronDown, Copy, ExternalLink, LogOut } from 'lucide-react';
import Link from 'next/link';
import { Connection, PublicKey } from '@solana/web3.js';
import { baseSepoliaChain, bnbChain } from '@/lib/chain';
import { getConnectedSolanaAddress, setStoredSolanaAddress } from '@/lib/walletStorage';

const SOLANA_DEVNET_RPC = process.env.NEXT_PUBLIC_SOLANA_RPC || 'https://api.devnet.solana.com';

const EVM_NETWORKS = [
  { chainId: baseSepoliaChain.id, label: 'Base Sepolia', symbol: 'ETH', logo: '/logos/chains/base.svg', explorer: baseSepoliaChain.blockExplorers.default.url, explorerName: 'BaseScan' },
  { chainId: bnbChain.id, label: 'BNB Testnet', symbol: 'BNB', logo: '/logos/chains/bnb-chain.svg', explorer: bnbChain.blockExplorers.default.url, explorerName: 'BscScan' },
] as const;

const SIGN_IN_STATEMENT = 'Sign in to VEILIO. This only proves you own this wallet: it does not send a transaction or cost any fees.';

// Prefer MetaMask announced via EIP-6963, so another extension that grabbed
// window.ethereum (e.g. Phantom's EVM provider) is not used by accident.
function pickEvmConnector(connectors: readonly Connector[]): Connector | undefined {
  return (
    connectors.find((c) => c.id === 'io.metamask' || c.id === 'io.metamask.flask') ??
    connectors.find((c) => c.name.toLowerCase().includes('metamask')) ??
    connectors.find((c) => c.id === 'injected') ??
    connectors[0]
  );
}

function getSolanaProvider(): any {
  if (typeof window === 'undefined') return undefined;
  const w = window as any;
  return w.phantom?.solana?.isPhantom ? w.phantom.solana : w.solana;
}

function describeWalletError(error: unknown, networkName: string): string {
  const err = error as { code?: number; name?: string; shortMessage?: string; message?: string; cause?: { code?: number } };
  const code = err?.code ?? err?.cause?.code;
  if (code === 4001 || err?.name === 'UserRejectedRequestError') return 'Request cancelled in your wallet.';
  if (code === -32002) return 'Your wallet already has a pending request. Open the wallet extension to approve it.';
  if (code === 4902 || err?.name === 'SwitchChainError') return `Could not switch your wallet to ${networkName}. Add the network in your wallet and try again.`;
  return err?.shortMessage || err?.message || `Could not connect to ${networkName}.`;
}

export default function WalletButton() {
  const router = useRouter();
  const { address, isConnected } = useAccount();
  const { connectAsync, connectors, error: connectError } = useConnect();
  const { disconnect } = useDisconnect();
  const chainId = useChainId();
  const { switchChain, switchChainAsync, isPending: isSwitchPending, error: switchError, variables: switchVariables } = useSwitchChain();
  const { signMessageAsync } = useSignMessage();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const [connectFlowError, setConnectFlowError] = useState<string | null>(null);
  const [pendingNetwork, setPendingNetwork] = useState<'base' | 'bnb' | 'solana' | null>(null);
  const [solanaAddress, setSolanaAddress] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);
  const [copied, setCopied] = useState(false);
  const [linkedSolanaWallet, setLinkedSolanaWallet] = useState<string | null>(null);
  const [identityLoaded, setIdentityLoaded] = useState(false);
  const [solanaBalance, setSolanaBalance] = useState<string | null>(null);
  const [solanaBalanceLoading, setSolanaBalanceLoading] = useState(false);

  useEffect(() => {
    setMounted(true);
    setSolanaAddress(getConnectedSolanaAddress());
  }, []);

  useEffect(() => {
    let active = true;
    setLinkedSolanaWallet(null);
    setIdentityLoaded(false);
    if (!mounted || !address) return () => { active = false; };

    void fetch(`/api/identity/profile?wallet=${encodeURIComponent(address)}&chain=evm`, { cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) return null;
        return await response.json() as { profile?: { linkedWallets?: Array<{ address: string; chainFamily: string; networkId: string; status: string }> } };
      })
      .then((body) => {
        if (!active) return;
        const wallet = body?.profile?.linkedWallets?.find((item) => item.chainFamily === 'solana' && item.networkId === 'solana:devnet' && item.status === 'active');
        setLinkedSolanaWallet(wallet?.address || null);
      })
      .catch(() => { if (active) setLinkedSolanaWallet(null); })
      .finally(() => { if (active) setIdentityLoaded(true); });

    return () => { active = false; };
  }, [address, mounted]);

  useEffect(() => {
    let active = true;
    if (!mounted || !isDropdownOpen || !linkedSolanaWallet) {
      setSolanaBalance(null);
      setSolanaBalanceLoading(false);
      return () => { active = false; };
    }

    setSolanaBalance(null);
    setSolanaBalanceLoading(true);
    const connection = new Connection(SOLANA_DEVNET_RPC, 'confirmed');
    void connection.getBalance(new PublicKey(linkedSolanaWallet), 'confirmed')
      .then((lamports) => {
        if (!active) return;
        setSolanaBalance(`${(lamports / 1_000_000_000).toLocaleString(undefined, { minimumFractionDigits: 3, maximumFractionDigits: 6 })} SOL`);
      })
      .catch(() => { if (active) setSolanaBalance('Unavailable'); })
      .finally(() => { if (active) setSolanaBalanceLoading(false); });

    return () => { active = false; };
  }, [linkedSolanaWallet, mounted, isDropdownOpen]);

  const dropdownRef = useRef<HTMLDivElement>(null);
  const pickerRef = useRef<HTMLDivElement>(null);

  // Fetch actual balance
  const { data: balanceData, isLoading: balanceLoading, isError: balanceError } = useBalance({
    address: address,
  });

  // Close dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsDropdownOpen(false);
      }
      if (pickerRef.current && !pickerRef.current.contains(event.target as Node)) {
        setIsPickerOpen(false);
      }
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsPickerOpen(false);
        setIsDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, []);

  const formatAddress = (addr: string) => {
    return `${addr.substring(0, 6)}...${addr.substring(addr.length - 4)}`;
  };

  const isWrongNetwork = mounted && isConnected && chainId !== bnbChain.id && chainId !== baseSepoliaChain.id;
  const isWalletConnected = mounted && isConnected && address;

  if (isWrongNetwork) {
    return (
      <div className="flex items-center gap-1.5">
        <button
          onClick={() => switchChain?.({ chainId: bnbChain.id })}
          className="px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider rounded-full bg-amber-500/10 border border-amber-500/30 text-amber-400 hover:bg-amber-500/20 transition-all duration-200"
        >
          BNB Testnet
        </button>
        <button
          onClick={() => switchChain?.({ chainId: baseSepoliaChain.id })}
          className="px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider rounded-full bg-blue-500/10 border border-blue-500/30 text-blue-400 hover:bg-blue-500/20 transition-all duration-200"
        >
          Base Sepolia
        </button>
      </div>
    );
  }

  if (isWalletConnected) {
    const activeNetwork = EVM_NETWORKS.find((network) => network.chainId === chainId) ?? EVM_NETWORKS[0];
    const explorerUrl = `${activeNetwork.explorer}/address/${address}`;
    const balanceLabel = balanceLoading
      ? null
      : balanceError || !balanceData
        ? 'Unavailable'
        : `${Number(formatEther(balanceData.value)).toLocaleString(undefined, { minimumFractionDigits: 3, maximumFractionDigits: 4 })}`;

    return (
      <div className="relative" ref={dropdownRef}>
        <button
          type="button"
          onClick={() => setIsDropdownOpen(!isDropdownOpen)}
          aria-expanded={isDropdownOpen}
          aria-haspopup="dialog"
          className="flex items-center gap-2 rounded-full border border-[#C9A45C]/35 bg-black/60 py-1 pl-1.5 pr-3 font-mono text-xs tracking-wide text-[#F5F2E8] backdrop-blur-md transition-all duration-200 hover:border-[#E2C17C] hover:shadow-[0_0_18px_rgba(226,193,124,0.25)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E2C17C]/60"
        >
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-white/[0.06]">
            <Image src={activeNetwork.logo} alt="" width={14} height={14} className="h-3.5 w-3.5" />
          </span>
          {formatAddress(address)}
          <ChevronDown size={12} className={`text-[#A8A397] transition-transform duration-200 ${isDropdownOpen ? 'rotate-180' : ''}`} />
        </button>

        {isDropdownOpen && (
          <div role="dialog" aria-label="Connected wallet" className="absolute right-0 z-50 mt-3 w-[min(21rem,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-[#C9A45C]/20 bg-[#12110E] shadow-[0_24px_80px_rgba(0,0,0,0.7)] ring-1 ring-black/40">
            {/* Identity */}
            <div className="relative p-4 sm:p-5">
              <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-[radial-gradient(ellipse_at_top,rgba(226,193,124,0.14),transparent_70%)]" />
              <div className="relative flex items-center gap-3">
                <span className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-[#C9A45C]/25 bg-black/40">
                  <Image src={activeNetwork.logo} alt="" width={22} height={22} className="h-[22px] w-[22px]" />
                  <span className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-[#12110E] bg-emerald-400" aria-hidden="true" />
                </span>
                <div className="min-w-0 flex-1">
                  <span className="block truncate text-[10px] font-bold uppercase tracking-[0.14em] text-[#C9A45C]">{activeNetwork.label}<span className="sr-only"> connected</span></span>
                  <span className="mt-0.5 block truncate font-mono text-sm text-[#F5F2E8]" title={address}>{formatAddress(address)}</span>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    aria-label={copied ? 'Wallet address copied' : 'Copy wallet address'}
                    title={copied ? 'Copied' : 'Copy address'}
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(address);
                        setCopied(true);
                        window.setTimeout(() => setCopied(false), 1600);
                      } catch {
                        setCopied(false);
                      }
                    }}
                    className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/[0.08] text-[#A8A397] transition hover:border-[#C9A45C]/40 hover:text-[#E6CC91] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E2C17C]/60"
                  >{copied ? <Check size={14} className="text-emerald-300" /> : <Copy size={14} />}</button>
                  <a
                    href={explorerUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={`View address on ${activeNetwork.explorerName}`}
                    title={`View on ${activeNetwork.explorerName}`}
                    className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/[0.08] text-[#A8A397] transition hover:border-[#C9A45C]/40 hover:text-[#E6CC91] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E2C17C]/60"
                  ><ExternalLink size={14} /></a>
                </div>
              </div>
              <span aria-live="polite" className="sr-only">{copied ? 'Address copied to clipboard' : ''}</span>

              {/* Balance */}
              <div className="relative mt-4 rounded-xl border border-white/[0.07] bg-black/30 px-4 py-3">
                <span className="block text-[10px] font-bold uppercase tracking-[0.16em] text-[#8F8B81]">Balance</span>
                {balanceLabel === null ? (
                  <span className="mt-2 block h-6 w-28 animate-pulse rounded bg-white/[0.06]" aria-label="Loading balance" />
                ) : (
                  <span className="mt-1 flex items-baseline gap-1.5">
                    <span className={`font-semibold tabular-nums ${balanceLabel === 'Unavailable' ? 'text-sm text-[#89867D]' : 'text-xl text-[#F5F2E8]'}`}>{balanceLabel}</span>
                    {balanceLabel !== 'Unavailable' && <span className="font-mono text-xs text-[#C9A45C]">{balanceData?.symbol ?? activeNetwork.symbol}</span>}
                  </span>
                )}
              </div>
            </div>

            {/* Network switcher */}
            <div className="border-t border-white/[0.07] px-4 py-3.5 sm:px-5">
              <span id="wallet-network-label" className="block text-[10px] font-bold uppercase tracking-[0.16em] text-[#8F8B81]">Network</span>
              <div role="group" aria-labelledby="wallet-network-label" className="mt-2 grid grid-cols-2 gap-1.5 rounded-xl border border-white/[0.07] bg-black/30 p-1">
                {EVM_NETWORKS.map((network) => {
                  const isActive = network.chainId === chainId;
                  const isSwitching = isSwitchPending && switchVariables?.chainId === network.chainId;
                  return (
                    <button
                      key={network.chainId}
                      type="button"
                      aria-pressed={isActive}
                      disabled={isActive || isSwitchPending}
                      onClick={() => switchChain({ chainId: network.chainId })}
                      className={`flex items-center justify-center gap-2 rounded-lg px-2 py-2 text-[11px] font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E2C17C]/60 ${
                        isActive
                          ? 'border border-[#C9A45C]/40 bg-[#C9A45C]/15 text-[#E6CC91]'
                          : 'border border-transparent text-[#A8A397] hover:bg-white/[0.04] hover:text-white disabled:opacity-60'
                      }`}
                    >
                      <Image src={network.logo} alt="" width={14} height={14} className="h-3.5 w-3.5" />
                      {isSwitching ? 'Switching…' : network.label}
                    </button>
                  );
                })}
              </div>
              {switchError && !isSwitchPending && (
                <p role="alert" className="mt-2 text-[11px] leading-5 text-rose-300">{describeWalletError(switchError, 'that network')}</p>
              )}
            </div>

            {/* Solana identity link */}
            <div className="border-t border-white/[0.07] px-4 py-3.5 sm:px-5">
              <div className="flex items-center gap-3">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-white/[0.08] bg-black/30">
                  <Image src="/logos/chains/solana.svg" alt="" width={16} height={16} className="h-4 w-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <span className="block text-xs font-semibold text-[#F5F2E8]">Solana Devnet</span>
                  {linkedSolanaWallet ? (
                    <span className="block truncate font-mono text-[10px] text-[#A8A397]" title={linkedSolanaWallet}>{formatAddress(linkedSolanaWallet)}</span>
                  ) : (
                    <span className="block text-[10px] text-[#89867D]">{identityLoaded ? 'No Solana wallet linked' : 'Checking identity…'}</span>
                  )}
                </div>
                {linkedSolanaWallet ? (
                  <span className="shrink-0 text-right text-xs font-semibold tabular-nums text-[#F5F2E8]">
                    {solanaBalanceLoading ? <span className="inline-block h-4 w-16 animate-pulse rounded bg-white/[0.06]" aria-label="Loading SOL balance" /> : solanaBalance || '—'}
                  </span>
                ) : identityLoaded ? (
                  <Link href="/identity" className="shrink-0 rounded-lg border border-[#C9A45C]/30 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-[#E6CC91] transition hover:bg-[#C9A45C]/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E2C17C]/60">
                    Link
                  </Link>
                ) : null}
              </div>
            </div>

            <div className="border-t border-white/[0.07] p-3 sm:px-4">
              <button
                type="button"
                onClick={() => {
                  disconnect();
                  setIsDropdownOpen(false);
                  router.push('/');
                }}
                className="flex w-full items-center justify-center gap-2 rounded-xl py-2.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-rose-300/90 transition hover:bg-rose-400/[0.08] hover:text-rose-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-400/50"
              >
                <LogOut size={13} />
                Disconnect
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  const connectEvm = async (targetChainId: number, networkKey: 'base' | 'bnb') => {
    setIsPickerOpen(false);
    setConnectFlowError(null);
    const connector = pickEvmConnector(connectors);
    if (!connector) {
      setIsModalOpen(true);
      return;
    }
    const targetName = targetChainId === baseSepoliaChain.id ? 'Base Sepolia' : 'BNB Testnet';
    setPendingNetwork(networkKey);
    let connected = false;
    try {
      const result = await connectAsync({ connector, chainId: targetChainId });
      connected = true;
      // wagmi keeps the connection even when the in-wallet chain switch fails,
      // so check the chain explicitly instead of silently landing on the wrong one.
      if (result.chainId !== targetChainId) {
        await switchChainAsync({ chainId: targetChainId });
      }
      const account = result.accounts[0];
      // Sign-in message (EIP-4361): proves wallet ownership, never a transaction or gas.
      const message = createSiweMessage({
        address: account,
        chainId: targetChainId,
        domain: window.location.host,
        uri: window.location.origin,
        version: '1',
        nonce: generateSiweNonce(),
        issuedAt: new Date(),
        statement: SIGN_IN_STATEMENT,
      });
      await signMessageAsync({ account, message });
      router.push('/dashboard');
    } catch (error) {
      if (connected) disconnect();
      setConnectFlowError(describeWalletError(error, targetName));
    } finally {
      setPendingNetwork(null);
    }
  };

  const connectSolana = async () => {
    setIsPickerOpen(false);
    setConnectFlowError(null);
    const provider = getSolanaProvider();
    if (!provider?.connect) {
      setConnectFlowError('Phantom was not detected. Install the Phantom extension, then try again.');
      return;
    }
    setPendingNetwork('solana');
    let connected = false;
    try {
      const res = await provider.connect();
      connected = true;
      const publicKey = res.publicKey.toString();
      if (typeof provider.signMessage !== 'function') {
        throw new Error('This Solana wallet cannot sign messages.');
      }
      const message = [
        `${window.location.host} wants you to sign in with your Solana account:`,
        publicKey,
        '',
        SIGN_IN_STATEMENT,
        '',
        `URI: ${window.location.origin}`,
        'Network: Solana Devnet',
        `Nonce: ${generateSiweNonce()}`,
        `Issued At: ${new Date().toISOString()}`,
      ].join('\n');
      await provider.signMessage(new TextEncoder().encode(message), 'utf8');
      setStoredSolanaAddress(publicKey);
      setSolanaAddress(publicKey);
      router.push('/dashboard');
    } catch (error) {
      if (connected) await provider.disconnect?.().catch(() => undefined);
      setConnectFlowError(describeWalletError(error, 'Solana Devnet'));
    } finally {
      setPendingNetwork(null);
    }
  };

  const disconnectSolana = async () => {
    setIsPickerOpen(false);
    await getSolanaProvider()?.disconnect?.().catch(() => undefined);
    setStoredSolanaAddress(null);
    setSolanaAddress(null);
  };

  const networkOptions = [
    { key: 'base', label: 'Base', sub: 'Base Sepolia · EVM', logo: '/logos/chains/base.svg', onSelect: () => { void connectEvm(baseSepoliaChain.id, 'base'); } },
    { key: 'bnb', label: 'BNB Chain', sub: 'BNB Testnet · EVM', logo: '/logos/chains/bnb-chain.svg', onSelect: () => { void connectEvm(bnbChain.id, 'bnb'); } },
    { key: 'solana', label: 'Solana', sub: 'Solana Devnet · Phantom', logo: '/logos/chains/solana.svg', onSelect: () => { void connectSolana(); } },
  ];

  return (
    <>
      <div className="relative" ref={pickerRef}>
        <button
          type="button"
          onClick={() => setIsPickerOpen((open) => !open)}
          disabled={pendingNetwork !== null}
          aria-busy={pendingNetwork !== null}
          aria-haspopup="menu"
          aria-expanded={isPickerOpen}
          className="btn-gold-shimmer relative inline-flex items-center justify-center gap-1.5 h-8 px-4 text-[11px] font-semibold uppercase tracking-wider rounded-full border border-[#E2C17C]/60 text-black active:scale-[0.98] transition-all duration-200 shadow-[0_0_18px_rgba(226,193,124,0.25)] hover:shadow-[0_0_26px_rgba(226,193,124,0.45)]"
        >
          {solanaAddress && !pendingNetwork && (
            <Image src="/logos/chains/solana.svg" alt="" width={14} height={14} className="relative z-[1] h-3.5 w-3.5" />
          )}
          <span className="relative z-[1]">
            {pendingNetwork ? 'Check your wallet…' : solanaAddress ? formatAddress(solanaAddress) : 'Connect Wallet'}
          </span>
          <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={`relative z-[1] transition-transform duration-200 ${isPickerOpen ? 'rotate-90' : ''}`}><path d="m9 18 6-6-6-6"/></svg>
        </button>

        {isPickerOpen && (
          <div role="menu" aria-label="Choose network" className="absolute right-0 z-50 mt-3 w-64 overflow-hidden rounded-2xl border border-[#C9A45C]/20 bg-[#151512] p-1.5 shadow-[0_24px_80px_rgba(0,0,0,0.65)]">
            <span className="block px-3 pb-1.5 pt-2 text-[10px] font-bold uppercase tracking-[0.16em] text-[#A8A397]">Connect to</span>
            {networkOptions.map((option) => (
              <button
                key={option.key}
                type="button"
                role="menuitem"
                onClick={option.onSelect}
                className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition hover:bg-[#C9A45C]/[0.08] focus-visible:bg-[#C9A45C]/[0.08] focus-visible:outline-none"
              >
                <Image src={option.logo} alt="" width={20} height={20} className="h-5 w-5 shrink-0" />
                <span className="min-w-0">
                  <span className="block text-xs font-semibold text-[#F5F2E8]">{option.label}</span>
                  <span className="block text-[10px] text-[#89867D]">{option.sub}</span>
                </span>
              </button>
            ))}
            {solanaAddress && (
              <button
                type="button"
                role="menuitem"
                onClick={() => { void disconnectSolana(); }}
                className="mt-1 w-full rounded-xl border-t border-white/[0.06] px-3 py-2.5 text-left text-[11px] font-semibold text-rose-300 transition hover:bg-rose-400/[0.08]"
              >
                Disconnect Solana ({formatAddress(solanaAddress)})
              </button>
            )}
          </div>
        )}

        {connectFlowError && !isPickerOpen && (
          <div role="alert" className="absolute right-0 z-50 mt-2 flex w-72 items-start gap-2 rounded-lg border border-rose-500/20 bg-[#151512] px-3 py-2 text-[11px] leading-5 text-rose-300">
            <span className="min-w-0 flex-1">{connectFlowError}</span>
            <button type="button" aria-label="Dismiss" onClick={() => setConnectFlowError(null)} className="shrink-0 text-rose-300/70 hover:text-rose-200">×</button>
          </div>
        )}
      </div>

      {/* MetaMask Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div className="w-full max-w-md p-6 rounded-2xl bg-[#151512] border border-white/10 text-[#F5F2E8] shadow-2xl">
            <h3 className="text-lg font-semibold text-[#F5F2E8]">MetaMask Required</h3>
            <p className="mt-2 text-sm text-[#A8A397]">
              To connect to VEILIO on Base or BNB Chain, please install the MetaMask wallet extension in your Web3 browser.
            </p>
            {connectError && (
              <p className="mt-3 text-xs font-mono text-rose-400 bg-rose-500/10 p-3 rounded border border-rose-500/20">
                {connectError.message}
              </p>
            )}
            <div className="mt-6 flex justify-end gap-3">
              <button
                onClick={() => setIsModalOpen(false)}
                className="px-4 py-2 text-xs font-medium rounded-lg text-[#A8A397] hover:text-[#F5F2E8] transition-colors"
              >
                Close
              </button>
              <a
                href="https://metamask.io"
                target="_blank"
                rel="noreferrer"
                className="px-4 py-2 text-xs font-semibold rounded-lg bg-[#C9A45C] text-[#0A0A09] hover:bg-[#E6CC91] transition-colors"
              >
                Install MetaMask
              </a>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
