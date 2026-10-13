'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import ServicesNav from '@/components/services/ServicesNav';
import { useAccount, useSignMessage, useWriteContract, usePublicClient } from 'wagmi';
import {
  Briefcase,
  PlusCircle,
  Eye,
  Power,
  PowerOff,
  Clock,
  Loader2,
  ExternalLink,
  ShieldCheck,
} from 'lucide-react';
import type { ServiceListing } from '@/lib/server/servicesDb';
import { createServiceAuthMessage, generateAuthNonce } from '@/lib/serviceAuth';
import {
  VEIL_SERVICE_REGISTRY_ABI,
  getServiceRegistryAddress,
} from '@/lib/serviceContract';
import { formatServiceRegistryId } from '@/lib/serviceRegistry';

export default function MyServicesPage() {
  const { address, chainId } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const { writeContractAsync } = useWriteContract();
  const publicClient = usePublicClient();

  const [services, setServices] = useState<ServiceListing[]>([]);
  const [loading, setLoading] = useState(true);
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  const fetchMyServices = async () => {
    if (!address) {
      setLoading(false);
      return;
    }
    try {
      setLoading(true);
      const res = await fetch('/api/services?status=all&includeUnverified=true');
      const data = await res.json();
      if (data.success && Array.isArray(data.services)) {
        const mine = data.services.filter(
          (s: ServiceListing) => s.sellerId.toLowerCase() === address.toLowerCase()
        );
        setServices(mine);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchMyServices();
  }, [address]);

  const toggleStatus = async (service: ServiceListing) => {
    if (!address) return;
    const nextStatus = service.status === 'active' ? 'inactive' : 'active';
    const nextActiveBool = nextStatus === 'active';

    try {
      setUpdatingId(service.id);

      // Sign authentication payload
      const authTimestamp = Date.now();
      const authNonce = generateAuthNonce();
      const authMessage = createServiceAuthMessage({
        action: 'update-service',
        orderId: service.id,
        address,
        timestamp: authTimestamp,
        nonce: authNonce,
      });
      const signature = await signMessageAsync({ message: authMessage });

      let onChainTx: `0x${string}` | undefined;
      // If listing was registered on-chain, update on-chain status on the listing's chain
      if (service.onChainRegistered) {
        const listingChainId = service.network === 'base:84532' ? 84532 : 97;
        if (chainId !== listingChainId) {
          throw new Error(`Switch your wallet to ${listingChainId === 84532 ? 'Base Sepolia (84532)' : 'BNB Chain Testnet (97)'} to update this listing.`);
        }
        const serviceIdBytes32 = formatServiceRegistryId(service.id);
        onChainTx = await writeContractAsync({
          address: getServiceRegistryAddress(listingChainId),
          abi: VEIL_SERVICE_REGISTRY_ABI,
          functionName: 'setServiceStatus',
          args: [serviceIdBytes32, nextActiveBool],
        });

        if (publicClient && onChainTx) {
          const receipt = await publicClient.waitForTransactionReceipt({ hash: onChainTx });
          if (receipt.status !== 'success') {
            throw new Error('On-chain status change reverted.');
          }
        }
      }

      const res = await fetch(`/api/services/${service.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sellerAddress: address,
          status: nextStatus,
          txHash: onChainTx,
          auth: {
            address,
            signature,
            timestamp: authTimestamp,
            nonce: authNonce,
          },
        }),
      });

      const data = await res.json();
      if (data.success && data.service) {
        setServices(services.map((s) => (s.id === service.id ? data.service : s)));
      } else {
        alert(data.error || 'Failed to update status');
      }
    } catch (err: any) {
      console.error(err);
      const isRejection = err?.message?.includes('User rejected') || err?.code === 4001;
      alert(isRejection ? 'Request rejected in wallet.' : (err?.shortMessage || err?.message || 'Error updating status'));
    } finally {
      setUpdatingId(null);
    }
  };

  return (
    <div className="w-full pb-20 selection:bg-[#C9A45C]/30">
      <ServicesNav />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 pt-6 sm:pt-8 space-y-8">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <h1 className="text-2xl sm:text-3xl font-extrabold uppercase tracking-tight text-[#F5F2E8]">
              My Advertised Services
            </h1>
            <p className="text-xs text-[#A8A397] mt-1">
              Manage your services, toggle visibility on-chain, and monitor verified reputation.
            </p>
          </div>

          <Link
            href="/services/create"
            className="flex items-center gap-2 px-4 py-2.5 bg-[#C9A45C] hover:bg-[#E6CC91] text-[#0A0A09] text-xs font-bold uppercase tracking-wider rounded-xl transition-all shadow-md"
          >
            <PlusCircle className="w-4 h-4" />
            <span>Advertise New Service</span>
          </Link>
        </div>

        {/* Services List */}
        {loading ? (
          <div className="p-16 flex flex-col items-center justify-center gap-3 text-[#A8A397]">
            <Loader2 className="w-8 h-8 animate-spin text-[#C9A45C]" />
            <span className="text-xs uppercase tracking-wider">Loading your services...</span>
          </div>
        ) : services.length === 0 ? (
          <div className="p-12 rounded-2xl bg-[#151512] border border-white/5 text-center space-y-4 max-w-md mx-auto my-12">
            <Briefcase className="w-10 h-10 text-[#C9A45C] mx-auto opacity-70" />
            <h3 className="text-base font-bold text-[#F5F2E8]">No Service Listings Yet</h3>
            <p className="text-xs text-[#A8A397]">
              You haven&apos;t advertised any services under this wallet address yet.
            </p>
            <Link
              href="/services/create"
              className="inline-flex items-center gap-2 px-4 py-2 bg-[#C9A45C] hover:bg-[#E6CC91] text-[#0A0A09] text-xs font-bold uppercase tracking-wider rounded-xl transition-all shadow-md"
            >
              <PlusCircle className="w-4 h-4" /> Advertise First Service
            </Link>
          </div>
        ) : (
          <div className="space-y-4">
            {services.map((service) => {
              const isActive = service.status === 'active';
              const isBusy = updatingId === service.id;

              return (
                <div
                  key={service.id}
                  className="p-6 rounded-2xl bg-[#151512] border border-white/5 hover:border-[#C9A45C]/20 flex flex-col md:flex-row items-start md:items-center justify-between gap-6 transition-all"
                >
                  <div className="space-y-2 max-w-2xl">
                    <div className="flex flex-wrap items-center gap-2 sm:gap-3">
                      <span className="text-[10px] uppercase tracking-widest text-[#A8A397] font-semibold bg-white/5 px-2.5 py-0.5 rounded-lg border border-white/5">
                        {service.category}
                      </span>

                      {isActive ? (
                        <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-400">
                          <span className="w-2 h-2 rounded-full bg-emerald-400"></span> Active (Public)
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-[11px] font-bold text-[#A8A397]">
                          <span className="w-2 h-2 rounded-full bg-[#A8A397]"></span> Deactivated
                        </span>
                      )}

                      {service.onChainRegistered && (
                        <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase px-2 py-0.5 rounded-full bg-[#C9A45C]/10 text-[#C9A45C] border border-[#C9A45C]/20">
                          <ShieldCheck className="w-3 h-3" />
                          <span>On-Chain Verified</span>
                        </span>
                      )}
                    </div>

                    <h3 className="text-base font-bold text-[#F5F2E8]">{service.title}</h3>
                    <p className="text-xs text-[#A8A397] line-clamp-2">{service.description}</p>

                    <div className="flex flex-wrap items-center gap-4 text-xs text-[#A8A397] pt-1">
                      <span className="font-bold text-[#F5F2E8]">
                        {service.price} <span className="text-[#C9A45C]">{service.currency}</span>
                      </span>
                      <span>•</span>
                      <span className="flex items-center gap-1">
                        <Clock className="w-3.5 h-3.5 text-[#C9A45C]" /> {service.deliveryTime}
                      </span>
                      <span>•</span>
                      <span>{service.ordersCompleted || 0} completed orders</span>
                      {service.registryTxHash && (
                        <>
                          <span>•</span>
                          <a
                            href={`https://testnet.bscscan.com/tx/${service.registryTxHash}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-[#C9A45C] hover:underline font-mono inline-flex items-center gap-1"
                          >
                            <span>Tx: {service.registryTxHash.slice(0, 8)}...</span>
                            <ExternalLink className="w-3 h-3" />
                          </a>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-3 self-end md:self-center shrink-0">
                    <Link
                      href={`/services/${service.id}`}
                      className="px-4 py-2 bg-white/5 hover:bg-white/10 text-xs font-bold uppercase tracking-wider rounded-xl transition-colors flex items-center gap-1.5"
                    >
                      <Eye className="w-3.5 h-3.5" /> View
                    </Link>

                    <button
                      onClick={() => toggleStatus(service)}
                      disabled={isBusy}
                      className={`px-4 py-2 text-xs font-bold uppercase tracking-wider rounded-xl transition-colors flex items-center gap-1.5 ${
                        isActive
                          ? 'bg-rose-500/10 text-rose-400 hover:bg-rose-500/20'
                          : 'bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20'
                      }`}
                    >
                      {isBusy ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : isActive ? (
                        <>
                          <PowerOff className="w-3.5 h-3.5" /> Deactivate
                        </>
                      ) : (
                        <>
                          <Power className="w-3.5 h-3.5" /> Activate
                        </>
                      )}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
