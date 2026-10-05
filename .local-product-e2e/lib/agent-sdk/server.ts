import { createPublicClient, http, parseAbi } from 'viem';
import { bnbChain } from '../chain';
import { VEIL_V3_CONTRACT_ADDRESS } from '../contract';

export const agentAuctionAbi = parseAbi([
  'function auctionCount() view returns (uint256)',
  'function auctions(uint256 auctionId) view returns (uint256 id, address seller, string itemName, string description, string imageURI, uint256 startingPrice, uint256 commitEndTime, uint256 revealEndTime, uint256 inspectionDuration, uint256 inspectionEndTime, uint8 state, address highestBidder, uint256 highestBid, uint256 bidderCount, uint256 revealedCount, bytes32 finalTxHash, string evidenceHash, string reviewReason)',
  'function getAuctionState(uint256 auctionId) view returns (uint8)',
]);

export const agentPublicClient = createPublicClient({
  chain: bnbChain,
  transport: http(process.env.NEXT_PUBLIC_BNB_CHAIN_RPC || undefined),
});

const stateNames = ['Created', 'Bidding', 'Revealing', 'Inspection', 'RefundRequested', 'UnderReview', 'Completed', 'Refunded', 'Cancelled'] as const;

export async function readAgentAuction(id: bigint) {
  const [auction, currentState] = await Promise.all([
    agentPublicClient.readContract({ address: VEIL_V3_CONTRACT_ADDRESS, abi: agentAuctionAbi, functionName: 'auctions', args: [id] }),
    agentPublicClient.readContract({ address: VEIL_V3_CONTRACT_ADDRESS, abi: agentAuctionAbi, functionName: 'getAuctionState', args: [id] }),
  ]);
  if (auction[0] === 0n) return null;
  return {
    id: auction[0].toString(),
    seller: auction[1],
    itemName: auction[2],
    description: auction[3],
    metadataURI: auction[4],
    startingPriceWei: auction[5].toString(),
    commitEndTime: auction[6].toString(),
    revealEndTime: auction[7].toString(),
    inspectionDuration: auction[8].toString(),
    inspectionEndTime: auction[9].toString(),
    state: stateNames[Number(currentState)] ?? 'Unknown',
    highestBidder: auction[11],
    highestBidWei: auction[12].toString(),
    bidderCount: auction[13].toString(),
    revealedCount: auction[14].toString(),
  };
}
