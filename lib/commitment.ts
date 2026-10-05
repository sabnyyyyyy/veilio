import { keccak256, encodePacked, parseEther } from 'viem';

/**
 * Computes the keccak256 commitment hash matching Solidity contract:
 * keccak256(abi.encodePacked(auctionId, msg.sender, maxBid, secret))
 */
export function computeCommitmentHash(
  auctionId: bigint | number,
  bidderAddress: `0x${string}`,
  maxBidEth: string | number,
  secretHex: `0x${string}`
): `0x${string}` {
  const maxBidWei = parseEther(String(maxBidEth));
  return keccak256(
    encodePacked(
      ['uint256', 'address', 'uint256', 'bytes32'],
      [BigInt(auctionId), bidderAddress, maxBidWei, secretHex]
    )
  );
}

/**
 * Generates a cryptographically random 32-byte secret salt.
 */
export function generateRandomSecret(): `0x${string}` {
  const bytes = new Uint8Array(32);
  if (typeof window !== 'undefined' && window.crypto) {
    window.crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 32; i++) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  return `0x${Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('')}` as `0x${string}`;
}
