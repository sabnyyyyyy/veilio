'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAccount, useChainId, useConnect, useSignMessage, useSwitchChain } from 'wagmi';
import { ArrowRightLeft, ArrowUpRight, CheckCircle2, CircleAlert, Globe, Link2, RefreshCw, ShieldCheck, Wallet } from 'lucide-react';
import { baseSepoliaChain, bnbChain } from '@/lib/chain';

type LinkedWallet = {
  address: string;
  chainFamily: 'evm' | 'solana';
  networkId: string;
  linkedAt: number;
  isPrimary: boolean;
  status: 'active' | 'unlinked';
  proofType: 'eip191' | 'ed25519';
};

type IdentityProfile = {
  id: string;
  primaryWallet: string;
  createdAt: number;
  linkedWallets: LinkedWallet[];
};

type Activity = {
  id: string;
  chainFamily: 'evm' | 'solana';
  networkId: string;
  activityType: string;
  title: string;
  description: string;
  txHashOrSignature?: string;
  timestamp: number;
  status: string;
};

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

function encodeBase58(bytes: Uint8Array): string {
  if (bytes.length === 0) return '';
  let leadingZeroes = 0;
  while (leadingZeroes < bytes.length && bytes[leadingZeroes] === 0) leadingZeroes++;

  let value = 0n;
  for (const byte of bytes) value = (value << 8n) | BigInt(byte);
  let encoded = '';
  while (value > 0n) {
    const remainder = Number(value % 58n);
    encoded = B58[remainder] + encoded;
    value /= 58n;
  }
  return '1'.repeat(leadingZeroes) + encoded;
}

function getSolanaProvider(): any {
  if (typeof window === 'undefined') return undefined;
  if ('phantom' in window && (window as any).phantom?.solana?.isPhantom) {
    return (window as any).phantom.solana;
  }
  if ('solana' in window && window.solana) {
    return window.solana;
  }
  return undefined;
}

async function readJson<T>(response: Response): Promise<T> {
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || `Request failed (${response.status})`);
  return body as T;
}

function shortAddress(address: string) {
  return `${address.slice(0, 7)}…${address.slice(-5)}`;
}

function networkName(networkId: string) {
  if (networkId === 'bnb:97') return 'BNB Chain Testnet';
  if (networkId === 'bnb:56') return 'BNB Chain';
  if (networkId === 'base:84532') return 'Base Sepolia';
  if (networkId === 'solana:devnet') return 'Solana Devnet';
  return networkId;
}

function transactionUrl(activity: Activity) {
  if (!activity.txHashOrSignature) return null;
  if (activity.chainFamily === 'solana') {
    const cluster = activity.networkId === 'solana:mainnet' ? '' : '?cluster=devnet';
    return `https://explorer.solana.com/tx/${encodeURIComponent(activity.txHashOrSignature)}${cluster}`;
  }
  const base = activity.networkId === 'base:84532' ? 'https://sepolia.basescan.org/tx/' : 'https://testnet.bscscan.com/tx/';
  return `${base}${encodeURIComponent(activity.txHashOrSignature)}`;
}

