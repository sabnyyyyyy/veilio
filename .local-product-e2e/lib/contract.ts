import BlindBidAbi from './abi/BlindBid.json';
import VeilV2Artifact from './abi/VeilV2.json';
import VeilV3Artifact from './abi/VeilV3.json';
import VeilNFTV4Artifact from './abi/VeilNFTV4.json';

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

export const VEIL_V4_CONTRACT_ADDRESS = process.env.NEXT_PUBLIC_V4_CONTRACT_ADDRESS as `0x${string}` | undefined;
export const VEIL_V3_CONTRACT_ADDRESS = (
  VEIL_V4_CONTRACT_ADDRESS || process.env.NEXT_PUBLIC_V3_CONTRACT_ADDRESS ||
  '0x0D1c307B4D59143703aE38fB6479d9Dac1fec987'
) as `0x${string}`;

export const VEIL_V3_ABI = VEIL_V4_CONTRACT_ADDRESS ? VeilNFTV4Artifact.abi : VeilV3Artifact.abi;
