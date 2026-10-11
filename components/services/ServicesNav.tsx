'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAccount } from 'wagmi';
import { Compass, MessageSquare, Briefcase, ShoppingBag, PlusCircle } from 'lucide-react';

export default function ServicesNav() {
  const pathname = usePathname();
  const { isConnected } = useAccount();

  const isTabActive = (path: string) => {
    if (path === '/services' && pathname === '/services') return true;
    if (path !== '/services' && pathname.startsWith(path)) return true;
    return false;
  };

  return (
    <div className="w-full border-b border-white/[0.08] bg-[#0C0C0A] sticky top-[72px] z-40 backdrop-blur-md">
      <div className="max-w-7xl mx-auto px-6 flex flex-wrap items-center justify-between gap-4 py-2.5">
        {/* Navigation Tabs */}
        <div className="flex items-center gap-1.5 sm:gap-2 overflow-x-auto py-0.5 no-scrollbar">
          <Link
            href="/services"
            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium uppercase tracking-wider transition-all ${
              isTabActive('/services')
                ? 'bg-white/[0.08] text-[#F5F2E8] border border-white/[0.14] shadow-sm font-semibold'
                : 'text-[#8E8A80] hover:text-[#D4D0C5] hover:bg-white/[0.03] border border-transparent'
            }`}
          >
            <Compass className="w-3.5 h-3.5 text-[#C9A45C]" />
            <span>Explore Services</span>
          </Link>

          <Link
            href="/services/messages"
            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium uppercase tracking-wider transition-all ${
              isTabActive('/services/messages')
                ? 'bg-white/[0.08] text-[#F5F2E8] border border-white/[0.14] shadow-sm font-semibold'
                : 'text-[#8E8A80] hover:text-[#D4D0C5] hover:bg-white/[0.03] border border-transparent'
            }`}
          >
            <MessageSquare className="w-3.5 h-3.5" />
            <span>Messages</span>
          </Link>

          <Link
            href="/services/orders"
            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium uppercase tracking-wider transition-all ${
              isTabActive('/services/orders')
                ? 'bg-white/[0.08] text-[#F5F2E8] border border-white/[0.14] shadow-sm font-semibold'
                : 'text-[#8E8A80] hover:text-[#D4D0C5] hover:bg-white/[0.03] border border-transparent'
            }`}
          >
            <ShoppingBag className="w-3.5 h-3.5" />
            <span>My Orders</span>
          </Link>

          <Link
            href="/services/my-services"
            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium uppercase tracking-wider transition-all ${
              isTabActive('/services/my-services')
                ? 'bg-white/[0.08] text-[#F5F2E8] border border-white/[0.14] shadow-sm font-semibold'
                : 'text-[#8E8A80] hover:text-[#D4D0C5] hover:bg-white/[0.03] border border-transparent'
            }`}
          >
            <Briefcase className="w-3.5 h-3.5" />
            <span>My Services</span>
          </Link>
        </div>

        {/* Action Button */}
        <Link
          href="/services/create"
          className="flex items-center gap-1.5 px-3.5 py-1.5 bg-[#C9A45C] hover:bg-[#D4AF65] text-[#0A0A09] text-xs font-bold uppercase tracking-wider rounded-lg transition-all shadow-sm shrink-0"
        >
          <PlusCircle className="w-3.5 h-3.5" />
          <span>Advertise Service</span>
        </Link>
      </div>
    </div>
  );
}
