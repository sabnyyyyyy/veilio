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
  txHash?: string;
}

export const MOCK_AUCTIONS: AuctionItem[] = [
  {
    id: '1',
    itemName: 'ASEAN Retail & Consumer Sentiment Dataset (12M Rows)',
    description: 'High-frequency transaction, geolocation, and sentiment dataset across retail nodes in Southeast Asia. Fully anonymized and deduplicated.',
    imageURI: 'https://images.unsplash.com/photo-1551288049-bebda4e38f71?auto=format&fit=crop&w=1200&q=80',
    startingPrice: '0.05',
    bidderCount: 14,
    commitEndTime: Date.now() + 2 * 3600 * 1000 + 14 * 60 * 1000 + 32 * 1000,
    revealEndTime: Date.now() + 26 * 3600 * 1000,
    status: 'Bidding',
    seller: '0x89205A3A3b2A69De6Dbf7f01ED13B2108B2c43e7',
    assetType: 'dataset',
    contractAddress: '0x71C41234567890abcdef1234567890abcdef39A1',
    txHash: '0x8f2d1e90a3c2b87e65f432109876543210abcdef890123456789abcdef012345',
    metadata: {
      category: 'dataset',
      licenseType: 'commercial_use',
      usageRights: 'Commercial redistribution permitted with attribution',
      format: 'Parquet / CSV',
      fileSize: '2.4 GB',
      region: 'Southeast Asia (ID, SG, MY)',
      language: 'Indonesian, English',
      dataPeriod: '2023 - 2026',
      updateFrequency: 'monthly',
      schemaOrSpecification: 'timestamp, user_segment, category, amount_usd, sentiment_score, merchant_geo',
      agentCompatible: true,
    },
    sellerReputation: {
      completedAuctions: 18,
      deliverySuccessRate: 100,
      verifiedSeller: true,
      score: 98,
    },
  },
  {
    id: '2',
    itemName: 'Llama-3-70B Financial Alpha Weights (LoRA Adapter)',
    description: 'Fine-tuned LoRA weights on 45,000 corporate earnings calls, SEC 10-K disclosures, and quantitative macroeconomic forecasts.',
    imageURI: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?auto=format&fit=crop&w=1200&q=80',
    startingPrice: '0.15',
    bidderCount: 9,
    commitEndTime: Date.now() + 5 * 3600 * 1000 + 42 * 60 * 1000,
    revealEndTime: Date.now() + 29 * 3600 * 1000,
    status: 'Bidding',
    seller: '0x3C44CdD45a9e3f268437709571780c202476B6c4',
    assetType: 'ai-model',
    contractAddress: '0x71C41234567890abcdef1234567890abcdef39A1',
    txHash: '0x3a4b5c6d7e8f90123456789abcdef0123456789abcdef0123456789abcdef012',
    metadata: {
      category: 'ai-model',
      licenseType: 'commercial_use',
      usageRights: 'Commercial deployment and fine-tuning permitted',
      format: 'Safetensors / GGUF',
      fileSize: '1.8 GB',
      region: 'Global',
      language: 'Multilingual',
      dataPeriod: 'Q1 2026 Checkpoint',
      updateFrequency: 'one_time',
      schemaOrSpecification: 'Rank 64, Alpha 128, Target modules: q_proj, v_proj, k_proj, o_proj',
      agentCompatible: true,
    },
    sellerReputation: {
      completedAuctions: 7,
      deliverySuccessRate: 100,
      verifiedSeller: true,
      score: 96,
    },
  },
  {
    id: '3',
    itemName: 'Decentralized AI Inference Node API Quota Pass (10M Tokens/mo)',
    description: 'Cryptographically verifiable API access key to private high-throughput DeepSeek & Llama-3 cluster hosted in regional APAC data centers.',
    imageURI: 'https://images.unsplash.com/photo-1558494949-ef010cbdcc31?auto=format&fit=crop&w=1200&q=80',
    startingPrice: '0.08',
    bidderCount: 21,
    commitEndTime: Date.now() + 18 * 3600 * 1000,
    revealEndTime: Date.now() + 42 * 3600 * 1000,
    status: 'Bidding',
    seller: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
    assetType: 'api-license',
    contractAddress: '0x71C41234567890abcdef1234567890abcdef39A1',
    txHash: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
    metadata: {
      category: 'api-license',
      licenseType: 'commercial_use',
      usageRights: 'Commercial API quota pass with 99.9% uptime SLA',
      format: 'OpenAPI / Bearer Credential',
      fileSize: 'Credential Key',
      region: 'APAC Low-Latency',
      language: 'English',
      dataPeriod: '30-Day Pass (Renewable)',
      updateFrequency: 'streaming',
      schemaOrSpecification: 'REST & WebSocket endpoint, rate limit 120 req/min, 10,000,000 max tokens',
      agentCompatible: true,
    },
    sellerReputation: {
      completedAuctions: 31,
      deliverySuccessRate: 98,
      verifiedSeller: true,
      score: 95,
    },
  },
  {
    id: '4',
    itemName: 'Autonomous Financial Agent Execution Core v2.4 (Enterprise Binary)',
    description: 'Audited algorithmic trading execution engine with low-latency mempool listeners and DEX router integrations for BNB Chain.',
    imageURI: 'https://images.unsplash.com/photo-1526374965328-7f61d4dc18c5?auto=format&fit=crop&w=1200&q=80',
    startingPrice: '0.25',
    bidderCount: 16,
    commitEndTime: Date.now() + 8 * 3600 * 1000,
    revealEndTime: Date.now() + 32 * 3600 * 1000,
    status: 'Bidding',
    seller: '0x5B38Da6a701c568545dCfcB03FcB875f56beddC4',
    assetType: 'software-license',
    contractAddress: '0x71C41234567890abcdef1234567890abcdef39A1',
    txHash: '0x44556677889900aabbccddeeff0011223344556677889900aabbccddeeff0011',
    metadata: {
      category: 'software-license',
      licenseType: 'exclusive_transfer',
      usageRights: 'Perpetual binary deployment license for 1 enterprise entity',
      format: 'Docker Container / Linux AMD64',
      fileSize: '480 MB',
      region: 'Global',
      language: 'TypeScript / Rust',
      dataPeriod: 'v2.4 LTS',
      updateFrequency: 'one_time',
      schemaOrSpecification: 'OCI container image with signed provenance, config YAML schema included',
      agentCompatible: true,
    },
    sellerReputation: {
      completedAuctions: 12,
      deliverySuccessRate: 100,
      verifiedSeller: true,
      score: 99,
    },
  },
  {
    id: '42',
    itemName: 'Multilingual Legal Jurisprudence Training Corpus (500k Documents)',
    description: 'Verified public auction record on BNB Chain Testnet. Structured legal case summaries, rulings, and statutory corpora across Commonwealth and Civil Law jurisdictions.',
    imageURI: 'https://images.unsplash.com/photo-1450133064473-71024230f91b?auto=format&fit=crop&w=1200&q=80',
    startingPrice: '0.10',
    bidderCount: 28,
    commitEndTime: Date.now() - 3600 * 1000,
    revealEndTime: Date.now() - 1000,
    status: 'Settled',
    seller: '0x89205A3A3b2A69De6Dbf7f01ED13B2108B2c43e7',
    highestBidder: '0x71C4a8901234567890abcdef1234567890ab39A1',
    winningPrice: '0.18',
    assetType: 'data-license',
    contractAddress: '0x71C41234567890abcdef1234567890abcdef39A1',
    txHash: '0x42f7901bc3d2e9876543210abcdef9876543210abcdef9876543210abcdef42',
    metadata: {
      category: 'data-license',
      licenseType: 'academic_or_research',
      usageRights: 'Research and LLM fine-tuning permitted',
      format: 'Parquet / JSONL',
      fileSize: '4.1 GB',
      region: 'Asia-Pacific & UK',
      language: 'English, Indonesian, Malay',
      dataPeriod: '2018 - 2026',
      updateFrequency: 'monthly',
      schemaOrSpecification: 'case_id, jurisdiction, decision_date, citations, full_text_cleaned, summary_tokens',
      agentCompatible: true,
    },
    sellerReputation: {
      completedAuctions: 18,
      deliverySuccessRate: 100,
      verifiedSeller: true,
      score: 98,
    },
  }
];

export function getAuctionById(id: string): AuctionItem {
  const found = MOCK_AUCTIONS.find(a => a.id === id);
  if (found) return found;

  return {
    id,
    itemName: `Digital Asset Listing #${id}`,
    description: 'Verified digital asset sealed-bid auction listed on BNB Chain.',
    imageURI: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?auto=format&fit=crop&w=1200&q=80',
    startingPrice: '0.05',
    bidderCount: 6,
    commitEndTime: Date.now() + 8 * 3600 * 1000,
    revealEndTime: Date.now() + 32 * 3600 * 1000,
    status: 'Bidding',
    seller: '0x89205A3A3b2A69De6Dbf7f01ED13B2108B2c43e7',
    assetType: 'dataset',
    contractAddress: '0x71C41234567890abcdef1234567890abcdef39A1',
    txHash: `0x${id}000000000000000000000000000000000000000000000000000000000000`,
    metadata: {
      category: 'dataset',
      licenseType: 'commercial_use',
      format: 'Parquet',
      fileSize: '1.2 GB',
      agentCompatible: true,
    },
    sellerReputation: {
      completedAuctions: 10,
      deliverySuccessRate: 100,
      verifiedSeller: true,
      score: 95,
    },
  };
}
