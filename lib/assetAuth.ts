import { VEIL_V3_CONTRACT_ADDRESS } from './contract';
import { bnbChain } from './chain';

const domain = (action: string) => [
  'VEILIO ASSET ACCESS V1',
  `Action: ${action}`,
  `Chain ID: ${bnbChain.id}`,
  `Contract: ${VEIL_V3_CONTRACT_ADDRESS.toLowerCase()}`,
].join('\n');

export function assetUploadMessage(input: {
  address: string;
  assetType: string;
  fileName: string;
  fileSize: number;
  timestamp: number;
  nonce: string;
  datasetId?: string;
  fileHashHex?: string;
}) {
  return [
    domain('upload'),
    'Purpose: Off-chain upload authorization only; this signature does not submit a blockchain transaction.',
    `Wallet: ${input.address.toLowerCase()}`,
    `Asset type: ${input.assetType}`,
    `File: ${input.fileName}`,
    `Bytes: ${input.fileSize}`,
    ...(input.datasetId ? [`Dataset ID: ${input.datasetId}`] : []),
    ...(input.fileHashHex ? [`SHA-256: ${input.fileHashHex.toLowerCase()}`] : []),
    `Timestamp: ${input.timestamp}`,
    `Nonce: ${input.nonce}`,
  ].join('\n');
}

export function datasetLinkMessage(input: { datasetId: string; auctionId: string; address: string; timestamp: number }) {
  return [domain('link'), `Dataset ID: ${input.datasetId}`, `Auction ID: ${input.auctionId}`, `Seller: ${input.address.toLowerCase()}`, `Timestamp: ${input.timestamp}`].join('\n');
}

export function datasetInspectMessage(input: { auctionId: string; address: string; timestamp: number }) {
  return [domain('inspect'), `Auction ID: ${input.auctionId}`, `Wallet: ${input.address.toLowerCase()}`, `Timestamp: ${input.timestamp}`].join('\n');
}

export function datasetDownloadMessage(input: { auctionId: string; address: string; timestamp: number }) {
  return [domain('download'), `Auction ID: ${input.auctionId}`, `Wallet: ${input.address.toLowerCase()}`, `Timestamp: ${input.timestamp}`].join('\n');
}

export function datasetPreviewMessage(input: { auctionId: string; address: string; timestamp: number }) {
  return [domain('publish preview'), 'Purpose: Make up to 10 dataset rows and column names public for this auction. This is an off-chain signature only; it does not submit a blockchain transaction.', `Auction ID: ${input.auctionId}`, `Seller: ${input.address.toLowerCase()}`, `Timestamp: ${input.timestamp}`].join('\n');
}

export function transactionChatMessage(input: { transactionId: string; address: string; timestamp: number }) {
  return [domain('chat'), `Transaction ID: ${input.transactionId}`, `Wallet: ${input.address.toLowerCase()}`, `Timestamp: ${input.timestamp}`].join('\n');
}

export function transactionDisputeMessage(input: { auctionId: string; address: string; timestamp: number }) {
  return [domain('dispute'), `Auction ID: ${input.auctionId}`, `Wallet: ${input.address.toLowerCase()}`, `Timestamp: ${input.timestamp}`].join('\n');
}
