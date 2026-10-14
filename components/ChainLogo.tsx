import React from 'react';
import Image from 'next/image';

export type ChainNetworkId = 'bnb:97' | 'base:84532' | 'solana:devnet';

export const CHAIN_INFO: Record<ChainNetworkId, { name: string; logo: string }> = {
  'bnb:97': { name: 'BNB Chain', logo: '/logos/chains/bnb-chain.svg' },
  'base:84532': { name: 'Base', logo: '/logos/chains/base.svg' },
  'solana:devnet': { name: 'Solana', logo: '/logos/chains/solana.svg' },
};

/** Legacy records without a network are BNB Testnet. */
export function chainInfo(network?: string | null) {
  return CHAIN_INFO[(network as ChainNetworkId) || 'bnb:97'] ?? CHAIN_INFO['bnb:97'];
}

export default function ChainLogo({ network, size = 14, className = '' }: { network?: string | null; size?: number; className?: string }) {
  const info = chainInfo(network);
  return (
    <Image
      src={info.logo}
      alt={info.name}
      width={size}
      height={size}
      className={`shrink-0 ${className}`}
      style={{ width: size, height: size }}
    />
  );
}
