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
}) {
  return [domain('upload'), `Wallet: ${input.address.toLowerCase()}`, `Asset type: ${input.assetType}`, `File: ${input.fileName}`, `Bytes: ${input.fileSize}`, `Timestamp: ${input.timestamp}`, `Nonce: ${input.nonce}`].join('\n');
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
