import type { usePublicClient } from 'wagmi';
import { formatEther } from 'viem';
import type { AuctionItem } from './mockAuctions';
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

export async function fetchOnchainAuctions(
  publicClient: NonNullable<ReturnType<typeof usePublicClient>>
): Promise<AuctionItem[]> {
  const count = await publicClient.readContract({
    address: VEIL_V3_CONTRACT_ADDRESS,
    abi: VEIL_V3_ABI,
    functionName: 'auctionCount',
  });

  const total = Number(count);

  if (total === 0) {
    return [];
  }

  const auctions: AuctionItem[] = [];

  for (let i = 1; i <= total; i++) {
    try {
      const raw = await publicClient.readContract({
        address: VEIL_V3_CONTRACT_ADDRESS,
        abi: VEIL_V3_ABI,
        functionName: 'auctions',
        args: [BigInt(i)],
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

      // Skip invalid / non-existent auctions
      if (Number(id) === 0) {
  continue;
}

      let finalItemName = itemName;
      let finalDescription = description;
      let finalImageURI = imageURI;
      let assetType = 'dataset';

      // If imageURI contains an IPFS metadata JSON or local metadata, try to read it.
      if (
        imageURI.startsWith('ipfs://') ||
        imageURI.startsWith('/ipfs/') ||
        imageURI.startsWith('/uploads/') ||
        imageURI.startsWith('http://') ||
        imageURI.startsWith('https://')
      ) {
        try {
          // resolveIpfsUri routes ipfs:// through proxy, /uploads/ and https:// pass through
          const metadataUrl = resolveIpfsUri(imageURI) || imageURI;

          const response = await fetch(metadataUrl);

          if (response.ok) {
            // Only try to parse as JSON if the content-type suggests it
            const ct = response.headers.get('content-type') || '';
            if (ct.includes('json') || ct.includes('text') || imageURI.endsWith('.json')) {
              try {
                const metadata = (await response.json()) as AuctionMetadata;

                if (metadata.name) {
                  finalItemName = metadata.name;
                }

                if (metadata.description) {
                  finalDescription = metadata.description;
                }

                if (metadata.image) {
                  finalImageURI = metadata.image;
                }
                if (metadata.asset?.assetType) assetType = metadata.asset.assetType;
              } catch {
                // Content was not parseable as JSON — might be a direct image URI
              }
            }
          }
        } catch {
          // Metadata failure should not prevent auction from appearing.
        }
      }

    const commitEndMs = Number(commitEndTime) * 1000;
const revealEndMs = Number(revealEndTime) * 1000;
const now = Date.now();

let status: 'Bidding' | 'Revealing' | 'Settled';

// VeilV2 States: Created(0), Bidding(1), Revealing(2), Inspection(3), RefundRequested(4), UnderReview(5), Completed(6), Refunded(7), Cancelled(8)
if (state >= 3) {
  status = 'Settled'; // Treat all post-reveal states as Settled for the marketplace view
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
      console.error(`Failed to load auction ${i}:`, error);
    }
  }

  return auctions;
}
