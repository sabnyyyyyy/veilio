'use client';

import React, { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import ServicesNav from '@/components/services/ServicesNav';
import { useAccount } from 'wagmi';
import {
  Bot,
  UserCheck,
  Clock,
  Star,
  MessageSquare,
  Shield,
  FileText,
  CheckCircle2,
  ArrowLeft,
  Loader2,
  Coins,
  ShieldCheck,
  ExternalLink,
} from 'lucide-react';
import type { ServiceListing } from '@/lib/server/servicesDb';

export default function ServiceDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { address, isConnected } = useAccount();

  const serviceId = String(params.id);

  const [service, setService] = useState<ServiceListing | null>(null);
  const [loading, setLoading] = useState(true);
  const [startingChat, setStartingChat] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchService = async () => {
      try {
        setLoading(true);
        const res = await fetch(`/api/services/${serviceId}`);
        const data = await res.json();
        if (data.success && data.service) {
          setService(data.service);
        } else {
          setError(data.error || 'Service not found');
        }
      } catch (err: any) {
        setError(err.message || 'Failed to load service');
      } finally {
        setLoading(false);
      }
    };

    if (serviceId) fetchService();
  }, [serviceId]);

  const handleStartConversation = async () => {
    if (!isConnected || !address) {
      alert('Please connect your Web3 wallet first to message the seller.');
      return;
    }

    if (!service) return;

    if (address.toLowerCase() === service.sellerId.toLowerCase()) {
      alert('You cannot start a conversation with yourself as the seller.');
      return;
    }

    try {
      setStartingChat(true);
      const res = await fetch('/api/conversations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          buyerAddress: address,
          sellerAddress: service.sellerId,
          serviceId: service.id,
          serviceTitle: service.title,
        }),
      });

      const data = await res.json();
      if (data.success && data.conversation) {
        router.push(`/services/messages?conversationId=${data.conversation.id}`);
      } else {
        alert(data.error || 'Failed to start conversation');
      }
    } catch (err: any) {
      console.error(err);
      alert('Failed to start conversation');
    } finally {
      setStartingChat(false);
    }
  };

  if (loading) {
    return (
      <div className="w-full flex items-center justify-center p-24">
        <Loader2 className="w-8 h-8 text-[#C9A45C] animate-spin" />
      </div>
    );
  }

  if (error || !service) {
    return (
      <div className="w-full max-w-xl mx-auto p-16 text-center space-y-4">
        <h2 className="text-xl font-bold text-rose-400">Service Not Found</h2>
        <p className="text-xs text-[#A8A397]">{error || 'The requested service does not exist.'}</p>
        <Link
          href="/services"
          className="inline-flex items-center gap-2 px-4 py-2 bg-white/10 hover:bg-white/20 text-xs font-bold uppercase tracking-wider rounded-xl transition-colors"
        >
          <ArrowLeft className="w-4 h-4" /> Back to Services
        </Link>
      </div>
    );
  }

  const isAgent = service.sellerType === 'agent';
  const isOwner = address && address.toLowerCase() === service.sellerId.toLowerCase();

  return (
    <div className="w-full pb-20 selection:bg-[#C9A45C]/30">
      <ServicesNav />

        <div className="max-w-7xl mx-auto px-4 sm:px-6 pt-6 sm:pt-8 space-y-8">
          {/* Back link */}
          <Link
            href="/services"
            className="inline-flex items-center gap-2 text-xs text-[#A8A397] hover:text-[#C9A45C] transition-colors font-semibold"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Back to All Services</span>
          </Link>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 items-start">
            {/* Left 2 Cols: Details */}
            <div className="lg:col-span-2 space-y-6">
              <div className="p-8 rounded-2xl bg-[#151512] border border-white/5 space-y-6">
                {/* Category & Badge */}
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <span className="text-xs uppercase tracking-widest text-[#A8A397] font-semibold bg-white/5 px-3 py-1 rounded-xl border border-white/5">
                    {service.category}
                  </span>

                  {isAgent ? (
                    <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 rounded-full text-xs font-bold uppercase tracking-wider">
                      <Bot className="w-3.5 h-3.5 text-cyan-400" />
                      <span>AI Agent Service Provider</span>
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 rounded-full text-xs font-bold uppercase tracking-wider">
                      <UserCheck className="w-3.5 h-3.5 text-emerald-400" />
                      <span>Human Expert Provider</span>
                    </span>
                  )}
                </div>

                {/* Title */}
                <h1 className="text-2xl sm:text-3xl font-extrabold text-[#F5F2E8] leading-tight">
                  {service.title}
                </h1>

                {/* Description */}
                <div className="space-y-2 pt-2">
                  <span className="text-[10px] uppercase tracking-widest text-[#A8A397] block font-bold">
                    Service Scope & Overview
                  </span>
                  <p className="text-sm text-[#F5F2E8] leading-relaxed whitespace-pre-line">
                    {service.description}
                  </p>
                </div>

                {/* Sample Deliverables */}
                {service.sampleDeliverables && service.sampleDeliverables.length > 0 && (
                  <div className="space-y-3 pt-4 border-t border-white/5">
                    <span className="text-[10px] uppercase tracking-widest text-[#A8A397] block font-bold">
                      Expected Deliverable Artifacts
                    </span>
                    <div className="space-y-2">
                      {service.sampleDeliverables.map((item, idx) => (
                        <div
                          key={idx}
                          className="flex items-start gap-2.5 p-3 rounded-xl bg-[#0A0A09] border border-white/5 text-xs text-[#F5F2E8]"
                        >
                          <CheckCircle2 className="w-4 h-4 text-[#C9A45C] shrink-0 mt-0.5" />
                          <span>{item}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Escrow Workflow Explanation Banner */}
              <div className="p-6 rounded-2xl bg-gradient-to-r from-[#151512] to-[#0A0A09] border border-[#C9A45C]/20 space-y-3">
                <div className="flex items-center gap-2 text-[#C9A45C] font-bold text-xs uppercase tracking-wider">
                  <Shield className="w-4 h-4" />
                  <span>VEILIO Escrow Security Guarantee</span>
                </div>
                <p className="text-xs text-[#A8A397] leading-relaxed">
                  Your funds are never paid directly to the seller upfront. Instead, funds are safely deposited into the <strong>VeilServiceEscrow smart contract</strong>. The seller submits work for your review, and funds are only released upon your explicit on-chain approval.
                </p>
              </div>
            </div>

            {/* Right Col: Price, Actions, and Seller Profile */}
            <div className="space-y-6">
              {/* Pricing Box */}
              <div className="p-6 rounded-2xl bg-[#151512] border border-[#C9A45C]/30 space-y-6 shadow-xl">
                <div>
                  <span className="text-[10px] uppercase tracking-widest text-[#A8A397] block font-bold">
                    Standard Starting Rate
                  </span>
                  <div className="text-3xl font-black text-[#F5F2E8] mt-1 flex items-baseline gap-2">
                    {service.price}{' '}
                    <span className="text-sm font-bold text-[#C9A45C] font-mono">{service.currency}</span>
                  </div>
                </div>

                <div className="space-y-2 py-3 border-y border-white/5 text-xs text-[#A8A397]">
                  <div className="flex justify-between items-center">
                    <span>Est. Delivery Time:</span>
                    <span className="font-semibold text-[#F5F2E8] flex items-center gap-1.5">
                      <Clock className="w-3.5 h-3.5 text-[#C9A45C]" />
                      {service.deliveryTime}
                    </span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span>Payment Method:</span>
                    <span className="font-semibold text-[#F5F2E8]">On-Chain Escrow (BNB)</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span>Terms Negotiation:</span>
                    <span className="font-semibold text-emerald-400">Supported in Chat</span>
                  </div>
                </div>

                {/* Primary CTA */}
                {isOwner ? (
                  <div className="p-3 bg-white/5 rounded-xl text-center text-xs text-[#A8A397]">
                    You own this service listing. You can manage it under{' '}
                    <Link href="/services/my-services" className="text-[#C9A45C] underline">
                      My Services
                    </Link>
                    .
                  </div>
                ) : (
                  <button
                    onClick={handleStartConversation}
                    disabled={startingChat}
                    className="w-full py-3.5 px-4 bg-[#C9A45C] hover:bg-[#E6CC91] text-[#0A0A09] text-xs font-bold uppercase tracking-wider rounded-xl transition-all flex items-center justify-center gap-2 shadow-lg disabled:opacity-50"
                  >
                    {startingChat ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        <span>Starting Chat...</span>
                      </>
                    ) : (
                      <>
                        <MessageSquare className="w-4 h-4" />
                        <span>Contact & Negotiate Terms</span>
                      </>
                    )}
                  </button>
                )}

                <p className="text-[11px] text-[#A8A397] text-center leading-relaxed">
                  Chat with the seller to discuss custom milestones, deliverables, and agreed price before an order is created.
                </p>
              </div>

              {/* Seller Profile Card */}
              <div className="p-6 rounded-2xl bg-[#151512] border border-white/5 space-y-4">
                <span className="text-[10px] uppercase tracking-widest text-[#A8A397] block font-bold">
                  About The Provider
                </span>

                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-2xl bg-[#0A0A09] border border-white/10 flex items-center justify-center shrink-0">
                    {isAgent ? (
                      <Bot className="w-6 h-6 text-cyan-400" />
                    ) : (
                      <UserCheck className="w-6 h-6 text-emerald-400" />
                    )}
                  </div>
                  <div>
                    <h4 className="text-sm font-bold text-[#F5F2E8]">{service.sellerName}</h4>
                    <p className="text-xs font-mono text-[#A8A397] truncate max-w-[180px]">
                      {service.sellerId}
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3 pt-2 text-xs">
                  <div className="p-3 rounded-xl bg-[#0A0A09] border border-white/5 space-y-1">
                    <span className="text-[10px] text-[#A8A397] block uppercase">On-Chain Registry</span>
                    <span className="font-bold text-[#C9A45C] flex items-center gap-1">
                      <ShieldCheck className="w-3.5 h-3.5 text-[#C9A45C]" />
                      {service.onChainRegistered ? 'Verified' : 'Indexed'}
                    </span>
                  </div>
                  <div className="p-3 rounded-xl bg-[#0A0A09] border border-white/5 space-y-1">
                    <span className="text-[10px] text-[#A8A397] block uppercase">Settled Escrows</span>
                    <span className="font-bold text-[#F5F2E8]">
                      {service.ordersCompleted || 0} Orders
                    </span>
                  </div>
                </div>

                {service.registryTxHash && (
                  <div className="pt-2 border-t border-white/5 flex items-center justify-between text-[11px]">
                    <span className="text-[#A8A397]">Registry Tx</span>
                    <a
                      href={`https://testnet.bscscan.com/tx/${service.registryTxHash}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[#C9A45C] hover:underline font-mono inline-flex items-center gap-1"
                    >
                      <span>{service.registryTxHash.slice(0, 8)}...{service.registryTxHash.slice(-6)}</span>
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
    </div>
  );
}
