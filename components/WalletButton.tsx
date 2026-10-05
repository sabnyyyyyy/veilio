'use client';

import React, { useState, useRef, useEffect } from 'react';
import { useAccount, useConnect, useDisconnect, useChainId, useSwitchChain, useBalance } from 'wagmi';
import { useRouter } from 'next/navigation';
import { formatEther } from 'viem';
import { Check, Copy, Wallet } from 'lucide-react';
import { bnbChain } from '@/lib/chain';

export default function WalletButton() {
  const router = useRouter();
  const { address, isConnected } = useAccount();
  const { connect, connectors, error: connectError } = useConnect();
  const { disconnect } = useDisconnect();
  const chainId = useChainId();
  const { switchChain } = useSwitchChain();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const dropdownRef = useRef<HTMLDivElement>(null);

  // Fetch actual balance
  const { data: balanceData } = useBalance({
    address: address,
  });

  // Close dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const formatAddress = (addr: string) => {
    return `${addr.substring(0, 6)}...${addr.substring(addr.length - 4)}`;
  };

  const isWrongNetwork = mounted && isConnected && chainId !== bnbChain.id;
  const isWalletConnected = mounted && isConnected && address;

  if (isWrongNetwork) {
    return (
      <button
        onClick={() => switchChain?.({ chainId: bnbChain.id })}
        className="px-4 py-2 text-xs font-semibold uppercase tracking-wider rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-400 hover:bg-amber-500/20 transition-all duration-200"
      >
        Switch to BNB Chain
      </button>
    );
  }

  if (isWalletConnected) {
    return (
      <div className="relative" ref={dropdownRef}>
        <button
          onClick={() => setIsDropdownOpen(!isDropdownOpen)}
          aria-expanded={isDropdownOpen}
          aria-haspopup="dialog"
          className="flex items-center gap-2.5 px-4 py-2 text-xs font-mono tracking-wide rounded-lg bg-[#11110F] border border-white/10 text-[#F5F2E8] hover:border-[#C9A45C]/50 hover:text-[#C9A45C] transition-all duration-200"
        >
          <span className="w-2 h-2 rounded-full bg-[#C9A45C] animate-pulse" />
          {formatAddress(address)}
          <span className="text-[10px] text-[#A8A397]">▼</span>
        </button>

        {/* Wallet Dropdown Menu */}
        {isDropdownOpen && (
          <div role="dialog" aria-label="Wallet details" className="absolute right-0 z-50 mt-3 w-[min(20rem,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-white/[0.1] bg-[#151512] shadow-[0_24px_80px_rgba(0,0,0,0.65)] ring-1 ring-black/30">
            <div className="p-4 sm:p-5">
              <div className="flex items-center gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-[#C9A45C]/20 bg-[#C9A45C]/[0.08] text-[#C9A45C]"><Wallet size={16} /></span>
                <div className="min-w-0">
                  <span className="block text-[10px] font-bold uppercase tracking-[0.16em] text-[#A8A397]">Connected wallet</span>
                  <span className="mt-0.5 block text-[11px] text-[#77746B]">Account details</span>
                </div>
              </div>

              <div className="mt-4 flex min-w-0 items-center gap-2 rounded-xl border border-white/[0.07] bg-black/20 p-3">
                <span className="min-w-0 flex-1 break-all font-mono text-[11px] leading-5 text-[#F5F2E8]" title={address}>{address}</span>
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
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-white/[0.08] text-[#A8A397] transition hover:border-[#C9A45C]/30 hover:text-[#E6CC91]"
                >{copied ? <Check size={14} className="text-emerald-300" /> : <Copy size={14} />}</button>
              </div>
            </div>

            <div className="border-y border-white/[0.07] px-4 py-1 sm:px-5">
              <div className="flex items-center justify-between gap-4 py-3 text-xs">
                <span className="text-[#8F8B81]">Balance</span>
                <span className="text-right font-semibold tabular-nums text-[#F5F2E8]">
                  {balanceData ? `${parseFloat(formatEther(balanceData.value)).toFixed(3)} ${balanceData.symbol}` : '0 BNB'}
                </span>
              </div>
              <div className="flex items-center justify-between gap-4 border-t border-white/[0.05] py-3 text-xs">
                <span className="text-[#8F8B81]">Network</span>
                <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-[#C9A45C]/15 bg-[#C9A45C]/[0.06] px-2.5 py-1 font-mono text-[10px] text-[#E6CC91]">
                  <span className="h-1.5 w-1.5 rounded-full bg-[#C9A45C]" />BNB Chain · 97
                </span>
              </div>
            </div>

            <div className="p-4 sm:px-5 sm:py-4">
              <button
                onClick={() => {
                  disconnect();
                  setIsDropdownOpen(false);
                  router.push('/');
                }}
                className="w-full rounded-xl border border-rose-400/20 bg-rose-400/[0.06] py-2.5 text-xs font-semibold uppercase tracking-[0.12em] text-rose-300 transition hover:border-rose-400/35 hover:bg-rose-400/[0.12]"
              >
                Disconnect
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <>
      <button
        onClick={() => {
          const injectedConnector = connectors.find(c => c.id === 'injected' || c.name.toLowerCase().includes('metamask'));
          if (injectedConnector) {
            connect(
              { connector: injectedConnector },
              {
                onSuccess: () => {
                  router.push('/dashboard');
                },
              }
            );
          } else if (connectors.length > 0) {
            connect(
              { connector: connectors[0] },
              {
                onSuccess: () => {
                  router.push('/dashboard');
                },
              }
            );
          } else {
            setIsModalOpen(true);
          }
        }}
        className="flex items-center justify-center h-12 px-6 text-[12px] font-bold uppercase tracking-widest rounded-md bg-[#C9A45C] text-[#0A0A09] hover:bg-[#E6CC91] active:scale-[0.98] transition-all duration-200 shadow-sm"
      >
        Connect Wallet
      </button>

      {/* MetaMask Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div className="w-full max-w-md p-6 rounded-2xl bg-[#151512] border border-white/10 text-[#F5F2E8] shadow-2xl">
            <h3 className="text-lg font-semibold text-[#F5F2E8]">MetaMask Required</h3>
            <p className="mt-2 text-sm text-[#A8A397]">
              To interact with VEILIO on BNB Chain Testnet, please install the MetaMask wallet extension in your Web3 browser.
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
