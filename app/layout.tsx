import type { Metadata } from 'next';
import './globals.css';
import { Providers } from './providers';
import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';

export const metadata: Metadata = {
  title: 'VEILIO — Multichain Digital Asset Marketplace',
  description: 'A digital asset marketplace with sealed-bid auctions, verifiable EVM and Solana wallet identity, and chain-aware activity.',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="bg-[#0A0A09]">
      <body className="min-h-screen flex flex-col bg-[#0A0A09] text-[#F5F2E8] antialiased">
        <Providers>
          <Navbar />
          <main className="flex-grow">{children}</main>
          <Footer />
        </Providers>
      </body>
    </html>
  );
}
