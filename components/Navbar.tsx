'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import { Menu, X } from 'lucide-react';
import WalletButton from './WalletButton';

type NavSection = 'auctions' | 'services';

const SECTION_STORAGE_KEY = 'veilio:nav-section';
const AUCTION_ROUTES = ['/auctions', '/my-auctions', '/my-bids', '/create'];
const SERVICE_ROUTES = ['/services'];
// Shared workspace pages keep the menu of whichever section the user came from.
const WORKSPACE_ROUTES = ['/dashboard', '/seller-analytics', '/identity'];

const matchesRoute = (pathname: string, routes: string[]) =>
  routes.some((route) => pathname === route || pathname.startsWith(`${route}/`));

function readStoredSection(): NavSection {
  try {
    return window.sessionStorage.getItem(SECTION_STORAGE_KEY) === 'services' ? 'services' : 'auctions';
  } catch {
    return 'auctions';
  }
}

export default function Navbar() {
  const pathname = usePathname();
  const [mounted, setMounted] = useState(false);
  const [isScrolled, setIsScrolled] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  useEffect(() => {
    setMounted(true);
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 20);
    };
    handleScroll();
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const isActive = (path: string) => {
    if (path === '/' && pathname === '/') return true;
    if (path !== '/' && pathname.startsWith(path)) return true;
    return false;
  };

  const routeSection: NavSection | null = matchesRoute(pathname, AUCTION_ROUTES)
    ? 'auctions'
    : matchesRoute(pathname, SERVICE_ROUTES)
      ? 'services'
      : null;
  const isWorkspaceRoute = matchesRoute(pathname, WORKSPACE_ROUTES);
  const [storedSection, setStoredSection] = useState<NavSection>('auctions');

  useEffect(() => {
    if (routeSection) {
      try {
        window.sessionStorage.setItem(SECTION_STORAGE_KEY, routeSection);
      } catch {
        // Storage unavailable (private mode): fall back to the default section.
      }
      setStoredSection(routeSection);
    } else {
      setStoredSection(readStoredSection());
    }
  }, [routeSection]);

  const section: NavSection | null = routeSection ?? (isWorkspaceRoute ? (mounted ? storedSection : 'auctions') : null);

  // Landing & other public pages: marketplace menu. Inside a section: workspace menu for that section.
  const navLinks = section
    ? [
        { label: 'Dashboard', href: '/dashboard' },
        section === 'services' ? { label: 'Services', href: '/services' } : { label: 'Auctions', href: '/auctions' },
        { label: 'Analytics', href: '/seller-analytics' },
        { label: 'Identity', href: '/identity' },
      ]
    : [
        { label: 'Auctions', href: '/auctions' },
        { label: 'Services', href: '/services' },
        { label: 'Developers', href: '/developers' },
      ];

  return (
    <header className="fixed top-3 left-0 right-0 z-50 transition-all duration-500 px-4 sm:px-6 lg:px-8">
      <nav
        className={`relative mx-auto w-full max-w-[1440px] transition-all duration-500
          before:absolute before:inset-x-0 before:top-0 before:z-10 before:h-px before:bg-white/10
          after:absolute after:inset-x-0 after:bottom-0 after:z-10 after:h-px after:bg-white/10
          ${
            isScrolled
              ? 'bg-[#000000]/85 backdrop-blur-xl shadow-[0_8px_32px_rgba(0,0,0,0.85)]'
              : 'bg-transparent backdrop-blur-[2px]'
          }`}
      >
        <div className="flex h-12 items-center justify-between px-6 sm:px-8 transition-all duration-500">
          {/* Brand Logo */}
          <Link
            href="/"
            className="flex items-center gap-3 group transition-transform hover:opacity-90"
            aria-label="VEILIO home"
          >
            <Image
              src="/veilio-logo.png"
              alt="VEILIO"
              width={26}
              height={26}
              className="w-6 h-6 rounded-xs object-cover"
              priority
            />
            <span className="text-base font-black tracking-tight text-white group-hover:text-[#E2C17C] transition-colors uppercase">
              VEILIO
            </span>
          </Link>

          {/* Center Navigation Links (route-aware) */}
          <div className="hidden md:flex items-center gap-10 lg:gap-14">
            {navLinks.map((link) => {
              const active = isActive(link.href);
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className={`text-xs uppercase tracking-[0.16em] font-medium transition-colors duration-300 relative group py-1 ${
                    active ? 'text-[#E2C17C]' : 'text-white/70 hover:text-white'
                  }`}
                >
                  {link.label}
                  <span
                    className={`absolute -bottom-0.5 left-0 h-px transition-all duration-300 bg-[#E2C17C] ${
                      active ? 'w-full' : 'w-0 group-hover:w-full'
                    }`}
                  />
                </Link>
              );
            })}
          </div>

          {/* Right Action Button - Wallet */}
          <div className="hidden md:flex items-center">
            <WalletButton />
          </div>

          {/* Mobile Menu Toggle Button */}
          <button
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="md:hidden p-1.5 text-white/80 hover:text-white transition-colors"
            aria-label="Toggle menu"
          >
            {mobileMenuOpen ? <X size={20} /> : <Menu size={20} />}
          </button>
        </div>
      </nav>

      {/* Mobile Drawer Menu */}
      {mobileMenuOpen && (
        <div className="md:hidden fixed inset-0 top-16 z-40 bg-black/95 backdrop-blur-2xl p-6 flex flex-col justify-between">
          <div className="flex flex-col gap-6 pt-6">
            {navLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                onClick={() => setMobileMenuOpen(false)}
                className="text-2xl font-bold uppercase tracking-wider text-white hover:text-[#E2C17C] transition-colors"
              >
                {link.label}
              </Link>
            ))}
          </div>

          <div className="pt-8 border-t border-white/10 flex flex-col gap-4">
            <WalletButton />
          </div>
        </div>
      )}
    </header>
  );
}
