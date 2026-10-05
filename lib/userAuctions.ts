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

interface AuctionMetadata {
  name?: string;
  description?: string;
  image?: string;
  asset?: { assetType?: string };
}

export interface UserAuctionItem {
  id: string;
  itemName: string;
  description: string;
  imageURI: string;
  startingPrice: string;
  bidderCount: number;
  commitEndTime: number;
  revealEndTime: number;
  status: 'Bidding' | 'Revealing' | 'Settled';
  seller: string;
  assetType?: string;
}

export async function fetchUserAuctions(
  publicClient: NonNullable<ReturnType<typeof usePublicClient>>,
  userAddress: `0x${string}`
): Promise<UserAuctionItem[]> {
  // The public BNB RPC limits historical eth_getLogs ranges. Read the auction
  // index in small batches instead of requesting every AuctionCreated log from
  // genesis. This also avoids making user history depend on RPC log retention.
  const count = await publicClient.readContract({
    address: VEIL_V3_CONTRACT_ADDRESS,
    abi: VEIL_V3_ABI,
    functionName: 'auctionCount',
  });
  const auctionIds = new Set<string>();
  const batchSize = 25;
  for (let start = Number(count); start >= 1; start -= batchSize) {
    const end = Math.max(1, start - batchSize + 1);
    const ids = Array.from({ length: start - end + 1 }, (_, index) => start - index);
    const auctionsInBatch = await Promise.all(ids.map((id) => publicClient.readContract({
      address: VEIL_V3_CONTRACT_ADDRESS,
      abi: VEIL_V3_ABI,
      functionName: 'auctions',
      args: [BigInt(id)],
    }) as Promise<unknown>));

    auctionsInBatch.forEach((raw, index) => {
      const auction = raw as unknown as AuctionData;
      if (auction[0] !== 0n && auction[1].toLowerCase() === userAddress.toLowerCase()) {
        auctionIds.add(ids[index].toString());
      }
    });
  }

  if (auctionIds.size === 0) {
    return [];
  }

  const auctions: UserAuctionItem[] = [];

  for (const idStr of auctionIds) {
    try {
      const raw = await publicClient.readContract({
        address: VEIL_V3_CONTRACT_ADDRESS,
        abi: VEIL_V3_ABI,
        functionName: 'auctions',
        args: [BigInt(idStr)],
      }) as unknown as AuctionData;

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
      ] = raw;

      if (Number(id) === 0) continue;

      let finalItemName = itemName;
      let finalDescription = description;
      let finalImageURI = imageURI;
      let assetType = 'dataset';

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
                if (metadata.description) finalDescription = metadata.description;
                if (metadata.image) finalImageURI = metadata.image;
                if (metadata.asset?.assetType) assetType = metadata.asset.assetType;
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

      auctions.push({
        id: String(id),
        itemName: finalItemName,
        description: finalDescription,
        imageURI: finalImageURI,
        startingPrice: formatEther(startingPrice),
        bidderCount: Number(bidderCount),
        commitEndTime: commitEndMs,
        revealEndTime: revealEndMs,
        status,
        seller,
        assetType,
      });
    } catch (error) {
      console.error(`Failed to load auction ${idStr}:`, error);
    }
  }

  // Sort descending by ID to show newest first
  return auctions.sort((a, b) => Number(b.id) - Number(a.id));
}
