import type { Metadata } from 'next';
import './globals.css';
import { Providers } from './providers';
import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';

export const metadata: Metadata = {
  title: 'VEILIO — Sealed-Bid Digital Auctions',
  description: 'Bid without being influenced. Premium digital auction marketplace powered by cryptographic commitments on BNB Chain Testnet.',
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
