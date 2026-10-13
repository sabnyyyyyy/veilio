const NO_CONTRACT_RESULT = /returned no data|returned no result|address is not a contract/i;
const ABI_MISMATCH = /could not decode result data|function does not exist|invalid argument|data slice out of bounds/i;
const RPC_FAILURE = /timeout|fetch failed|network error|connection refused|socket hang up|rate limit|429/i;
const EXECUTION_REVERT = /execution reverted|reverted with/i;

export interface ContractReadErrorOptions {
  networkName?: string;
  chainId?: number;
  expectedChainId?: number;
}

export function contractReadErrorMessage(
  error: unknown,
  address: string,
  options?: ContractReadErrorOptions
): string {
  const message = error instanceof Error ? error.message : String(error ?? '');
  const networkName = options?.networkName || (options?.expectedChainId === 84532 ? 'Base Sepolia' : 'BNB Chain Testnet');

  if (options?.chainId && options?.expectedChainId && options.chainId !== options.expectedChainId) {
    return `Network mismatch: your wallet is connected to Chain ${options.chainId}, but this view reads from ${networkName} (Chain ${options.expectedChainId}). Please switch your network.`;
  }

  if (NO_CONTRACT_RESULT.test(message)) {
    return `VEILIO could not read auction data from the configured contract (${address}) on ${networkName}. Check that NEXT_PUBLIC_V4_CONTRACT_ADDRESS points to the deployed VeilNFTV4 contract, or NEXT_PUBLIC_V3_CONTRACT_ADDRESS points to a compatible Veil auction contract, then redeploy the web app.`;
  }

  if (ABI_MISMATCH.test(message)) {
    return `Contract ABI mismatch at configured contract (${address}) on ${networkName}. The deployed contract does not match the expected auction interface. Check that NEXT_PUBLIC_V4_CONTRACT_ADDRESS points to the deployed VeilNFTV4 contract.`;
  }

  if (EXECUTION_REVERT.test(message)) {
    return `Contract call reverted while reading auction data from ${address} on ${networkName}. The contract execution reverted.`;
  }

  if (RPC_FAILURE.test(message)) {
    return `Could not load auction data from ${networkName} due to an RPC network connection issue. Check your network connection and try again.`;
  }

  return `Could not load auction data from ${networkName}. Check your network connection and try again.`;
}
