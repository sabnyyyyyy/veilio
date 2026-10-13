import { ethers, network } from 'hardhat';

async function main() {
  if (network.name !== 'baseSepolia') {
    throw new Error(`Run this verification on baseSepolia, not ${network.name}.`);
  }
  const chainId = (await ethers.provider.getNetwork()).chainId;
  if (chainId !== 84532n) {
    throw new Error(`RPC chain mismatch: expected 84532, received ${chainId}.`);
  }

  const address = process.env.BASE_SEPOLIA_AUCTION_ADDRESS;
  const expectedReviewer = process.env.REVIEWER_ADDRESS;
  const expectedFeeRecipient = process.env.FEE_RECIPIENT_ADDRESS;
  if (!address || !ethers.isAddress(address)) {
    throw new Error('Set BASE_SEPOLIA_AUCTION_ADDRESS to the deployed auction address.');
  }
  if (!expectedReviewer || !ethers.isAddress(expectedReviewer)) {
    throw new Error('REVIEWER_ADDRESS is missing or invalid.');
  }
  if (!expectedFeeRecipient || !ethers.isAddress(expectedFeeRecipient)) {
    throw new Error('FEE_RECIPIENT_ADDRESS is missing or invalid.');
  }

  const code = await ethers.provider.getCode(address);
  if (code === '0x') throw new Error(`No contract bytecode found at ${address}.`);

  const auction = await ethers.getContractAt('VeilNFTV4', address);
  const [reviewer, feeRecipient] = await Promise.all([auction.reviewer(), auction.feeRecipient()]);
  if (reviewer.toLowerCase() !== expectedReviewer.toLowerCase()) {
    throw new Error(`Reviewer mismatch: contract has ${reviewer}, local configuration expects a different address.`);
  }
  if (feeRecipient.toLowerCase() !== expectedFeeRecipient.toLowerCase()) {
    throw new Error(`Fee recipient mismatch: contract has ${feeRecipient}, local configuration expects a different address.`);
  }

  console.log(`Verified Base Sepolia auction: ${address}`);
  console.log(`Chain ID: ${chainId}`);
  console.log(`Bytecode: present (${(code.length - 2) / 2} bytes)`);
  console.log('Reviewer and fee recipient: match local configuration');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
