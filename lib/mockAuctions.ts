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
  highestBidder?: string;
  winningPrice?: string;
  contractAddress?: string;
  txHash?: string;
}

export const MOCK_AUCTIONS: AuctionItem[] = [
  {
    id: '1',
    itemName: 'MacBook Pro M4 Max (Space Black)',
    description: '16-inch liquid retina XDR display, 128GB unified memory, 4TB SSD. Brand new sealed unit.',
    imageURI: 'https://images.unsplash.com/photo-1517336714731-48979fd1ca8?auto=format&fit=crop&w=1200&q=80',
    startingPrice: '500',
    bidderCount: 37,
    commitEndTime: Date.now() + 2 * 3600 * 1000 + 14 * 60 * 1000 + 32 * 1000, // 2h 14m 32s
    revealEndTime: Date.now() + 26 * 3600 * 1000,
    status: 'Bidding',
    seller: '0x89205A3A3b2A69De6Dbf7f01ED13B2108B2c43e7',
    contractAddress: '0x71C41234567890abcdef1234567890abcdef39A1',
    txHash: '0x8f2d1e90a3c2b87e65f432109876543210abcdef890123456789abcdef012345',
  },
  {
    id: '2',
    itemName: 'Leica M11 Monochrom (Matte Black)',
    description: 'Bespoke 60MP BSI CMOS sensor dedicated exclusively to black and white photography. Includes 35mm Summilux lens.',
    imageURI: 'https://images.unsplash.com/photo-1516035069371-29a1b244cc32?auto=format&fit=crop&w=1200&q=80',
    startingPrice: '1200',
    bidderCount: 19,
    commitEndTime: Date.now() + 5 * 3600 * 1000 + 42 * 60 * 1000,
    revealEndTime: Date.now() + 29 * 3600 * 1000,
    status: 'Bidding',
    seller: '0x3C44CdD45a9e3f268437709571780c202476B6c4',
    contractAddress: '0x71C41234567890abcdef1234567890abcdef39A1',
    txHash: '0x3a4b5c6d7e8f90123456789abcdef0123456789abcdef0123456789abcdef012',
  },
  {
    id: '3',
    itemName: 'Rolex Submariner Date Ref. 126610LN',
    description: 'Oystersteel case with black Cerachrom bezel insert. Unworn with original box and 2026 guarantee card.',
    imageURI: 'https://images.unsplash.com/photo-1523275335684-37898b6baf30?auto=format&fit=crop&w=1200&q=80',
    startingPrice: '2400',
    bidderCount: 42,
    commitEndTime: Date.now() + 18 * 3600 * 1000,
    revealEndTime: Date.now() + 42 * 3600 * 1000,
    status: 'Bidding',
    seller: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
    contractAddress: '0x71C41234567890abcdef1234567890abcdef39A1',
    txHash: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
  },
  {
    id: '42',
    itemName: 'MacBook Pro M4',
    description: 'Verified public auction record on BNB Chain Testnet.',
    imageURI: 'https://images.unsplash.com/photo-1517336714731-48979fd1ca8?auto=format&fit=crop&w=1200&q=80',
    startingPrice: '500',
    bidderCount: 37,
    commitEndTime: Date.now() - 3600 * 1000,
    revealEndTime: Date.now() - 1000,
    status: 'Settled',
    seller: '0x89205A3A3b2A69De6Dbf7f01ED13B2108B2c43e7',
    highestBidder: '0x71C4a8901234567890abcdef1234567890ab39A1',
    winningPrice: '681',
    contractAddress: '0x71C41234567890abcdef1234567890abcdef39A1',
    txHash: '0x42f7901bc3d2e9876543210abcdef9876543210abcdef9876543210abcdef42',
  }
];

export function getAuctionById(id: string): AuctionItem {
  const found = MOCK_AUCTIONS.find(a => a.id === id);
  if (found) return found;

  return {
    id,
    itemName: `Auction Item #${id}`,
    description: 'Custom sealed-bid auction item created on BNB Chain Testnet.',
    imageURI: 'https://images.unsplash.com/photo-1526170375885-4d8ecf77b99f?auto=format&fit=crop&w=1200&q=80',
    startingPrice: '300',
    bidderCount: 12,
    commitEndTime: Date.now() + 8 * 3600 * 1000,
    revealEndTime: Date.now() + 32 * 3600 * 1000,
    status: 'Bidding',
    seller: '0x89205A3A3b2A69De6Dbf7f01ED13B2108B2c43e7',
    contractAddress: '0x71C41234567890abcdef1234567890abcdef39A1',
    txHash: `0x${id}000000000000000000000000000000000000000000000000000000000000`,
  };
}
