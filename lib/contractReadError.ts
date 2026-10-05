const NO_CONTRACT_RESULT = /returned no data|returned no result|could not decode result data|address is not a contract/i;

export function contractReadErrorMessage(error: unknown, address: string): string {
  const message = error instanceof Error ? error.message : String(error ?? '');

  if (NO_CONTRACT_RESULT.test(message)) {
    return `VEILIO could not read auction data from the configured contract (${address}) on BNB Chain Testnet. Check that NEXT_PUBLIC_V4_CONTRACT_ADDRESS points to the deployed VeilNFTV4 contract, or NEXT_PUBLIC_V3_CONTRACT_ADDRESS points to a compatible Veil auction contract, then redeploy the web app.`;
  }

  return 'Could not load auction data from BNB Chain Testnet. Check your network connection and try again.';
}
