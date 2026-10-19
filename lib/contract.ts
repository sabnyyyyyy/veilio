import BlindBidAbi from './abi/BlindBid.json';
import VeilV2Artifact from './abi/VeilV2.json';
import VeilV3Artifact from './abi/VeilV3.json';
import VeilNFTV4Artifact from './abi/VeilNFTV4.json';
import { baseSepoliaChain } from './chain';

// Legacy V1 Contract
export const BLINDBID_CONTRACT_ADDRESS = (
  process.env.NEXT_PUBLIC_CONTRACT_ADDRESS ||
  '0xE07bBaaF8524E9114C02cbbCb5F11041F3D4Be77'
) as `0x${string}`;

export const BLINDBID_ABI = BlindBidAbi;

// Legacy V2 Contract
export const VEIL_V2_CONTRACT_ADDRESS = (
  process.env.NEXT_PUBLIC_V2_CONTRACT_ADDRESS ||
  '0x2df959a785E489AF457410F7C81a6BDDc1E8D41B'
) as `0x${string}`;

export const VEIL_V2_ABI = VeilV2Artifact.abi;

// Active V3 Contract
if (!process.env.NEXT_PUBLIC_V3_CONTRACT_ADDRESS) {
  console.warn("NEXT_PUBLIC_V3_CONTRACT_ADDRESS is not configured");
}

const PATCHED_BNB_V4_ADDRESS = '0x9e2d9Dcc76192b54eBF0106da09787428eAF3EE7' as const;
const AFFECTED_BNB_V4_ADDRESS = '0xc12ecd53b9dae1753409b87f10bf00684bf7d8b1';
const configuredV4Address = process.env.NEXT_PUBLIC_V4_CONTRACT_ADDRESS;
// The old BNB V4 is immutable and has a zero-commitment accounting bug. Never
// let a stale hosting environment variable silently route BNB auctions back to it.
export const VEIL_V4_CONTRACT_ADDRESS = (
  configuredV4Address?.toLowerCase() === AFFECTED_BNB_V4_ADDRESS
    ? PATCHED_BNB_V4_ADDRESS
    : configuredV4Address
) as `0x${string}` | undefined;
export const VEIL_V3_CONTRACT_ADDRESS = (
  VEIL_V4_CONTRACT_ADDRESS || process.env.NEXT_PUBLIC_V3_CONTRACT_ADDRESS ||
  PATCHED_BNB_V4_ADDRESS
) as `0x${string}`;

export const VEIL_V3_ABI = (VEIL_V4_CONTRACT_ADDRESS || VEIL_V3_CONTRACT_ADDRESS.toLowerCase() === AFFECTED_BNB_V4_ADDRESS || VEIL_V3_CONTRACT_ADDRESS.toLowerCase() === PATCHED_BNB_V4_ADDRESS.toLowerCase())
  ? VeilNFTV4Artifact.abi
  : VeilV3Artifact.abi;

export const BASE_SEPOLIA_AUCTION_ADDRESS = (
  process.env.NEXT_PUBLIC_BASE_SEPOLIA_AUCTION_ADDRESS || '0xc12EcD53B9dAE1753409B87f10Bf00684BF7d8B1'
) as `0x${string}`;

export function getAuctionContractConfig(chainId: number) {
  if (chainId === baseSepoliaChain.id) {
    if (!BASE_SEPOLIA_AUCTION_ADDRESS) {
      throw new Error('Base Sepolia auction address is not configured.');
    }
    return { address: BASE_SEPOLIA_AUCTION_ADDRESS, abi: VeilNFTV4Artifact.abi } as const;
  }
  if (chainId === 97) {
    if (!VEIL_V3_CONTRACT_ADDRESS) {
      throw new Error('BNB Chain Testnet auction address is not configured.');
    }
    return { address: VEIL_V3_CONTRACT_ADDRESS, abi: VEIL_V3_ABI } as const;
  }
  throw new Error(`VEILIO auctions are not configured for chain ${chainId}.`);
}
