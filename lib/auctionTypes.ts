export type AssetCategory =
  | 'dataset'
  | 'ai-model'
  | 'data-license'
  | 'api-license'
  | 'software-license'
  | 'nft'
  | 'digital-asset';

export type LicenseType =
  | 'commercial_use'
  | 'academic_or_research'
  | 'exclusive_transfer';

export interface AssetMetadata {
  category?: AssetCategory;
  licenseType?: LicenseType;
  usageRights?: string;
  format?: string;
  fileSize?: string;
  region?: string;
  language?: string;
  dataPeriod?: string;
  updateFrequency?: 'one_time' | 'monthly' | 'streaming';
  schemaOrSpecification?: string;
  previewUrl?: string;
  agentCompatible?: boolean;
}

export interface SellerReputation {
  completedAuctions: number;
  deliverySuccessRate: number; // Percentage, e.g. 100
  verifiedSeller: boolean;
  score: number; // Reliability score out of 100
}

export interface AuctionItem {
  id: string;
  itemName: string;
  description: string;
  imageURI: string;
  startingPrice: string; // in BNB
  bidderCount: number;
  commitEndTime: number; // Unix timestamp
  revealEndTime: number; // Unix timestamp
  status: 'Bidding' | 'Revealing' | 'Settled';
  seller: string;
  assetType?: string;
  metadata?: AssetMetadata;
  sellerReputation?: SellerReputation;
  highestBidder?: string;
  winningPrice?: string;
  contractAddress?: string;
  networkId?: 'bnb:97' | 'base:84532' | 'solana:devnet';
  txHash?: string;
}
