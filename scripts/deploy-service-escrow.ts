// eslint-disable-next-line @typescript-eslint/no-var-requires
const hre = require("hardhat");
const { ethers, network } = hre;

/**
 * Pre-deployment script for VeilServiceEscrow on BNB Chain Testnet (Chain ID 97).
 *
 * NOTE: DO NOT EXECUTE THIS SCRIPT UNTIL LIVE DEPLOYMENT IS EXPLICITLY AUTHORIZED.
 * Usage:
 *   npx hardhat run scripts/deploy-service-escrow.ts --network bnbChain
 */
async function main() {
  console.log("==================================================");
  console.log("VEILIO Services Escrow: Testnet Deployment Preflight");
  console.log("==================================================");

  // 1. Validate Network and Chain ID
  const networkName = network.name;
  const currentNetwork = await ethers.provider.getNetwork();
  const currentChainId = Number(currentNetwork.chainId);

  console.log(`Target Hardhat Network: ${networkName}`);
  console.log(`Detected Chain ID: ${currentChainId}`);

  if (currentChainId !== 97) {
    throw new Error(
      `Deployment rejected: Target must be BNB Chain Testnet (Chain ID 97), but connected to Chain ID ${currentChainId}.`
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
  console.log(`Deployer tBNB Balance: ${formattedBalance} tBNB`);

  if (balance === 0n) {
    throw new Error(
      `Deployer account ${deployer.address} has 0 tBNB. Fund it from the official BNB Chain Testnet faucet before deploying.`
    );
  }

  // 3. Validate Constructor Arguments
  const reviewerAddress = process.env.REVIEWER_ADDRESS || deployer.address;
  const feeRecipientAddress = process.env.FEE_RECIPIENT_ADDRESS || deployer.address;
  const rawFeeBps = process.env.INITIAL_FEE_BPS || "500"; // Default: 500 bps = 5%
  const initialFeeBps = parseInt(rawFeeBps, 10);

  if (!ethers.isAddress(reviewerAddress)) {
    throw new Error(`Invalid REVIEWER_ADDRESS: ${reviewerAddress}`);
  }
  if (!ethers.isAddress(feeRecipientAddress)) {
    throw new Error(`Invalid FEE_RECIPIENT_ADDRESS: ${feeRecipientAddress}`);
  }
  if (isNaN(initialFeeBps) || initialFeeBps < 0 || initialFeeBps > 500) {
    throw new Error(
      `Invalid INITIAL_FEE_BPS: "${rawFeeBps}". Fee must be an integer between 0 and 500 (max 5%).`
    );
  }

  console.log("\nValidated Constructor Arguments:");
  console.log(`- Reviewer Address:     ${reviewerAddress}`);
  console.log(`- Fee Recipient:        ${feeRecipientAddress}`);
  console.log(`- Platform Fee:         ${initialFeeBps} bps (${(initialFeeBps / 100).toFixed(2)}%)`);

  // 4. Contract Factory & Deployment
  console.log("\nDeploying VeilServiceEscrow contract...");
  const factory = await ethers.getContractFactory("VeilServiceEscrow", deployer);
  const escrow = await factory.deploy(reviewerAddress, feeRecipientAddress, initialFeeBps);

  const deploymentTx = escrow.deploymentTransaction();
  console.log(`Deployment Transaction Hash: ${deploymentTx?.hash || "Pending..."}`);

  await escrow.waitForDeployment();
  const deployedAddress = await escrow.getAddress();

  console.log("\n==================================================");
  console.log("VEILIO Services Escrow Successfully Deployed!");
  console.log("==================================================");
  console.log(`Contract Address:           ${deployedAddress}`);
  console.log(`Deployment Transaction:     ${deploymentTx?.hash}`);
  console.log(`Network:                    BNB Chain Testnet`);
  console.log(`Chain ID:                   97`);
  console.log(`Reviewer:                   ${reviewerAddress}`);
  console.log(`Fee Recipient:              ${feeRecipientAddress}`);
  console.log(`Fee Basis Points:           ${initialFeeBps} bps`);
  console.log("==================================================");

  console.log("\nNext Steps for Post-Deployment Setup:");
  console.log("1. Add the address to your .env.local file (DO NOT touch existing legacy contract addresses):");
  console.log(`   NEXT_PUBLIC_SERVICE_ESCROW_CONTRACT_ADDRESS="${deployedAddress}"`);
  console.log("\n2. Verify the contract source code on BscScan Testnet:");
  console.log(
    `   npx hardhat verify --network bnbChain ${deployedAddress} "${reviewerAddress}" "${feeRecipientAddress}" ${initialFeeBps}`
  );
  console.log("\n3. Restart or redeploy the application to load the new environment variable.");
}

main().catch((error) => {
  console.error("\n[DEPLOYMENT ERROR]:", error.message || error);
  process.exitCode = 1;
});

export {};
