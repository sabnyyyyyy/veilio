'use client';

import React, { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { useSearchParams, useRouter } from 'next/navigation';
import ServicesNav from '@/components/services/ServicesNav';
import { useAccount } from 'wagmi';
import { useServicesWalletAuth } from '@/components/services/useServicesWalletAuth';
import {
  MessageSquare,
  Bot,
  UserCheck,
  Send,
  CreditCard,
  CheckCircle2,
  Clock,
  Loader2,
  X,
  FileCheck,
  ArrowRight,
  ShieldAlert,
} from 'lucide-react';
import type { Conversation, ServiceMessage, PaymentRequest } from '@/lib/server/servicesDb';
import { saveServiceActivity } from '@/lib/walletStorage';

// Accepts canonical ids ('base:84532') and legacy stored labels ('Base Sepolia').
function paymentRequestNetworkLabel(network: string | undefined, bnbLabel: string): string {
  const n = String(network || '').toLowerCase();
  if (n.includes('base')) return 'Base Sepolia';
  if (n.includes('solana')) return 'Solana Devnet';
  return bnbLabel;
}

export function ServicesMessagesContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { address: evmAddress, isConnected: evmConnected } = useAccount();
  const { getSession, getSessionHeaders, signAction } = useServicesWalletAuth();

  // Solana participants chat with their injected (Phantom-compatible) wallet.
  const [solanaAddress, setSolanaAddress] = useState<string | null>(null);
  useEffect(() => {
    const provider = typeof window !== 'undefined' ? (window as any).solana : null;
    if (!provider) return;
    if (provider.publicKey) setSolanaAddress(provider.publicKey.toString());
    const onChange = (pk: any) => setSolanaAddress(pk ? pk.toString() : null);
    provider.on?.('accountChanged', onChange);
    return () => provider.removeListener?.('accountChanged', onChange);
  }, []);
  const connectSolanaWallet = async () => {
    const provider = typeof window !== 'undefined' ? (window as any).solana : null;
    if (!provider) {
      alert('Phantom or a compatible Solana wallet is not detected.');
      return;
    }
    const res = await provider.connect();
    setSolanaAddress(res.publicKey.toString());
  };

  // Active chat identity: the EVM wallet if connected, otherwise the Solana wallet.
  const address = evmAddress || solanaAddress || undefined;
  const isConnected = evmConnected || Boolean(solanaAddress);
  const [authError, setAuthError] = useState<string | null>(null);


  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConvId, setActiveConvId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ServiceMessage[]>([]);
  const [loadingConvs, setLoadingConvs] = useState(true);
  const [loadingMsgs, setLoadingMsgs] = useState(false);
  const [inputText, setInputText] = useState('');
  const [sending, setSending] = useState(false);

  // Payment Request Modal
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [prPrice, setPrPrice] = useState('');
  const [prNetwork, setPrNetwork] = useState<'bnb:97' | 'base:84532' | 'solana:devnet'>('bnb:97');
  const [prDescription, setPrDescription] = useState('');
  const [prScope, setPrScope] = useState('');
  const [prDeadlineDays, setPrDeadlineDays] = useState('3');
  const [creatingPr, setCreatingPr] = useState(false);
  const [paymentRequestsMap, setPaymentRequestsMap] = useState<Record<string, PaymentRequest>>({});

  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Fetch user conversations
  const fetchConversations = async () => {
    if (!address) {
      setLoadingConvs(false);
      return;
    }
    try {
      // Signed services session (one wallet prompt, reused for polling; see lib/serviceAuth.ts)
      const headers = await getSessionHeaders(address);
      setAuthError(null);
      const res = await fetch('/api/conversations', { headers, cache: 'no-store' });
      const data = await res.json();
      if (!res.ok) setAuthError(data.error || 'Failed to load conversations');
      if (data.success && Array.isArray(data.conversations)) {
        setConversations(data.conversations);
        // If query has conversationId, activate it
        const queryConvId = searchParams.get('conversationId');
        if (queryConvId) {
          setActiveConvId(queryConvId);
        } else if (!activeConvId && data.conversations.length > 0) {
          setActiveConvId(data.conversations[0].id);
        }
      }
    } catch (err: any) {
      console.error(err);
      setAuthError(err?.message || 'Wallet session signature is required to load conversations');
    } finally {
      setLoadingConvs(false);
    }
  };

  useEffect(() => {
    fetchConversations();
  }, [address]);

  // Fetch messages for active conversation
  const fetchMessages = async (showSpinner = false) => {
    if (!activeConvId || !address) return;
    try {
      if (showSpinner) setLoadingMsgs(true);
      const headers = await getSessionHeaders(address);
      const res = await fetch(`/api/conversations/${activeConvId}/messages`, { headers, cache: 'no-store' });
      const data = await res.json();
      if (data.success && Array.isArray(data.messages)) {
        setMessages(data.messages);

        // Fetch payment requests for messages that contain paymentRequestId
        const prIds = data.messages
          .map((m: ServiceMessage) => m.paymentRequestId)
          .filter(Boolean) as string[];

        for (const prId of prIds) {
          if (!paymentRequestsMap[prId]) {
            fetch(`/api/payment-requests/${prId}`, { headers, cache: 'no-store' })
              .then((r) => r.json())
              .then((prData) => {
                if (prData.success && prData.paymentRequest) {
                  setPaymentRequestsMap((prev) => ({
                    ...prev,
                    [prId]: prData.paymentRequest,
                  }));
                }
              })
              .catch(console.error);
          }
        }
      }
    } catch (err) {
      console.error(err);
    } finally {
      if (showSpinner) setLoadingMsgs(false);
    }
  };

  useEffect(() => {
    if (activeConvId) {
      fetchMessages(true);
      // Polling every 3 seconds for active conversation
      const interval = setInterval(() => {
        fetchMessages(false);
      }, 3000);
      return () => clearInterval(interval);
    }
  }, [activeConvId, address]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim() || !activeConvId || !address) return;

    try {
      setSending(true);
      const session = await getSession(address);
      const res = await fetch(`/api/conversations/${activeConvId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          senderId: address,
          senderType: 'human',
          content: inputText.trim(),
          auth: session,
        }),
      });

      const data = await res.json();
      if (data.success && data.message) {
        setInputText('');
        fetchMessages(false);
      } else {
        alert(data.error || 'Failed to send message');
      }
    } catch (err) {
      console.error(err);
      alert('Error sending message');
    } finally {
      setSending(false);
    }
  };

  const handleCreatePaymentRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeConv || !address || !prPrice || !prDescription) return;

    try {
      setCreatingPr(true);
      const deadlineDaysNum = Number(prDeadlineDays) || 3;
      const deadline = Date.now() + deadlineDaysNum * 24 * 3600 * 1000;
      const currency = prNetwork === 'base:84532' ? 'ETH' : prNetwork === 'solana:devnet' ? 'SOL' : 'BNB';
      // Payment terms are financial: per-request signature with a consumed nonce.
      const prAuth = await signAction(address, 'create-payment-request', activeConv.id);

      const res = await fetch('/api/payment-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversationId: activeConv.id,
          serviceId: activeConv.serviceId,
          buyerId: activeConv.buyerId,
          sellerId: activeConv.sellerId,
          description: prDescription.trim(),
          scope: prScope.trim() || prDescription.trim(),
          agreedPrice: prPrice.trim(),
          currency,
          network: prNetwork,
          deadline,
          auth: prAuth,
        }),
      });

      const data = await res.json();
      if (data.success && data.paymentRequest) {
        saveServiceActivity({
          id: `pr_${data.paymentRequest.id}`,
          type: 'payment_request_created',
          orderId: data.paymentRequest.id,
          title: prDescription.trim() || 'Service Payment Request',
          amount: prPrice.trim(),
          currency,
          userAddress: address,
          role: 'seller',
          networkId: prNetwork,
          timestamp: Date.now(),
          status: 'AwaitingPayment',
          isOnChainConfirmed: false,
        });
        setShowPaymentModal(false);
        setPrPrice('');
        setPrDescription('');
        setPrScope('');
        setPrNetwork('bnb:97');
        fetchMessages(false);
      } else {
        alert(data.error || 'Failed to create payment request');
      }
    } catch (err) {
      console.error(err);
      alert('Error creating payment request');
    } finally {
      setCreatingPr(false);
    }
  };

  const handleAcceptPaymentRequest = async (paymentRequestId: string) => {
    if (!address) return;

    try {
      // Generate cryptographic authentication payload (SEC-NEW-02)
      const acceptAuth = await signAction(address, 'accept-payment-request', paymentRequestId);

      const res = await fetch(`/api/payment-requests/${paymentRequestId}/accept`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          buyerAddress: address,
          auth: acceptAuth,
        }),
      });

      const data = await res.json();
      if (data.success && data.order) {
        // Redirect to order detail to fund escrow
        router.push(`/services/orders/${data.order.id}`);
      } else {
        alert(data.error || 'Failed to accept payment request');
      }
    } catch (err: any) {
      console.error(err);
      alert(err?.message || 'Error accepting payment request');
    }
  };

  const activeConv = conversations.find((c) => c.id === activeConvId);
  const isSeller = activeConv && address && activeConv.sellerId.toLowerCase() === address.toLowerCase();
  const isBuyer = activeConv && address && activeConv.buyerId.toLowerCase() === address.toLowerCase();

  return (
    <div className="w-full pb-12 flex flex-col selection:bg-[#C9A45C]/30">
      <ServicesNav />

        <div className="max-w-7xl mx-auto px-4 sm:px-6 pt-6 sm:pt-8 w-full flex-1 flex flex-col">
          {!isConnected ? (
            <div className="p-12 rounded-2xl bg-[#151512] border border-white/5 text-center space-y-4 max-w-md mx-auto my-12">
              <MessageSquare className="w-10 h-10 text-[#C9A45C] mx-auto opacity-70" />
              <h3 className="text-base font-bold text-[#F5F2E8]">Connect Wallet to Chat</h3>
              <p className="text-xs text-[#A8A397]">
                Private service negotiations are authenticated by your Web3 wallet address.
              </p>
              <button
                onClick={() => connectSolanaWallet().catch((err) => console.error(err))}
                className="inline-flex items-center gap-2 px-4 py-2 bg-white/10 hover:bg-white/20 text-xs font-bold uppercase tracking-wider rounded-xl transition-colors"
              >
                Connect Solana Wallet
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 flex-1 min-h-[620px] bg-[#151512] border border-white/5 rounded-3xl overflow-hidden shadow-2xl">
              {/* Left Column: Conversation List */}
              <div className="border-r border-white/5 flex flex-col h-full bg-[#11110E]">
                <div className="p-4 border-b border-white/5 flex items-center justify-between">
                  <span className="text-xs font-bold uppercase tracking-wider text-[#F5F2E8] flex items-center gap-2">
                    <MessageSquare className="w-4 h-4 text-[#C9A45C]" /> Inbox (
                    {conversations.length})
                  </span>
                </div>

                <div className="flex-1 overflow-y-auto divide-y divide-white/5">
                  {authError && (
                    <div className="p-4 text-[11px] text-rose-300 space-y-2">
                      <p>{authError}</p>
                      <button onClick={() => fetchConversations()} className="underline text-[#C9A45C]">
                        Sign in again
                      </button>
                    </div>
                  )}
                  {loadingConvs ? (
                    <div className="p-8 flex justify-center">
                      <Loader2 className="w-6 h-6 text-[#C9A45C] animate-spin" />
                    </div>
                  ) : conversations.length === 0 ? (
                    <div className="p-8 text-center text-xs text-[#A8A397] space-y-2">
                      <p>No active conversations yet.</p>
                      <p className="text-[11px] opacity-75">
                        Discover a service and click "Contact & Negotiate" to begin.
                      </p>
                    </div>
                  ) : (
                    conversations.map((c) => {
                      const isActive = c.id === activeConvId;
                      const partnerAddress =
                        address && c.buyerId.toLowerCase() === address.toLowerCase()
                          ? c.sellerId
                          : c.buyerId;

                      return (
                        <button
                          key={c.id}
                          onClick={() => setActiveConvId(c.id)}
                          className={`w-full p-4 text-left transition-colors flex flex-col gap-1.5 ${
                            isActive ? 'bg-[#1D1D18] border-l-2 border-[#C9A45C]' : 'hover:bg-white/[0.02]'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-xs font-bold text-[#F5F2E8] truncate max-w-[170px]">
                              {c.serviceTitle}
                            </span>
                            <span className="text-[10px] text-[#A8A397] font-mono">
                              {new Date(c.lastMessageAt).toLocaleTimeString([], {
                                hour: '2-digit',
                                minute: '2-digit',
                              })}
                            </span>
                          </div>
                          <p className="text-[11px] text-[#A8A397] truncate">{c.lastMessageText}</p>
                          <span className="text-[10px] font-mono text-[#C9A45C] truncate">
                            With: {partnerAddress.slice(0, 6)}...{partnerAddress.slice(-4)}
                          </span>
                        </button>
                      );
                    })
                  )}
                </div>
              </div>

              {/* Right Column: Chat Window & Negotiation Panel */}
              <div className="md:col-span-2 flex flex-col h-full bg-[#151512]">
                {activeConv ? (
                  <>
                    {/* Chat Header */}
                    <div className="p-4 border-b border-white/5 flex flex-wrap items-center justify-between gap-3 bg-[#11110E]">
                      <div>
                        <h3 className="text-sm font-bold text-[#F5F2E8]">{activeConv.serviceTitle}</h3>
                        <p className="text-[11px] text-[#A8A397] font-mono">
                          {isSeller ? `Negotiating with Buyer: ${activeConv.buyerId}` : `Provider: ${activeConv.sellerId}`}
                        </p>
                      </div>

                      {/* Seller Action: Create Payment Request */}
                      {isSeller && (
                        <button
                          onClick={() => setShowPaymentModal(true)}
                          className="px-3.5 py-2 bg-[#C9A45C] hover:bg-[#E6CC91] text-[#0A0A09] text-xs font-bold uppercase tracking-wider rounded-xl transition-colors flex items-center gap-1.5 shadow"
                        >
                          <CreditCard className="w-3.5 h-3.5" />
                          <span>Request Payment</span>
                        </button>
                      )}
                    </div>

                    {/* Messages Body */}
                    <div className="flex-1 p-6 overflow-y-auto space-y-4">
                      {loadingMsgs ? (
                        <div className="h-full flex items-center justify-center">
                          <Loader2 className="w-6 h-6 text-[#C9A45C] animate-spin" />
                        </div>
                      ) : messages.length === 0 ? (
                        <div className="h-full flex flex-col items-center justify-center text-center text-xs text-[#A8A397] space-y-2">
                          <MessageSquare className="w-8 h-8 text-[#C9A45C] opacity-50" />
                          <p>Start your negotiation message below.</p>
                          <p className="text-[11px] opacity-75">
                            Discuss specifications, deliverables, deadline, and agreed price.
                          </p>
                        </div>
                      ) : (
                        messages.map((m) => {
                          const isMe = address && m.senderId.toLowerCase() === address.toLowerCase();
                          const pr = m.paymentRequestId ? paymentRequestsMap[m.paymentRequestId] : null;

                          return (
                            <div
                              key={m.id}
                              className={`flex flex-col ${isMe ? 'items-end' : 'items-start'} space-y-1.5`}
                            >
                              <div className="flex items-center gap-2 text-[10px] text-[#A8A397] px-1">
                                {m.senderType === 'agent' ? (
                                  <span className="flex items-center gap-1 text-cyan-400 font-bold">
                                    <Bot className="w-3 h-3" /> AI Agent
                                  </span>
                                ) : (
                                  <span className="font-mono">
                                    {isMe ? 'You' : `${m.senderId.slice(0, 6)}...${m.senderId.slice(-4)}`}
                                  </span>
                                )}
                                <span>•</span>
                                <span>
                                  {new Date(m.createdAt).toLocaleTimeString([], {
                                    hour: '2-digit',
                                    minute: '2-digit',
                                  })}
                                </span>
                              </div>

                              {/* Structured Payment Request Card in chat */}
                              {pr ? (
                                <div className="p-5 rounded-2xl bg-[#0A0A09] border border-[#C9A45C]/40 space-y-4 max-w-md w-full shadow-lg">
                                  <div className="flex items-center justify-between gap-2 border-b border-white/5 pb-3">
                                    <span className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-[#C9A45C]">
                                      <CreditCard className="w-4 h-4" /> Agreed Payment Request
                                    </span>
                                    <div className="flex items-center gap-1.5">
                                      <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded-full bg-cyan-500/20 text-cyan-400 border border-cyan-500/30">
                                        {paymentRequestNetworkLabel(pr.network, 'BNB Chain')}
                                      </span>
                                      <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full ${
                                        pr.status === 'accepted' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-amber-500/20 text-amber-400'
                                      }`}>
                                        {pr.status}
                                      </span>
                                    </div>
                                  </div>

                                  <div className="space-y-1.5 text-xs">
                                    <div className="text-base font-extrabold text-[#F5F2E8]">
                                      {pr.agreedPrice} <span className="text-[#C9A45C] font-mono">{pr.currency}</span>
                                    </div>
                                    <p className="text-[#F5F2E8] font-medium">{pr.description}</p>
                                    <div className="text-[11px] text-[#A8A397]">
                                      Scope: {pr.scope}
                                    </div>
                                    <div className="flex items-center gap-1.5 text-[11px] text-[#A8A397] pt-1">
                                      <Clock className="w-3 h-3 text-[#C9A45C]" />
                                      <span>Deadline: {new Date(pr.deadline).toLocaleDateString()}</span>
                                    </div>
                                  </div>

                                  {/* If Buyer and Pending: Accept button */}
                                  {isBuyer && pr.status === 'pending' && (
                                    <button
                                      onClick={() => handleAcceptPaymentRequest(pr.id)}
                                      className="w-full py-2.5 px-4 bg-[#C9A45C] hover:bg-[#E6CC91] text-[#0A0A09] text-xs font-bold uppercase tracking-wider rounded-xl transition-colors flex items-center justify-center gap-2 shadow"
                                    >
                                      <span>Accept Terms & Proceed to Escrow</span>
                                      <ArrowRight className="w-3.5 h-3.5" />
                                    </button>
                                  )}

                                  {pr.status === 'accepted' && (
                                    <div className="space-y-2 pt-1">
                                      <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 text-[11px] text-amber-300 flex items-start gap-2.5">
                                        <Clock className="w-4 h-4 shrink-0 text-amber-400 mt-0.5" />
                                        <div>
                                          <div className="font-bold text-amber-200">Terms Accepted — Awaiting On-Chain Deposit</div>
                                          <div className="text-[10px] text-amber-300/80 mt-0.5 leading-relaxed">
                                            Agreement is authorized off-chain. Funds are NOT yet in escrow until the buyer submits an on-chain deposit on {paymentRequestNetworkLabel(pr.network, 'BNB Chain Testnet')}.
                                          </div>
                                        </div>
                                      </div>
                                      {isBuyer && (
                                        <Link
                                          href="/services/orders"
                                          className="w-full py-2.5 px-4 bg-[#C9A45C] hover:bg-[#E6CC91] text-[#0A0A09] text-xs font-bold uppercase tracking-wider rounded-xl transition-colors flex items-center justify-center gap-2 shadow"
                                        >
                                          <span>Deposit Escrow in My Orders</span>
                                          <ArrowRight className="w-3.5 h-3.5" />
                                        </Link>
                                      )}
                                    </div>
                                  )}

                                  {pr.status === 'funded' && (
                                    <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-[11px] text-emerald-300 flex items-center gap-2.5">
                                      <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400" />
                                      <div>
                                        <div className="font-bold text-emerald-200">On-Chain Escrow Funded</div>
                                        <div className="text-[10px] text-emerald-300/80">Funds are locked safely in VeilServiceEscrow contract. Work is in progress!</div>
                                      </div>
                                    </div>
                                  )}
                                </div>
                              ) : (
                                <div
                                  className={`p-3.5 rounded-2xl text-xs max-w-md leading-relaxed ${
                                    isMe
                                      ? 'bg-[#C9A45C] text-[#0A0A09] font-medium rounded-tr-none'
                                      : 'bg-[#0A0A09] text-[#F5F2E8] border border-white/5 rounded-tl-none'
                                  }`}
                                >
                                  {m.content}
                                </div>
                              )}
                            </div>
                          );
                        })
                      )}
                      <div ref={messagesEndRef} />
                    </div>

                    {/* Chat Input */}
                    <form onSubmit={handleSendMessage} className="p-4 border-t border-white/5 flex gap-3 bg-[#11110E]">
                      <input
                        type="text"
                        value={inputText}
                        onChange={(e) => setInputText(e.target.value)}
                        placeholder="Type your message, counter-offer, or question..."
                        className="flex-1 bg-[#151512] border border-white/10 rounded-xl px-4 py-3 text-xs text-[#F5F2E8] placeholder-[#A8A397]/50 focus:outline-none focus:border-[#C9A45C]"
                      />
                      <button
                        type="submit"
                        disabled={sending || !inputText.trim()}
                        className="px-5 py-3 bg-[#C9A45C] hover:bg-[#E6CC91] text-[#0A0A09] text-xs font-bold uppercase tracking-wider rounded-xl transition-colors flex items-center gap-2 disabled:opacity-40"
                      >
                        {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                      </button>
                    </form>
                  </>
                ) : (
                  <div className="h-full flex flex-col items-center justify-center p-12 text-center text-[#A8A397] space-y-3">
                    <MessageSquare className="w-10 h-10 text-[#C9A45C] opacity-50" />
                    <h3 className="text-sm font-bold text-[#F5F2E8]">Select a Conversation</h3>
                    <p className="text-xs max-w-sm">
                      Choose an active conversation from the left to read messages and negotiate terms.
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

      {/* Modal: Create Payment Request */}
      {showPaymentModal && activeConv && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#151512] border border-[#C9A45C]/30 rounded-2xl max-w-md w-full p-6 space-y-6 shadow-2xl relative">
            <button
              onClick={() => setShowPaymentModal(false)}
              className="absolute top-5 right-5 text-[#A8A397] hover:text-[#F5F2E8] p-1"
            >
              <X className="w-4 h-4" />
            </button>

            <div className="space-y-1">
              <span className="text-xs font-bold text-[#C9A45C] uppercase tracking-wider flex items-center gap-1.5">
                <CreditCard className="w-4 h-4" /> Create Payment Request
              </span>
              <h3 className="text-base font-bold text-[#F5F2E8]">
                Propose Final Terms for Order
              </h3>
              <p className="text-xs text-[#A8A397]">
                Send an agreed payment request to the buyer. Upon acceptance, the buyer will deposit the agreed funds into on-chain escrow.
              </p>
            </div>

            <form onSubmit={handleCreatePaymentRequest} className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-[10px] uppercase tracking-widest text-[#A8A397] block font-bold">
                  Escrow Settlement Network *
                </label>
                <select
                  value={prNetwork}
                  onChange={(e) => setPrNetwork(e.target.value as any)}
                  className="w-full bg-[#0A0A09] border border-white/10 rounded-xl px-4 py-2.5 text-xs text-[#F5F2E8] focus:outline-none focus:border-[#C9A45C]"
                >
                  <option value="bnb:97">BNB Chain Testnet (BNB)</option>
                  <option value="base:84532">Base Sepolia (ETH)</option>
                  <option value="solana:devnet">Solana Devnet (SOL)</option>
                </select>
              </div>

              <div className="space-y-1.5">
                <label className="text-[10px] uppercase tracking-widest text-[#A8A397] block font-bold">
                  Agreed Price ({prNetwork === 'base:84532' ? 'ETH' : prNetwork === 'solana:devnet' ? 'SOL' : 'BNB'}) *
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  value={prPrice}
                  onChange={(e) => setPrPrice(e.target.value)}
                  placeholder="0.25"
                  required
                  className="w-full bg-[#0A0A09] border border-white/10 rounded-xl px-4 py-2.5 text-xs text-[#F5F2E8] focus:outline-none focus:border-[#C9A45C]"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-[10px] uppercase tracking-widest text-[#A8A397] block font-bold">
                  Description / Milestone Summary *
                </label>
                <input
                  type="text"
                  value={prDescription}
                  onChange={(e) => setPrDescription(e.target.value)}
                  placeholder="e.g. Full smart contract audit with remediation diff"
                  required
                  className="w-full bg-[#0A0A09] border border-white/10 rounded-xl px-4 py-2.5 text-xs text-[#F5F2E8] focus:outline-none focus:border-[#C9A45C]"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-[10px] uppercase tracking-widest text-[#A8A397] block font-bold">
                  Agreed Deliverable Scope
                </label>
                <textarea
                  rows={3}
                  value={prScope}
                  onChange={(e) => setPrScope(e.target.value)}
                  placeholder="Specific requirements, format, and acceptance criteria discussed in chat..."
                  className="w-full bg-[#0A0A09] border border-white/10 rounded-xl p-3 text-xs text-[#F5F2E8] focus:outline-none focus:border-[#C9A45C]"
                ></textarea>
              </div>

              <div className="space-y-1.5">
                <label className="text-[10px] uppercase tracking-widest text-[#A8A397] block font-bold">
                  Delivery Deadline (Days)
                </label>
                <input
                  type="number"
                  min="1"
                  max="60"
                  value={prDeadlineDays}
                  onChange={(e) => setPrDeadlineDays(e.target.value)}
                  className="w-full bg-[#0A0A09] border border-white/10 rounded-xl px-4 py-2.5 text-xs text-[#F5F2E8] focus:outline-none focus:border-[#C9A45C]"
                />
              </div>

              <div className="pt-2">
                <button
                  type="submit"
                  disabled={creatingPr}
                  className="w-full py-3 px-4 bg-[#C9A45C] hover:bg-[#E6CC91] text-[#0A0A09] text-xs font-bold uppercase tracking-wider rounded-xl transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  {creatingPr ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>Sending Request...</span>
                    </>
                  ) : (
                    <span>Send Payment Request to Buyer</span>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default function ServicesMessagesPage() {
  return (
    <React.Suspense
      fallback={
        <div className="w-full min-h-[60vh] flex items-center justify-center">
          <Loader2 className="w-8 h-8 animate-spin text-[#C9A45C]" />
        </div>
      }
    >
      <ServicesMessagesContent />
    </React.Suspense>
  );
}
