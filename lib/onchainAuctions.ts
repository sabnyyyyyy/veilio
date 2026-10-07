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
  publicClient: NonNullable<ReturnType<typeof usePublicClient>>,
  input: { cursor?: string | bigint | number; limit?: number } = {},
): Promise<{ auctions: AuctionItem[]; nextCursor: string | null; total: string }> {
  const count = await publicClient.readContract({
    address: VEIL_V3_CONTRACT_ADDRESS,
    abi: VEIL_V3_ABI,
    functionName: 'auctionCount',
  }) as bigint;

  const limit = Math.min(Math.max(Math.trunc(input.limit ?? 20), 1), 50);
  const requestedCursor: bigint = input.cursor === undefined ? count : BigInt(input.cursor);
  const start = requestedCursor > count ? count : requestedCursor;
  const ids: bigint[] = [];
  for (let id = start; id > 0n && ids.length < limit; id--) ids.push(id);

  const results = await Promise.all(ids.map(async (auctionId) => {
    try {
      const raw = await publicClient.readContract({
        address: VEIL_V3_CONTRACT_ADDRESS,
        abi: VEIL_V3_ABI,
        functionName: 'auctions',
        args: [auctionId],
      }) as unknown as AuctionData;

      const [
        recordId,
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
      if (Number(recordId) === 0) return null;

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

          const response = await fetch(metadataUrl, { signal: AbortSignal.timeout(7000) });

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
      const status: AuctionItem['status'] = state >= 3
        ? 'Settled'
        : now < commitEndMs ? 'Bidding' : now < revealEndMs ? 'Revealing' : 'Settled';

      return {
        id: String(recordId), itemName: finalItemName, description: finalDescription,
        imageURI: finalImageURI, startingPrice: formatEther(startingPrice),
        bidderCount: Number(bidderCount), commitEndTime: commitEndMs,
        revealEndTime: revealEndMs, status, seller, assetType,
      } as AuctionItem;
    } catch (error) {
      console.error(`Failed to load auction ${auctionId}:`, error);
      return null;
    }
  }));
  const auctions = results.filter((auction): auction is AuctionItem => auction !== null);

  const lastId = ids.at(-1);
  const nextCursor = lastId !== undefined && lastId > 1n && ids.length === limit ? (lastId - 1n).toString() : null;
  return { auctions, nextCursor, total: count.toString() };
}
