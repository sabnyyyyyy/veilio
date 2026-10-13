export {};
// eslint-disable-next-line @typescript-eslint/no-var-requires
const hre = require("hardhat");
const { ethers, network } = hre;

/**
 * Redeploys ONLY VeilServiceEscrow on Base Sepolia (Chain ID 84532).
 * The existing VeilServiceRegistry is kept, so registered services stay valid.
 *
 * Usage:
 *   npx hardhat run scripts/deploy-base-sepolia-escrow.ts --network baseSepolia --tsconfig tsconfig.hardhat.json
 */
async function main() {
  const currentChainId = Number((await ethers.provider.getNetwork()).chainId);
  if (currentChainId !== 84532) {
    throw new Error(`Deployment rejected: target must be Base Sepolia (84532), connected to ${currentChainId} (${network.name}).`);
  }

  const [deployer] = await ethers.getSigners();
  if (!deployer) throw new Error("No deployer account configured. Set DEPLOYER_PRIVATE_KEY in .env.local.");
  const balance = await ethers.provider.getBalance(deployer.address);
  console.log(`Deployer: ${deployer.address} (${ethers.formatEther(balance)} ETH)`);
  if (balance === 0n) throw new Error("Deployer has 0 ETH on Base Sepolia.");

  const reviewer = process.env.REVIEWER_ADDRESS;
  const feeRecipient = process.env.FEE_RECIPIENT_ADDRESS;
  const feeBps = parseInt(process.env.INITIAL_FEE_BPS || "500", 10);
  if (!reviewer || !ethers.isAddress(reviewer)) throw new Error("Set a valid REVIEWER_ADDRESS.");
  if (!feeRecipient || !ethers.isAddress(feeRecipient)) throw new Error("Set a valid FEE_RECIPIENT_ADDRESS.");
  if (!Number.isInteger(feeBps) || feeBps < 0 || feeBps > 500) throw new Error("INITIAL_FEE_BPS must be 0-500.");

  console.log(`Deploying VeilServiceEscrow (reviewer ${reviewer}, fee ${feeBps} bps to ${feeRecipient})...`);
  const factory = await ethers.getContractFactory("VeilServiceEscrow", deployer);
  const escrow = await factory.deploy(reviewer, feeRecipient, feeBps);
  await escrow.waitForDeployment();
  const address = await escrow.getAddress();

  console.log(`VeilServiceEscrow deployed at ${address}`);
  console.log(`Tx: ${escrow.deploymentTransaction()?.hash}`);
  console.log(`\nUpdate .env.local:`);
  console.log(`NEXT_PUBLIC_BASE_SEPOLIA_SERVICE_ESCROW_ADDRESS=${address}`);
  console.log(`BASE_SEPOLIA_SERVICE_ESCROW_ADDRESS=${address}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
