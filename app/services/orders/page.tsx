'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import ServicesNav from '@/components/services/ServicesNav';
import { useAccount, useSignMessage } from 'wagmi';
import {
  ShoppingBag,
  Clock,
  ArrowRight,
  ShieldCheck,
  AlertCircle,
  CheckCircle2,
  Loader2,
  FileText,
} from 'lucide-react';
import type { ServiceOrder } from '@/lib/server/servicesDb';
import { createServiceAuthMessage, generateAuthNonce } from '@/lib/serviceAuth';

export default function MyOrdersPage() {
  const { address, isConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();

  const [tab, setTab] = useState<'buyer' | 'seller'>('buyer');
  const [ordersBuyer, setOrdersBuyer] = useState<ServiceOrder[]>([]);
  const [ordersSeller, setOrdersSeller] = useState<ServiceOrder[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchOrders = async () => {
    if (!address) {
      setLoading(false);
      return;
    }
    try {
      setLoading(true);
      const timestamp = Date.now();
      const nonce = generateAuthNonce();
      const message = createServiceAuthMessage({
        action: 'list-orders',
        orderId: address.toLowerCase(),
        address,
        timestamp,
        nonce,
      });
      const signature = await signMessageAsync({ message });
      const res = await fetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-store',
        body: JSON.stringify({ auth: { address, signature, timestamp, nonce } }),
      });
      const data = await res.json();
      if (data.success) {
        setOrdersBuyer(data.asBuyer || []);
        setOrdersSeller(data.asSeller || []);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchOrders();
  }, [address]);

  const activeList = tab === 'buyer' ? ordersBuyer : ordersSeller;

  const getStatusBadge = (status: ServiceOrder['status']) => {
    switch (status) {
      case 'AwaitingPayment':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold uppercase bg-amber-500/10 text-amber-400 border border-amber-500/20">
            Awaiting Escrow Deposit
          </span>
        );
      case 'Funded':
      case 'InProgress':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold uppercase bg-blue-500/10 text-blue-400 border border-blue-500/20">
            Escrow Funded & In Progress
          </span>
        );
      case 'InReview':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold uppercase bg-purple-500/10 text-purple-400 border border-purple-500/20">
            Deliverables Submitted (In Review)
          </span>
        );
      case 'RevisionRequested':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold uppercase bg-rose-500/10 text-rose-400 border border-rose-500/20">
            Revision Requested
          </span>
        );
      case 'Completed':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold uppercase bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
            <CheckCircle2 className="w-3 h-3" /> Completed & Released
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold uppercase bg-white/10 text-[#A8A397]">
            {status}
          </span>
        );
    }
  };

  return (
    <div className="w-full pb-20 selection:bg-[#C9A45C]/30">
      <ServicesNav />

        <div className="max-w-7xl mx-auto px-4 sm:px-6 pt-6 sm:pt-8 space-y-8">
          <div>
            <h1 className="text-2xl sm:text-3xl font-extrabold uppercase tracking-tight text-[#F5F2E8]">
              Service Orders & Escrow Management
            </h1>
            <p className="text-xs text-[#A8A397] mt-1">
              Track negotiated orders, deposit escrow funds, review work submissions, and approve releases.
            </p>
          </div>

          {/* Toggle Tabs */}
          <div className="flex items-center p-1 bg-[#151512] rounded-2xl border border-white/5 w-fit">
            <button
              onClick={() => setTab('buyer')}
              className={`px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-wider transition-all ${
                tab === 'buyer'
                  ? 'bg-[#C9A45C] text-[#0A0A09]'
                  : 'text-[#A8A397] hover:text-[#F5F2E8]'
              }`}
            >
              Purchased Services ({ordersBuyer.length})
            </button>
            <button
              onClick={() => setTab('seller')}
              className={`px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-wider transition-all ${
                tab === 'seller'
                  ? 'bg-[#C9A45C] text-[#0A0A09]'
                  : 'text-[#A8A397] hover:text-[#F5F2E8]'
              }`}
            >
              Services Received as Provider ({ordersSeller.length})
            </button>
          </div>

          {!isConnected ? (
            <div className="p-12 rounded-2xl bg-[#151512] border border-white/5 text-center space-y-4 max-w-md mx-auto my-12">
              <ShoppingBag className="w-10 h-10 text-[#C9A45C] mx-auto opacity-70" />
              <h3 className="text-base font-bold text-[#F5F2E8]">Connect Wallet</h3>
              <p className="text-xs text-[#A8A397]">
                Connect your Web3 wallet to access your active service orders.
              </p>
            </div>
          ) : loading ? (
            <div className="p-12 flex justify-center">
              <Loader2 className="w-8 h-8 text-[#C9A45C] animate-spin" />
            </div>
          ) : activeList.length === 0 ? (
            <div className="p-12 rounded-2xl bg-[#151512] border border-white/5 text-center space-y-4 max-w-md mx-auto my-12">
              <ShoppingBag className="w-10 h-10 text-[#C9A45C] mx-auto opacity-70" />
              <h3 className="text-base font-bold text-[#F5F2E8]">
                No {tab === 'buyer' ? 'Purchased' : 'Provider'} Orders Found
              </h3>
              <p className="text-xs text-[#A8A397]">
                {tab === 'buyer'
                  ? 'Explore the marketplace, negotiate with sellers in chat, and accept a payment request to create your first order.'
                  : 'Once buyers accept your payment requests, your orders will appear here for tracking and deliverable submission.'}
              </p>
              {tab === 'buyer' && (
                <Link
                  href="/services"
                  className="inline-flex items-center gap-2 px-4 py-2 bg-[#C9A45C] hover:bg-[#E6CC91] text-[#0A0A09] text-xs font-bold uppercase tracking-wider rounded-xl transition-all shadow-md"
                >
                  Explore Marketplace
                </Link>
              )}
            </div>
          ) : (
            <div className="space-y-4">
              {activeList.map((order) => {
                const partnerAddress = tab === 'buyer' ? order.sellerId : order.buyerId;

                return (
                  <div
                    key={order.id}
                    className="p-6 rounded-2xl bg-[#151512] border border-white/5 hover:border-[#C9A45C]/20 flex flex-col md:flex-row items-start md:items-center justify-between gap-6 transition-all"
                  >
                    <div className="space-y-2 max-w-2xl">
                      <div className="flex flex-wrap items-center gap-3">
                        <span className="text-xs font-mono font-bold text-[#C9A45C]">
                          #{order.id}
                        </span>
                        {getStatusBadge(order.status)}
                      </div>

                      <h3 className="text-base font-bold text-[#F5F2E8]">{order.serviceTitle}</h3>
                      <p className="text-xs text-[#A8A397] line-clamp-2">{order.scopeSnapshot}</p>

                      <div className="flex flex-wrap items-center gap-4 text-xs text-[#A8A397] pt-1">
                        <span className="font-bold text-[#F5F2E8]">
                          {order.priceSnapshot} <span className="text-[#C9A45C] font-mono">{order.currency}</span>
                        </span>
                        <span>•</span>
                        <span className="font-mono">
                          {tab === 'buyer' ? 'Seller' : 'Buyer'}: {partnerAddress.slice(0, 6)}...{partnerAddress.slice(-4)}
                        </span>
                        <span>•</span>
                        <span className="flex items-center gap-1">
                          <Clock className="w-3.5 h-3.5 text-[#C9A45C]" />
                          Deadline: {new Date(order.deadline).toLocaleDateString()}
                        </span>
                      </div>
                    </div>

                    <Link
                      href={`/services/orders/${order.id}`}
                      className="px-5 py-2.5 bg-white/5 hover:bg-[#C9A45C] text-[#F5F2E8] hover:text-[#0A0A09] text-xs font-bold uppercase tracking-wider rounded-xl transition-all border border-white/10 hover:border-[#C9A45C] flex items-center gap-2 shrink-0 self-end md:self-center"
                    >
                      <span>Manage Order</span>
                      <ArrowRight className="w-3.5 h-3.5" />
                    </Link>
                  </div>
                );
              })}
            </div>
          )}
        </div>
    </div>
  );
}
