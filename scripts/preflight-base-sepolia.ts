export {};
// eslint-disable-next-line @typescript-eslint/no-var-requires
const hre = require('hardhat');
const { ethers, network } = hre;

async function main() {
  if (network.name !== 'baseSepolia') {
    throw new Error(`Run this preflight on baseSepolia, not ${network.name}.`);
  }

  const expectedChainId = 84532n;
  const actualChainId = (await ethers.provider.getNetwork()).chainId;
  if (actualChainId !== expectedChainId) {
    throw new Error(`RPC chain mismatch: expected ${expectedChainId}, received ${actualChainId}.`);
  }

  const [deployer] = await ethers.getSigners();
  if (!deployer) throw new Error('DEPLOYER_PRIVATE_KEY is missing from local environment configuration.');

  const address = await deployer.getAddress();
  const balance = await ethers.provider.getBalance(address);
  const reviewer = process.env.REVIEWER_ADDRESS;
  const feeRecipient = process.env.FEE_RECIPIENT_ADDRESS;

  console.log(`Network: ${network.name} (${actualChainId})`);
  console.log(`Deployer address: ${address}`);
  console.log(`Deployer balance: ${ethers.formatEther(balance)} ETH`);
  console.log(`Reviewer configured: ${Boolean(reviewer && ethers.isAddress(reviewer))}`);
  console.log(`Fee recipient configured: ${Boolean(feeRecipient && ethers.isAddress(feeRecipient))}`);
  console.log(`Ready to deploy: ${balance > 0n && Boolean(reviewer && ethers.isAddress(reviewer)) && Boolean(feeRecipient && ethers.isAddress(feeRecipient))}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
