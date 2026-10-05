import type { usePublicClient } from 'wagmi';
import { formatEther } from 'viem';
import { VEIL_V3_ABI, VEIL_V3_CONTRACT_ADDRESS } from './contract';
import { resolveIpfsUri } from './ipfs';

type AuctionData = readonly [
  bigint,   // id
  string,   // seller
  string,   // itemName
  string,   // description
  string,   // imageURI
  bigint,   // startingPrice
  bigint,   // commitEndTime
  bigint,   // revealEndTime
  bigint,   // inspectionDuration
  bigint,   // inspectionEndTime
  number,   // state
  string,   // highestBidder
  bigint,   // highestBid
  bigint,   // bidderCount
  bigint,   // revealedCount
  string,   // finalTxHash
  string,   // evidenceHash
  string    // reviewReason
];

type CommitmentData = readonly [
  `0x${string}`, // commitment (bytes32)
  bigint,        // deposit (uint256)
  boolean,       // revealed (bool)
  bigint         // maxBid (uint256)
];

interface AuctionMetadata {
  name?: string;
  description?: string;
  image?: string;
}

export interface UserBidItem {
  auctionId: string;
  itemName: string;
  imageURI: string;
  commitEndTime: number;
  revealEndTime: number;
  auctionStatus: 'Bidding' | 'Revealing' | 'Settled';
  /** Raw VeilV4 auction enum: 0 Created, 1 Bidding, 2 Revealing, 3 Inspection, 4 RefundRequested, 5 UnderReview, 6 Completed, 7 Refunded, 8 Cancelled. */
  state: number;
  deposit: string;
  revealed: boolean;
  onchainMaxBid: string; // Only valid if revealed
  winner: string;
  winningPrice: string; // Only valid if settled
  isWinner: boolean;
}

export async function fetchUserBids(
  publicClient: NonNullable<ReturnType<typeof usePublicClient>>,
  userAddress: `0x${string}`
): Promise<UserBidItem[]> {
  // Avoid an unbounded eth_getLogs scan: public BNB RPC endpoints reject
  // requests spanning the entire chain. Inspect commitments in bounded batches.
  const count = await publicClient.readContract({
    address: VEIL_V3_CONTRACT_ADDRESS,
    abi: VEIL_V3_ABI,
    functionName: 'auctionCount',
  });
  const userCommitments = new Map<string, { auctionRaw: AuctionData; commitmentRaw: CommitmentData }>();
  const batchSize = 20;
  for (let start = Number(count); start >= 1; start -= batchSize) {
    const end = Math.max(1, start - batchSize + 1);
    const ids = Array.from({ length: start - end + 1 }, (_, index) => start - index);
    const results = await Promise.all(ids.map(async (id) => {
      const [auctionRaw, commitmentRaw] = await Promise.all([
        publicClient.readContract({
          address: VEIL_V3_CONTRACT_ADDRESS,
          abi: VEIL_V3_ABI,
          functionName: 'auctions',
          args: [BigInt(id)],
        }),
        publicClient.readContract({
          address: VEIL_V3_CONTRACT_ADDRESS,
          abi: VEIL_V3_ABI,
          functionName: 'commitments',
          args: [BigInt(id), userAddress],
        }),
      ]);
      return { id, auctionRaw: auctionRaw as unknown as AuctionData, commitmentRaw: commitmentRaw as unknown as CommitmentData };
    }));

    for (const { id, auctionRaw, commitmentRaw } of results) {
      if (auctionRaw[0] !== 0n && commitmentRaw[1] > 0n) {
        userCommitments.set(id.toString(), { auctionRaw, commitmentRaw });
      }
    }
  }

  const auctionIds = [...userCommitments.keys()];

  if (auctionIds.length === 0) {
    return [];
  }

  const bids: UserBidItem[] = [];

  for (const idStr of auctionIds) {
    try {
      const { auctionRaw, commitmentRaw } = userCommitments.get(idStr)!;

      const [
        id,
        seller,
        itemName,
        description,
        imageURI,
        startingPrice,
        commitEndTime,
        revealEndTime,
        inspectionDuration,
        inspectionEndTime,
        state,
        highestBidder,
        highestBid,
        bidderCount,
        revealedCount,
        finalTxHash,
        evidenceHash,
        reviewReason
      ] = auctionRaw as unknown as AuctionData;

      const [
        commitmentHash,
        deposit,
        revealed,
        maxBid
      ] = commitmentRaw as unknown as CommitmentData;

      // Skip if somehow the commitment has no deposit (should not happen if event was emitted)
      if (deposit === BigInt(0)) continue;

      let finalItemName = itemName;
      let finalImageURI = imageURI;

      if (
        imageURI.startsWith('ipfs://') ||
        imageURI.startsWith('/ipfs/') ||
        imageURI.startsWith('/uploads/') ||
        imageURI.startsWith('http://') ||
        imageURI.startsWith('https://')
      ) {
        try {
          const metadataUrl = resolveIpfsUri(imageURI) || imageURI;
          const response = await fetch(metadataUrl);
          if (response.ok) {
            const ct = response.headers.get('content-type') || '';
            if (ct.includes('json') || ct.includes('text') || imageURI.endsWith('.json')) {
              try {
                const metadata = (await response.json()) as AuctionMetadata;
                if (metadata.name) finalItemName = metadata.name;
                if (metadata.image) finalImageURI = metadata.image;
              } catch {}
            }
          }
        } catch {}
      }

      const commitEndMs = Number(commitEndTime) * 1000;
      const revealEndMs = Number(revealEndTime) * 1000;
      const now = Date.now();
      let status: 'Bidding' | 'Revealing' | 'Settled';

      if (state >= 3) {
        status = 'Settled';
      } else if (now < commitEndMs) {
        status = 'Bidding';
      } else {
        status = 'Revealing';
      }

      const winningPrice = highestBid;

      bids.push({
        auctionId: String(id),
        itemName: finalItemName,
        imageURI: finalImageURI,
        commitEndTime: commitEndMs,
        revealEndTime: revealEndMs,
        auctionStatus: status,
        state,
        deposit: formatEther(deposit),
        revealed,
        onchainMaxBid: revealed ? formatEther(maxBid) : '0',
        winner: highestBidder,
        winningPrice: formatEther(winningPrice),
        isWinner: highestBidder.toLowerCase() === userAddress.toLowerCase(),
      });
    } catch (error) {
      console.error(`Failed to load bid for auction ${idStr}:`, error);
    }
  }

  // Sort descending by ID
  return bids.sort((a, b) => Number(b.auctionId) - Number(a.auctionId));
}

export async function fetchUserRefund(
  publicClient: NonNullable<ReturnType<typeof usePublicClient>>,
  userAddress: `0x${string}`
): Promise<string> {
  try {
    const refund = await publicClient.readContract({
      address: VEIL_V3_CONTRACT_ADDRESS,
      abi: VEIL_V3_ABI,
      functionName: 'pendingRefunds',
      args: [userAddress],
    });
    return formatEther(refund as bigint);
  } catch (err) {
    console.error('Failed to fetch refund:', err);
    return '0';
  }
}
