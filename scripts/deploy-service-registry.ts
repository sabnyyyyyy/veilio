// eslint-disable-next-line @typescript-eslint/no-var-requires
const hre = require("hardhat");
const { ethers, network } = hre;

/**
 * Pre-deployment and deployment script for VeilServiceRegistry on BNB Chain Testnet (Chain ID 97).
 *
 * NOTE: DO NOT EXECUTE THIS SCRIPT UNTIL LIVE DEPLOYMENT IS EXPLICITLY AUTHORIZED.
 * Usage:
 *   npx hardhat run scripts/deploy-service-registry.ts --network bnbChain
 */
async function main() {
  console.log("==================================================");
  console.log("VEILIO Service Registry: Testnet Deployment Preflight");
  console.log("==================================================");

  // 1. Validate Network and Chain ID
  const networkName = network.name;
  const currentNetwork = await ethers.provider.getNetwork();
  const currentChainId = Number(currentNetwork.chainId);

  console.log(`Target Hardhat Network: ${networkName}`);
  console.log(`Detected Chain ID: ${currentChainId}`);

  if (currentChainId !== 97 && networkName !== "hardhat" && networkName !== "localhost") {
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

  if (balance === 0n && networkName === "bnbChain") {
    throw new Error(
      `Deployer account ${deployer.address} has 0 tBNB. Fund it from the official BNB Chain Testnet faucet before deploying.`
    );
  }

  // 3. Deploy VeilServiceRegistry
  console.log("\nDeploying VeilServiceRegistry...");
  const RegistryFactory = await ethers.getContractFactory("VeilServiceRegistry", deployer);
  const registry = await RegistryFactory.deploy();

  console.log("Awaiting deployment confirmation...");
  await registry.waitForDeployment();

  const registryAddress = await registry.getAddress();
  const deployTx = registry.deploymentTransaction();

  console.log("==================================================");
  console.log("VeilServiceRegistry Deployment Confirmed!");
  console.log(`Deployed Address: ${registryAddress}`);
  console.log(`Deployment Tx: ${deployTx?.hash || "N/A"}`);
  console.log("==================================================");
  console.log(`Add to .env.local:`);
  console.log(`NEXT_PUBLIC_SERVICE_REGISTRY_CONTRACT_ADDRESS=${registryAddress}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Deployment failed:", error);
    process.exit(1);
  });

export {};

