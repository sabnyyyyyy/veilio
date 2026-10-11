'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import { useAccount } from 'wagmi';
import WalletButton from './WalletButton';

export default function Navbar() {
  const pathname = usePathname();
  const { isConnected } = useAccount();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const walletConnected = mounted && isConnected;

  const isActive = (path: string) => {
    if (path === '/' && pathname === '/') return true;
    if (path !== '/' && pathname.startsWith(path)) return true;
    return false;
  };

  return (
    <header className="sticky top-0 z-50 w-full border-b border-white/[0.08] bg-[#0A0A09]/90 backdrop-blur-xl transition-all duration-300">
      <div className="max-w-7xl mx-auto px-6 h-[72px] flex items-center justify-between">
        {/* Brand */}
        <Link href={walletConnected ? '/dashboard' : '/'} className="flex items-center gap-3 group">
          <Image
            src="/veilio-logo.png"
            alt="VEILIO Logo"
            width={36}
            height={36}
            className="w-[32px] h-[32px] sm:w-[36px] sm:h-[36px] rounded-sm object-cover"
          />

          <span className="text-[20px] sm:text-[22px] font-black tracking-tight text-[#F5F2E8] group-hover:text-white transition-colors uppercase">
            VEILIO
          </span>
        </Link>

        {/* Navigation Links - Hidden on landing page */}
        {pathname !== '/' && (
          <nav className="hidden md:flex items-center gap-6 lg:gap-8 text-[11px] sm:text-[12px] uppercase tracking-wider font-semibold">
            {walletConnected && (
              <Link
                href="/dashboard"
                className={`transition-colors py-1 ${
                  isActive('/dashboard') ? 'text-[#C9A45C]' : 'text-[#9E9A8E] hover:text-[#F5F2E8]'
                }`}
              >
                Dashboard
              </Link>
            )}

            {walletConnected && (
              <Link
                href="/seller-analytics"
                className={`transition-colors py-1 ${
                  isActive('/seller-analytics') ? 'text-[#C9A45C]' : 'text-[#9E9A8E] hover:text-[#F5F2E8]'
                }`}
              >
                Seller Analytics
              </Link>
            )}

            <Link
              href="/auctions"
              className={`transition-colors py-1 ${
                isActive('/auctions') ? 'text-[#C9A45C]' : 'text-[#9E9A8E] hover:text-[#F5F2E8]'
              }`}
            >
              Auctions
            </Link>

            <Link
              href="/services"
              className={`transition-colors py-1 ${
                isActive('/services') ? 'text-[#C9A45C]' : 'text-[#9E9A8E] hover:text-[#F5F2E8]'
              }`}
            >
              Services
            </Link>

            <Link
              href="/how-it-works"
              className={`transition-colors py-1 ${
                isActive('/how-it-works') ? 'text-[#C9A45C]' : 'text-[#9E9A8E] hover:text-[#F5F2E8]'
              }`}
            >
              How It Works
            </Link>

            <Link
              href="/verify"
              className={`transition-colors py-1 ${
                isActive('/verify') ? 'text-[#C9A45C]' : 'text-[#9E9A8E] hover:text-[#F5F2E8]'
              }`}
            >
              Verify
            </Link>
          </nav>
        )}

        {/* Right Action */}
        <div className="flex items-center">
          <WalletButton />
        </div>
      </div>
    </header>
  );
}
