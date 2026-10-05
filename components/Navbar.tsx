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
    <header className="sticky top-0 z-50 w-full border-b border-white/5 bg-[#0A0A09]/80 backdrop-blur-xl transition-all duration-300">
      <div className="max-w-7xl mx-auto px-6 h-[76px] flex items-center justify-between">
        {/* Brand */}
        <Link href={walletConnected ? '/dashboard' : '/'} className="flex items-center gap-3 sm:gap-3.5 group">
          <Image 
            src="/veilio-logo.png" 
            alt="VEILIO Logo" 
            width={40} 
            height={40} 
            className="w-[28px] h-[28px] sm:w-[38px] sm:h-[38px] rounded-sm object-cover" 
          />
          <span className="text-[20px] sm:text-[26px] font-bold tracking-tight text-[#F5F2E8] group-hover:text-white transition-colors uppercase">
            VEILIO
          </span>
        </Link>

        {/* Navigation Links - Hidden on landing page */}
        {pathname !== '/' && (
          <nav className="hidden md:flex items-center gap-10 text-[11px] uppercase tracking-widest font-semibold">
            {walletConnected && (
              <Link
                href="/dashboard"
                className={`transition-colors ${
                  isActive('/dashboard') ? 'text-[#C9A45C]' : 'text-[#A8A397] hover:text-[#F5F2E8]'
                }`}
              >
                Dashboard
              </Link>
            )}

            {walletConnected && (
              <Link href="/seller-analytics" className={`transition-colors ${isActive('/seller-analytics') ? 'text-[#C9A45C]' : 'text-[#A8A397] hover:text-[#F5F2E8]'}`}>
                Seller Analytics
              </Link>
            )}

            <Link
              href="/auctions"
              className={`transition-colors ${
                isActive('/auctions') ? 'text-[#C9A45C]' : 'text-[#A8A397] hover:text-[#F5F2E8]'
              }`}
            >
              Auctions
            </Link>

            <Link
              href="/how-it-works"
              className={`transition-colors ${
                isActive('/how-it-works') ? 'text-[#C9A45C]' : 'text-[#A8A397] hover:text-[#F5F2E8]'
              }`}
            >
              How It Works
            </Link>

            <Link
              href="/verify"
              className={`transition-colors ${
                isActive('/verify') ? 'text-[#C9A45C]' : 'text-[#A8A397] hover:text-[#F5F2E8]'
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