export default function IdentityPage() {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const { connect, connectors } = useConnect();
  const { signMessageAsync } = useSignMessage();
  const { switchChainAsync } = useSwitchChain();
  const [isHydrated, setIsHydrated] = useState(false);
  const [profile, setProfile] = useState<IdentityProfile | null>(null);
  const [activity, setActivity] = useState<Activity[]>([]);
  const [solanaAddress, setSolanaAddress] = useState('');
  const [rpc, setRpc] = useState<{ ok: boolean; slot: string; endpoint?: string } | null>(null);
  const [checkingRpc, setCheckingRpc] = useState(false);
  const [loading, setLoading] = useState(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [activeTab, setActiveTab] = useState<'all' | 'bnb' | 'base' | 'solana'>('all');

  const checkSolanaRpc = useCallback(async () => {
    setCheckingRpc(true);
    try {
      const response = await fetch('/api/solana/devnet-health', { cache: 'no-store' });
      const result = await response.json() as { ok?: boolean; slot?: string; endpoint?: string };
      if (!response.ok || !result.ok || !result.slot) {
        setRpc({ ok: false, slot: '—' });
      } else {
        setRpc({ ok: true, slot: result.slot, endpoint: result.endpoint });
      }
    } catch {
      setRpc({ ok: false, slot: '—' });
    } finally {
      setCheckingRpc(false);
    }
  }, []);

  const refreshProfile = useCallback(async (identityId?: string) => {
    if (!identityId && !address) {
      setProfile(null);
      setActivity([]);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const query = identityId
        ? `id=${encodeURIComponent(identityId)}`
        : `wallet=${encodeURIComponent(address!)}&chain=evm`;
      const data = await readJson<{ profile: IdentityProfile }>(await fetch(`/api/identity/profile?${query}`, { cache: 'no-store' }));
      if (!data.profile || !data.profile.id) {
        throw new Error('Identity profile could not be retrieved.');
      }
      setProfile(data.profile);
      const history = await readJson<{ items: Activity[] }>(await fetch(`/api/identity/activity?identityId=${encodeURIComponent(data.profile.id)}&limit=50`, { cache: 'no-store' }));
      setActivity(history.items || []);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Could not load identity.';
      if (identityId && address) {
        // Attempt recovery via connected EVM wallet if a stale identityId was queried
        try {
          const fallback = await readJson<{ profile: IdentityProfile }>(
            await fetch(`/api/identity/profile?wallet=${encodeURIComponent(address)}&chain=evm`, { cache: 'no-store' })
          );
          if (fallback.profile?.id) {
            setProfile(fallback.profile);
            const history = await readJson<{ items: Activity[] }>(
              await fetch(`/api/identity/activity?identityId=${encodeURIComponent(fallback.profile.id)}&limit=50`, { cache: 'no-store' })
            );
            setActivity(history.items || []);
            setError('');
            return;
          }
        } catch {
          // Connected wallet does not have an identity profile yet
        }
      }
      setProfile(null);
      setActivity([]);
      if (message.includes('not found') || message.includes('Identity not found')) {
        if (identityId) {
          setError(`Veilio identity ${identityId} not found. Connect your wallet and create an identity to get started.`);
        }
      } else {
        setError(message);
      }
    } finally {
      setLoading(false);
    }
  }, [address]);

  useEffect(() => { void refreshProfile(); }, [refreshProfile]);

  useEffect(() => {
    setIsHydrated(true);
    void checkSolanaRpc();
  }, [checkSolanaRpc]);

  useEffect(() => {
    const updateSolana = () => {
      const provider = getSolanaProvider();
      if (provider?.publicKey) {
        setSolanaAddress(provider.publicKey.toString());
      }
    };
    updateSolana();

    const provider = getSolanaProvider();
    if (provider) {
      provider.on?.('connect', (publicKey: any) => {
        if (publicKey) setSolanaAddress(publicKey.toString());
      });
      provider.on?.('accountChanged', (publicKey: any) => {
        if (publicKey) {
          setSolanaAddress(publicKey.toString());
        } else {
          setSolanaAddress('');
        }
      });
      provider.on?.('disconnect', () => {
        setSolanaAddress('');
      });
      provider.connect?.({ onlyIfTrusted: true }).catch(() => {});
    }

    window.addEventListener('load', updateSolana);
    return () => {
      window.removeEventListener('load', updateSolana);
    };
  }, []);

  async function handleConnectOrSwitch(targetChainId: 97 | 84532) {
    setError('');
    setNotice('');
    const targetName = targetChainId === 84532 ? 'Base Sepolia' : 'BNB Chain Testnet';
    if (!isConnected) {
      const injected = connectors.find((c) => c.id === 'injected' || c.name.toLowerCase().includes('metamask')) || connectors[0];
      if (!injected) {
        setError('No injected Web3 wallet found. Please install MetaMask or another Web3 extension.');
        return;
      }
      connect(
        { connector: injected, chainId: targetChainId },
        {
          onSuccess: () => {
            setNotice(`Connected wallet. Active network: ${targetName} (${targetChainId}).`);
          },
          onError: (err) => {
            setError(err.message || `Failed to connect wallet on ${targetName}.`);
          },
        }
      );
      return;
    }

    if (chainId !== targetChainId) {
      try {
        if (!switchChainAsync) {
          setError('Network switching is not supported by your current wallet provider.');
          return;
        }
        await switchChainAsync({ chainId: targetChainId });
        setNotice(`Switched network to ${targetName} (${targetChainId}).`);
      } catch (err: any) {
        if (err?.message?.includes('rejected') || err?.code === 4001) {
          setError(`Network switch to ${targetName} was rejected in your wallet.`);
        } else {
          setError(err?.message || `Failed to switch network to ${targetName}.`);
        }
      }
    }
  }

  async function createIdentity(targetChainId: 97 | 84532) {
    if (!address || !isConnected) {
      setError('Connect your EVM wallet first.');
      return;
    }
    const targetName = targetChainId === 84532 ? 'Base Sepolia' : 'BNB Chain Testnet';
    if (chainId !== targetChainId) {
      try {
        if (!switchChainAsync) {
          setError(`Switch your wallet to ${targetName} (${targetChainId}) before creating an identity.`);
          return;
        }
        await switchChainAsync({ chainId: targetChainId });
      } catch (err: any) {
        setError(err?.message?.includes('rejected') || err?.code === 4001
          ? `Network switch to ${targetName} was rejected in your wallet.`
          : `Switch your wallet to ${targetName} (${targetChainId}) before creating an identity.`);
        return;
      }
    }

    setWorking(true);
    setError('');
    setNotice('');
    try {
      const timestamp = Date.now();
      const nonce = crypto.randomUUID().replaceAll('-', '');
      const wallet = address.toLowerCase();
      const message = [
        'VEILIO IDENTITY PROFILE INITIALIZATION V1',
        `Wallet: ${wallet}`,
        'Chain: evm',
        `Timestamp: ${timestamp}`,
        `Nonce: ${nonce}`,
        'Purpose: Authorize creating a new Veilio identity profile for this wallet.',
      ].join('\n');
      const signature = await signMessageAsync({ message });
      const networkId = targetChainId === 84532 ? 'base:84532' : 'bnb:97';
      const body = await readJson<{ profile: IdentityProfile }>(await fetch('/api/identity/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          wallet,
          chain: 'evm',
          networkId,
          auth: { signerAddress: wallet, signature, timestamp, nonce, chainFamily: 'evm' },
        }),
      }));
      if (!body.profile || !body.profile.id) {
        throw new Error('Identity initialization completed without a valid identity record.');
      }
      setProfile(body.profile);
      setNotice(`Unified identity created on ${targetName}. You can now link your other EVM or Solana wallets.`);
      await refreshProfile(body.profile.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not create identity.');
    } finally {
      setWorking(false);
    }
  }

  async function linkEvmWallet(targetNetworkId: 'bnb:97' | 'base:84532') {
    if (!profile || !profile.id) {
      setError('Create or load your VEILIO identity first.');
      return;
    }
    if (!address || !isConnected) {
      setError('Connect your EVM wallet first.');
      return;
    }

    const targetChainId = targetNetworkId === 'base:84532' ? 84532 : 97;
    const targetName = targetNetworkId === 'base:84532' ? 'Base Sepolia' : 'BNB Chain Testnet';

    if (chainId !== targetChainId) {
      try {
        if (!switchChainAsync) {
          setError(`Please switch your wallet to ${targetName} (${targetChainId}) before linking.`);
          return;
        }
        await switchChainAsync({ chainId: targetChainId });
      } catch (err: any) {
        setError(err?.message?.includes('rejected') || err?.code === 4001
          ? `Network switch to ${targetName} was rejected in your wallet.`
          : `Please switch your wallet to ${targetName} (${targetChainId}) before linking.`);
        return;
      }
    }

    setWorking(true);
    setError('');
    setNotice('');
    try {
      const wallet = address.toLowerCase();
      const challenge = await readJson<{ challengeId: string; message: string }>(await fetch('/api/identity/challenge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          identityId: profile.id,
          chainFamily: 'evm',
          networkId: targetNetworkId,
          walletAddress: wallet,
        }),
      }));
      const signature = await signMessageAsync({ message: challenge.message });
      await readJson(await fetch('/api/identity/link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          challengeId: challenge.challengeId,
          walletAddress: wallet,
          signature,
        }),
      }));
      setNotice(`${targetName} wallet linked with verified EIP-191 proof of control.`);
      await refreshProfile(profile.id);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : `Could not link ${targetName} wallet.`;
      if (message.includes('not found') || message.includes('Identity not found')) {
        setError(`Veilio identity ${profile.id} was not found on backend. Please re-initialize your identity profile.`);
      } else {
        setError(message);
      }
    } finally {
      setWorking(false);
    }
  }

  async function linkSolanaWallet() {
    if (!profile || !profile.id) {
      setError('Create or load your VEILIO identity first.');
      return;
    }
    const provider = getSolanaProvider();
    if (!provider) {
      setError('Install a Solana wallet such as Phantom or Solflare, then reload this page.');
      return;
    }
    setWorking(true);
    setError('');
    setNotice('');
    try {
      const connected = await provider.connect();
      const pubkey = connected?.publicKey || provider.publicKey;
      const wallet = pubkey ? pubkey.toString() : '';
      if (!wallet || wallet.startsWith('0x') || wallet.length < 32 || wallet.length > 44 || !/^[1-9A-HJ-NP-Za-km-z]+$/.test(wallet)) {
        setError(`Invalid Solana public key format: ${wallet}`);
        return;
      }
      setSolanaAddress(wallet);
      const challenge = await readJson<{ challengeId: string; message: string }>(await fetch('/api/identity/challenge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          identityId: profile.id,
          chainFamily: 'solana',
          networkId: 'solana:devnet',
          walletAddress: wallet,
        }),
      }));
      const signed = await provider.signMessage(new TextEncoder().encode(challenge.message), 'utf8');
      const rawSig = (signed && typeof signed === 'object' && 'signature' in signed) ? (signed as any).signature : signed;
      const sigBytes = rawSig instanceof Uint8Array ? rawSig : new Uint8Array(rawSig);
      const signature = encodeBase58(sigBytes);
      await readJson(await fetch('/api/identity/link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          challengeId: challenge.challengeId,
          walletAddress: wallet,
          signature,
        }),
      }));
      setNotice('Solana Devnet wallet linked with an Ed25519 signature. No funds or assets moved.');
      await refreshProfile(profile.id);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Could not link Solana wallet.';
      if (message.includes('not found') || message.includes('Identity not found')) {
        setError(`Veilio identity ${profile.id} was not found on backend. Please re-initialize your identity profile.`);
      } else {
        setError(message);
      }
    } finally {
      setWorking(false);
    }
  }

  const activeWallets = (profile?.linkedWallets ?? []).filter((wallet) => wallet.status === 'active');
  const isBnbActive = isHydrated && isConnected && chainId === bnbChain.id;
  const isBaseActive = isHydrated && isConnected && chainId === baseSepoliaChain.id;
  const isWrongEvmNetwork = isHydrated && isConnected && chainId !== bnbChain.id && chainId !== baseSepoliaChain.id;

  const bnbWalletRecord = activeWallets.find((w) => w.chainFamily === 'evm' && w.networkId === 'bnb:97');
  const baseWalletRecord = activeWallets.find((w) => w.chainFamily === 'evm' && w.networkId === 'base:84532');
  const solanaWalletRecord = activeWallets.find((w) => w.chainFamily === 'solana');

  return (
    <div className="min-h-screen bg-[#0A0A09] px-6 pb-24 pt-14 text-[#F5F2E8]">
      <div className="mx-auto max-w-5xl">
        {/* Header Section */}
        <div className="mb-10 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#C9A45C]">VEILIO · MULTICHAIN</p>
            <h1 className="mt-3 text-4xl font-black tracking-tight sm:text-5xl">One identity. Multi-chain.</h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-[#A8A397]">
              Link BNB Chain Testnet, Base Sepolia, and Solana Devnet wallets with cryptographic proof of control.
            </p>
          </div>
          <button
            onClick={() => void refreshProfile(profile?.id)}
            disabled={loading || working}
            className="inline-flex items-center gap-2 rounded-lg border border-white/10 px-4 py-2.5 text-xs font-bold uppercase tracking-wider text-[#E6CC91] hover:border-[#C9A45C]/50 disabled:opacity-50"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            Refresh
          </button>
        </div>

        {/* Network Filter Bar */}
        <div className="mb-8 flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.08] pb-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="mr-2 text-xs font-bold uppercase tracking-wider text-[#77746B]">Filter View:</span>
            <button
              onClick={() => setActiveTab('all')}
              className={`rounded-lg px-3 py-1.5 text-xs font-bold transition ${
                activeTab === 'all'
                  ? 'bg-white/10 text-[#F5F2E8] shadow-sm'
                  : 'text-[#8F8B81] hover:text-[#F5F2E8]'
              }`}
            >
              All Networks (3)
            </button>
            <button
              onClick={() => setActiveTab('bnb')}
              className={`rounded-lg px-3 py-1.5 text-xs font-bold transition ${
                activeTab === 'bnb'
                  ? 'border border-[#C9A45C]/40 bg-[#C9A45C]/15 text-[#E6CC91]'
                  : 'text-[#8F8B81] hover:text-[#E6CC91]'
              }`}
            >
              BNB Chain Testnet
            </button>
            <button
              onClick={() => setActiveTab('base')}
              className={`rounded-lg px-3 py-1.5 text-xs font-bold transition ${
                activeTab === 'base'
                  ? 'border border-blue-400/40 bg-blue-500/15 text-blue-200'
                  : 'text-[#8F8B81] hover:text-blue-300'
              }`}
            >
              Base Sepolia
            </button>
            <button
              onClick={() => setActiveTab('solana')}
              className={`rounded-lg px-3 py-1.5 text-xs font-bold transition ${
                activeTab === 'solana'
                  ? 'border border-[#8B7BFF]/40 bg-[#8B7BFF]/15 text-[#C5BCFF]'
                  : 'text-[#8F8B81] hover:text-[#C5BCFF]'
              }`}
            >
              Solana Devnet
            </button>
          </div>

          <div className="flex items-center gap-2 text-xs">
            <span className="text-[#77746B]">Active Wallet Network:</span>
            {isHydrated && isConnected ? (
              <span className={`rounded-full border px-2.5 py-0.5 text-[11px] font-semibold font-mono ${
                isBaseActive
                  ? 'border-blue-400/30 bg-blue-400/10 text-blue-300'
                  : isBnbActive
                  ? 'border-[#C9A45C]/30 bg-[#C9A45C]/10 text-[#E6CC91]'
                  : 'border-amber-400/30 bg-amber-400/10 text-amber-300'
              }`}>
                {isBaseActive ? 'Base Sepolia (84532)' : isBnbActive ? 'BNB Testnet (97)' : `Chain ${chainId}`}
              </span>
            ) : (
              <span className="rounded-full border border-white/10 px-2.5 py-0.5 text-[11px] text-[#77746B]">
                Disconnected
              </span>
            )}
          </div>
        </div>

        {/* Wrong EVM Network Warning Banner */}
        {isWrongEvmNetwork && (
          <div role="status" className="mb-6 flex flex-wrap items-center justify-between gap-4 rounded-xl border border-amber-500/20 bg-amber-500/10 p-4 text-sm text-amber-200">
            <div className="flex items-center gap-3">
              <CircleAlert size={18} className="shrink-0 text-amber-400" />
              <span>Your EVM wallet is connected to chain {chainId}. VEILIO requires BNB Chain Testnet (97) or Base Sepolia (84532).</span>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => void handleConnectOrSwitch(97)}
                className="rounded-lg border border-[#C9A45C]/40 bg-[#C9A45C]/20 px-3 py-1.5 text-xs font-bold text-[#E6CC91] hover:bg-[#C9A45C]/30"
              >
                Switch to BNB (97)
              </button>
              <button
                onClick={() => void handleConnectOrSwitch(84532)}
                className="rounded-lg border border-blue-400/40 bg-blue-500/20 px-3 py-1.5 text-xs font-bold text-blue-200 hover:bg-blue-500/30"
              >
                Switch to Base (84532)
              </button>
            </div>
          </div>
        )}

        {/* Global Notices / Alerts */}
        {error && (
          <div role="alert" className="mb-5 flex gap-3 rounded-xl border border-rose-500/20 bg-rose-500/10 p-4 text-sm text-rose-300">
            <CircleAlert size={18} className="shrink-0" />
            <div className="flex-1">
              {error}
              {error.includes('Install a Solana wallet') && (
                <a className="ml-2 underline font-semibold" href="https://phantom.app/download" target="_blank" rel="noreferrer">
                  Install Phantom
                </a>
              )}
            </div>
          </div>
        )}
        {notice && (
          <div role="status" className="mb-5 flex gap-3 rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-4 text-sm text-emerald-200">
            <CheckCircle2 size={18} className="shrink-0" />
            <span>{notice}</span>
          </div>
        )}

        {/* Network Cards Grid */}
        <div className="mb-8 grid gap-4 md:grid-cols-3">
          {/* Card 1: BNB Chain Testnet */}
          {(activeTab === 'all' || activeTab === 'bnb') && (
            <div className={`rounded-2xl border p-6 transition flex flex-col justify-between ${
              isBnbActive
                ? 'border-[#C9A45C]/40 bg-[#161613] shadow-lg shadow-[#C9A45C]/5'
                : 'border-white/10 bg-[#151512]'
            }`}>
              <div>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full bg-[#F3BA2F]" />
                    <span className="text-xs font-bold uppercase tracking-wider text-[#A8A397]">BNB Testnet</span>
                  </div>
                  <span className={`rounded-full border px-2.5 py-0.5 text-[10px] font-semibold ${
                    isBnbActive
                      ? 'border-[#C9A45C]/30 bg-[#C9A45C]/15 text-[#E6CC91]'
                      : 'border-white/10 text-[#77746B]'
                  }`}>
                    {isBnbActive ? 'Active on 97' : 'Chain 97 · EVM'}
                  </span>
                </div>

                <div className="mt-5 flex items-center gap-3">
                  <Wallet className="text-[#C9A45C] shrink-0" size={18} />
                  <span className="font-mono text-xs break-all">
                    {isHydrated && isConnected && address ? shortAddress(address) : 'Wallet disconnected'}
                  </span>
                </div>

                {bnbWalletRecord && (
                  <div className="mt-4 flex items-center gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-3 py-1.5 text-[11px] text-emerald-300">
                    <CheckCircle2 size={13} className="shrink-0" />
                    <span>{bnbWalletRecord.isPrimary ? 'Primary Identity Anchor' : 'Linked & Verified (EIP-191)'}</span>
                  </div>
                )}
              </div>

              <div className="mt-6 space-y-2">
                {!isConnected ? (
                  <button
                    onClick={() => void handleConnectOrSwitch(97)}
                    disabled={working}
                    className="w-full rounded-xl bg-[#C9A45C] px-4 py-2.5 text-xs font-bold uppercase tracking-wider text-[#0A0A09] hover:bg-[#E6CC91] transition disabled:opacity-50"
                  >
                    Connect BNB Wallet
                  </button>
                ) : !isBnbActive ? (
                  <button
                    onClick={() => void handleConnectOrSwitch(97)}
                    disabled={working}
                    className="w-full rounded-xl border border-[#C9A45C]/40 bg-[#C9A45C]/10 px-4 py-2.5 text-xs font-bold uppercase tracking-wider text-[#E6CC91] hover:bg-[#C9A45C]/20 transition disabled:opacity-50"
                  >
                    Switch to BNB Testnet
                  </button>
                ) : !profile ? (
                  <button
                    onClick={() => void createIdentity(97)}
                    disabled={working}
                    className="w-full rounded-xl bg-[#C9A45C] px-4 py-2.5 text-xs font-bold uppercase tracking-wider text-[#0A0A09] hover:bg-[#E6CC91] transition disabled:opacity-50"
                  >
                    {working ? 'Signing Proof…' : 'Create Unified Identity (BNB)'}
                  </button>
                ) : !bnbWalletRecord ? (
                  <button
                    onClick={() => void linkEvmWallet('bnb:97')}
                    disabled={working}
                    className="w-full rounded-xl border border-[#C9A45C]/40 bg-[#C9A45C]/15 px-4 py-2.5 text-xs font-bold uppercase tracking-wider text-[#E6CC91] hover:bg-[#C9A45C]/25 transition disabled:opacity-50"
                  >
                    {working ? 'Signing Proof…' : 'Link BNB Wallet (EIP-191)'}
                  </button>
                ) : (
                  <div className="w-full text-center text-[11px] font-semibold text-[#8F8B81] py-1">
                    ✓ BNB Wallet Linked
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Card 2: Base Sepolia */}
          {(activeTab === 'all' || activeTab === 'base') && (
            <div className={`rounded-2xl border p-6 transition flex flex-col justify-between ${
              isBaseActive
                ? 'border-blue-400/40 bg-[#12161A] shadow-lg shadow-blue-500/5'
                : 'border-white/10 bg-[#151512]'
            }`}>
              <div>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full bg-blue-500" />
                    <span className="text-xs font-bold uppercase tracking-wider text-[#A8A397]">Base Sepolia</span>
                  </div>
                  <span className={`rounded-full border px-2.5 py-0.5 text-[10px] font-semibold ${
                    isBaseActive
                      ? 'border-blue-400/30 bg-blue-500/15 text-blue-300'
                      : 'border-white/10 text-[#77746B]'
                  }`}>
                    {isBaseActive ? 'Active on 84532' : 'Chain 84532 · EVM'}
                  </span>
                </div>

                <div className="mt-5 flex items-center gap-3">
                  <Wallet className="text-blue-400 shrink-0" size={18} />
                  <span className="font-mono text-xs break-all">
                    {isHydrated && isConnected && address ? shortAddress(address) : 'Wallet disconnected'}
                  </span>
                </div>

                {baseWalletRecord && (
                  <div className="mt-4 flex items-center gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-3 py-1.5 text-[11px] text-emerald-300">
                    <CheckCircle2 size={13} className="shrink-0" />
                    <span>{baseWalletRecord.isPrimary ? 'Primary Identity Anchor' : 'Linked & Verified (EIP-191)'}</span>
                  </div>
                )}
              </div>

              <div className="mt-6 space-y-2">
                {!isConnected ? (
                  <button
                    onClick={() => void handleConnectOrSwitch(84532)}
                    disabled={working}
                    className="w-full rounded-xl bg-blue-600 px-4 py-2.5 text-xs font-bold uppercase tracking-wider text-white hover:bg-blue-500 transition disabled:opacity-50"
                  >
                    Connect Base Sepolia Wallet
                  </button>
                ) : !isBaseActive ? (
                  <button
                    onClick={() => void handleConnectOrSwitch(84532)}
                    disabled={working}
                    className="w-full rounded-xl border border-blue-400/40 bg-blue-500/15 px-4 py-2.5 text-xs font-bold uppercase tracking-wider text-blue-200 hover:bg-blue-500/25 transition disabled:opacity-50"
                  >
                    Switch to Base Sepolia
                  </button>
                ) : !profile ? (
                  <button
                    onClick={() => void createIdentity(84532)}
                    disabled={working}
                    className="w-full rounded-xl bg-blue-600 px-4 py-2.5 text-xs font-bold uppercase tracking-wider text-white hover:bg-blue-500 transition disabled:opacity-50"
                  >
                    {working ? 'Signing Proof…' : 'Create Unified Identity (Base)'}
                  </button>
                ) : !baseWalletRecord ? (
                  <button
                    onClick={() => void linkEvmWallet('base:84532')}
                    disabled={working}
                    className="w-full rounded-xl border border-blue-400/40 bg-blue-500/20 px-4 py-2.5 text-xs font-bold uppercase tracking-wider text-blue-200 hover:bg-blue-500/30 transition disabled:opacity-50"
                  >
                    {working ? 'Signing Proof…' : 'Link Base Sepolia (EIP-191)'}
                  </button>
                ) : (
                  <div className="w-full text-center text-[11px] font-semibold text-[#8F8B81] py-1">
                    ✓ Base Sepolia Wallet Linked
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Card 3: Solana Devnet */}
          {(activeTab === 'all' || activeTab === 'solana') && (
            <div className="rounded-2xl border border-white/10 bg-[#151512] p-6 flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full bg-[#8B7BFF]" />
                    <span className="text-xs font-bold uppercase tracking-wider text-[#A8A397]">Solana Devnet</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className={`rounded-full border px-2.5 py-0.5 text-[10px] ${
                      rpc?.ok ? 'border-emerald-400/20 text-emerald-300' : 'border-amber-400/20 text-amber-300'
                    }`}>
                      {checkingRpc ? 'Checking RPC…' : rpc ? (rpc.ok ? `RPC live · slot ${rpc.slot}` : 'RPC unavailable') : 'Checking RPC…'}
                    </span>
                    {rpc && !rpc.ok && (
                      <button
                        onClick={() => void checkSolanaRpc()}
                        disabled={checkingRpc}
                        title="Retry Solana Devnet RPC check"
                        className="rounded-full border border-amber-400/30 p-1 text-amber-300 hover:bg-amber-400/10 transition-colors disabled:opacity-50"
                      >
                        <RefreshCw size={10} className={checkingRpc ? 'animate-spin' : ''} />
                      </button>
                    )}
                  </div>
                </div>

                <div className="mt-5 flex items-center gap-3">
                  <Wallet className="text-[#8B7BFF] shrink-0" size={18} />
                  <span className="font-mono text-xs break-all">
                    {solanaAddress ? shortAddress(solanaAddress) : 'No Solana wallet linked'}
                  </span>
                </div>

                {solanaWalletRecord && (
                  <div className="mt-4 flex items-center gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-3 py-1.5 text-[11px] text-emerald-300">
                    <CheckCircle2 size={13} className="shrink-0" />
                    <span>Linked & Verified (Ed25519)</span>
                  </div>
                )}
              </div>

              <div className="mt-6">
                <button
                  onClick={linkSolanaWallet}
                  disabled={!profile || working}
                  className="w-full rounded-xl border border-[#8B7BFF]/30 bg-[#8B7BFF]/10 px-4 py-2.5 text-xs font-bold uppercase tracking-wider text-[#C5BCFF] hover:bg-[#8B7BFF]/15 transition disabled:opacity-50"
                >
                  {working
                    ? 'Waiting for wallet…'
                    : !profile
                    ? 'Create identity first'
                    : solanaWalletRecord
                    ? 'Link another Solana wallet'
                    : 'Connect & link Solana wallet'}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Profile ID Card */}
        {profile && (
          <div className="mb-6 rounded-xl border border-white/5 bg-black/20 p-4 font-mono text-xs text-[#A8A397] flex flex-wrap items-center justify-between gap-3">
            <div>
              <span className="text-[#77746B]">VEILIO Unified Identity ID:</span>{' '}
              <span className="text-[#F5F2E8] font-bold">{profile.id}</span>
            </div>
            <div className="text-[11px] text-[#77746B]">
              Primary Anchor: <span className="text-[#E6CC91]">{shortAddress(profile.primaryWallet)}</span>
            </div>
          </div>
        )}

        {/* Verified Wallet Links Section */}
        <section className="mb-6 rounded-2xl border border-white/10 bg-[#151512] p-6">
          <div className="flex items-center gap-3">
            <ShieldCheck className="text-[#C9A45C]" size={20} />
            <h2 className="text-sm font-extrabold uppercase tracking-wider">Verified Wallet Links</h2>
          </div>
          {!profile ? (
            <p className="mt-5 text-sm text-[#77746B]">
              Connect an EVM wallet (BNB Chain Testnet or Base Sepolia) to create or load your identity.
            </p>
          ) : activeWallets.length === 0 ? (
            <p className="mt-5 text-sm text-[#77746B]">No wallet links yet.</p>
          ) : (
            <div className="mt-5 divide-y divide-white/[0.06]">
              {activeWallets.map((wallet) => (
                <div key={`${wallet.chainFamily}:${wallet.address}`} className="flex flex-wrap items-center justify-between gap-3 py-4 first:pt-0 last:pb-0">
                  <div>
                    <div className="font-mono text-sm">
                      {shortAddress(wallet.address)}{' '}
                      <span className="text-[#77746B]">· {wallet.isPrimary ? 'Primary Anchor' : 'Linked Wallet'}</span>
                    </div>
                    <div className="mt-1 text-xs text-[#8F8B81]">
                      {networkName(wallet.networkId)} · {wallet.proofType === 'ed25519' ? 'Ed25519 verified' : 'EIP-191 verified'}
                    </div>
                  </div>
                  <span className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase text-emerald-300">
                    <CheckCircle2 size={13} />
                    Control verified
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Unified Activity History */}
        <section className="rounded-2xl border border-white/10 bg-[#151512] p-6">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="text-sm font-extrabold uppercase tracking-wider">Unified Activity</h2>
              <p className="mt-1 text-xs text-[#77746B]">
                Each entry preserves its source network (BNB, Base Sepolia, or Solana Devnet) and transaction reference.
              </p>
            </div>
            <span className="text-xs text-[#8F8B81]">{activity.length} records</span>
          </div>
          {!profile ? (
            <p className="mt-6 text-sm text-[#77746B]">Create or load an identity to see linked-wallet activity.</p>
          ) : activity.length === 0 ? (
            <p className="mt-6 rounded-xl border border-white/5 bg-black/20 p-5 text-sm leading-6 text-[#8F8B81]">
              No activity has been indexed for this identity yet. Wallet linking is live; activity appears when a trusted VEILIO event source records it.
            </p>
          ) : (
            <div className="mt-5 divide-y divide-white/[0.06]">
              {activity.map((item) => {
                const href = transactionUrl(item);
                return (
                  <div key={item.id} className="flex flex-wrap items-center justify-between gap-3 py-4 first:pt-0 last:pb-0">
                    <div className="min-w-0">
                      <div className="font-semibold text-sm">{item.title || item.activityType.replaceAll('_', ' ')}</div>
                      <p className="mt-1 text-xs text-[#8F8B81]">{item.description}</p>
                      <p className="mt-2 text-[10px] uppercase tracking-wider text-[#C9A45C]">
                        {networkName(item.networkId)} · {item.status}
                      </p>
                    </div>
                    <div className="flex items-center gap-3 text-xs text-[#8F8B81]">
                      {new Date(item.timestamp).toLocaleString()}{' '}
                      {href && (
                        <a href={href} target="_blank" rel="noreferrer" aria-label="Open transaction in explorer" className="text-[#E6CC91] hover:text-white">
                          <ArrowUpRight size={15} />
                        </a>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        <p className="mt-6 flex items-start gap-2 text-xs leading-5 text-[#77746B]">
          <Link2 size={14} className="mt-0.5 shrink-0" />
          This creates a unified off-chain identity that references cryptographic proofs of wallet control across separate chains. It does not bridge assets, merge balances, or move funds between chains.
        </p>
      </div>
    </div>
  );
}
