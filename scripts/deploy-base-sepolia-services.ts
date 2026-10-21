export {};
// eslint-disable-next-line @typescript-eslint/no-var-requires
const hre = require("hardhat");
const { ethers, network } = hre;

/**
 * Deployment script for VEILIO Services (VeilServiceRegistry & VeilServiceEscrow) on Base Sepolia (Chain ID 84532).
 *
 * Usage:
 *   npx hardhat run scripts/deploy-base-sepolia-services.ts --network baseSepolia
 */
async function main() {
  console.log("==================================================");
  console.log("VEILIO Services: Base Sepolia Deployment");
  console.log("==================================================");

  // 1. Validate Network and Chain ID
  const networkName = network.name;
  const currentNetwork = await ethers.provider.getNetwork();
  const currentChainId = Number(currentNetwork.chainId);

  console.log(`Target Hardhat Network: ${networkName}`);
  console.log(`Detected Chain ID: ${currentChainId}`);

  if (currentChainId !== 84532 && networkName !== "hardhat" && networkName !== "localhost") {
    throw new Error(
      `Deployment rejected: Target must be Base Sepolia (Chain ID 84532), but connected to Chain ID ${currentChainId}.`
    );
  }

  // 2. Validate Deployer Account
  const signers = await ethers.getSigners();
  if (!signers || signers.length === 0) {
    throw new Error(
      "No deployer account configured. Set DEPLOYER_PRIVATE_KEY in your environment or .env.local file."
    );
  }
  const deployer = signers[0];
  console.log(`Deployer Address: ${deployer.address}`);

  const balance = await ethers.provider.getBalance(deployer.address);
  const formattedBalance = ethers.formatEther(balance);
  console.log(`Deployer ETH Balance: ${formattedBalance} ETH`);

  if (balance === 0n) {
    throw new Error(
      `Deployer account ${deployer.address} has 0 ETH on Base Sepolia. Fund it from the Base Sepolia faucet before deploying.`
    );
  }

  // 3. Deploy VeilServiceRegistry on Base Sepolia
  console.log("\n1/2 Deploying VeilServiceRegistry on Base Sepolia...");
  const RegistryFactory = await ethers.getContractFactory("VeilServiceRegistry", deployer);
  const registry = await RegistryFactory.deploy();
  await registry.waitForDeployment();
  const registryAddress = await registry.getAddress();
  const registryTx = registry.deploymentTransaction();

  console.log(`VeilServiceRegistry Deployed!`);
  console.log(`Registry Address: ${registryAddress}`);
  console.log(`Registry Tx Hash: ${registryTx?.hash || "N/A"}`);

  // 4. Validate Constructor Arguments for VeilServiceEscrow
  const reviewerAddress = process.env.REVIEWER_ADDRESS || deployer.address;
  const feeRecipientAddress = process.env.FEE_RECIPIENT_ADDRESS || deployer.address;
  const rawFeeBps = process.env.INITIAL_FEE_BPS || "850";
  const initialFeeBps = parseInt(rawFeeBps, 10);

  if (!ethers.isAddress(reviewerAddress)) {
    throw new Error(`Invalid REVIEWER_ADDRESS: ${reviewerAddress}`);
  }
  if (!ethers.isAddress(feeRecipientAddress)) {
    throw new Error(`Invalid FEE_RECIPIENT_ADDRESS: ${feeRecipientAddress}`);
  }
  if (!Number.isInteger(initialFeeBps) || initialFeeBps < 0 || initialFeeBps > 850) {
    throw new Error("INITIAL_FEE_BPS must be between 0 and 850 (max 8.5%).");
  }

  console.log("\n2/2 Deploying VeilServiceEscrow on Base Sepolia...");
  console.log(`- Reviewer:       ${reviewerAddress}`);
  console.log(`- Fee Recipient:  ${feeRecipientAddress}`);
  console.log(`- Platform Fee:   ${initialFeeBps} bps (${(initialFeeBps / 100).toFixed(2)}%)`);

  const EscrowFactory = await ethers.getContractFactory("VeilServiceEscrow", deployer);
  const escrow = await EscrowFactory.deploy(reviewerAddress, feeRecipientAddress, initialFeeBps);
  await escrow.waitForDeployment();
  const escrowAddress = await escrow.getAddress();
  const escrowTx = escrow.deploymentTransaction();

  console.log(`VeilServiceEscrow Deployed!`);
  console.log(`Escrow Address:   ${escrowAddress}`);
  console.log(`Escrow Tx Hash:   ${escrowTx?.hash || "N/A"}`);

  console.log("\n==================================================");
  console.log("Base Sepolia VEILIO Services Deployment Complete!");
  console.log("==================================================");
  console.log(`Network:                                      Base Sepolia`);
  console.log(`Chain ID:                                     84532`);
  console.log(`VeilServiceRegistry:                          ${registryAddress}`);
  console.log(`Registry Deployment Tx:                       ${registryTx?.hash}`);
  console.log(`VeilServiceEscrow:                            ${escrowAddress}`);
  console.log(`Escrow Deployment Tx:                         ${escrowTx?.hash}`);
  console.log("==================================================");
  console.log(`Add to .env.local:`);
  console.log(`NEXT_PUBLIC_BASE_SEPOLIA_SERVICE_REGISTRY_ADDRESS="${registryAddress}"`);
  console.log(`NEXT_PUBLIC_BASE_SEPOLIA_SERVICE_ESCROW_ADDRESS="${escrowAddress}"`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Deployment failed:", error);
    process.exit(1);
  });
