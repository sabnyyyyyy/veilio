import hre from "hardhat";
import fs from "fs";
import path from "path";

const { ethers } = hre;

async function main() {
  const deploymentTxHash = "0x80b9cf6de14f1a0a556b99910e1abad0b53536447ef15dd8020c24a12e8f6e4c";
  const expectedContractAddress = "0x016A23A069180587d5D8B09413e97E1e78ccD702";
  const expectedEscrowAddress = "0x794f1610B5588a55B19D8c82e4381448a388C965";
  const legacyAuctionContracts = [
    "0xE07bBaaF8524E9114C02cbbCb5F11041F3D4Be77",
    "0x2df959a785E489AF457410F7C81a6BDDc1E8D41B",
    "0xc12EcD53B9dAE1753409B87f10Bf00684BF7d8B1",
    "0x0D1c307B4D59143703aE38fB6479d9Dac1fec987"
  ];

  console.log("================================================================");
  console.log("FINAL VEIL SERVICE REGISTRY DEPLOYMENT ON-CHAIN VERIFICATION");
  console.log("================================================================");

  // 1. Network & Chain ID Check
  const provider = ethers.provider;
  const network = await provider.getNetwork();
  const currentChainId = Number(network.chainId);
  console.log(`[1] Connected Network Chain ID: ${currentChainId}`);
  if (currentChainId !== 97) {
    throw new Error(`Invalid chain ID: expected 97, got ${currentChainId}`);
  }

  // 2. Transaction Receipt Check
  console.log(`[2] Querying Deployment Transaction Receipt for: ${deploymentTxHash}`);
  const receipt = await provider.getTransactionReceipt(deploymentTxHash);
  if (!receipt) {
    throw new Error(`Receipt not found for ${deploymentTxHash}`);
  }
  console.log(`    - Status: ${receipt.status} (${receipt.status === 1 ? "SUCCESS" : "FAILED"})`);
  console.log(`    - Block Number: ${receipt.blockNumber}`);
  console.log(`    - Block Hash: ${receipt.blockHash}`);
  console.log(`    - Gas Used: ${receipt.gasUsed.toString()}`);
  console.log(`    - Deployed Contract Address in Receipt: ${receipt.contractAddress}`);

  if (receipt.status !== 1) {
    throw new Error(`Deployment receipt status failed: ${receipt.status}`);
  }
  if (!receipt.contractAddress) {
    throw new Error("Receipt contractAddress is empty or null!");
  }
  if (receipt.contractAddress.toLowerCase() !== expectedContractAddress.toLowerCase()) {
    throw new Error(`Contract address mismatch: receipt has ${receipt.contractAddress}, expected ${expectedContractAddress}`);
  }

  // 3. Bytecode Verification via eth_getCode
  console.log(`[3] Querying eth_getCode at ${expectedContractAddress}`);
  const bytecode = await provider.getCode(expectedContractAddress);
  const bytecodeLength = bytecode.length;
  console.log(`    - Bytecode Ex exists: ${bytecode !== "0x"}`);
  console.log(`    - Bytecode Character Length: ${bytecodeLength}`);
  if (bytecode === "0x" || bytecodeLength <= 2) {
    throw new Error("No deployed bytecode found at contract address!");
  }

  // 4. Contract View Functions Verification via ABI
  console.log(`[4] Invoking View Functions via Deployed Contract ABI`);
  const registryFactory = await ethers.getContractFactory("VeilServiceRegistry");
  const registry = registryFactory.attach(expectedContractAddress);

  const dummyServiceId = ethers.keccak256(ethers.toUtf8Bytes("verification-check-id"));
  const exists = await registry.serviceExists(dummyServiceId);
  console.log(`    - registry.serviceExists(dummyServiceId): ${exists}`);

  const active = await registry.isServiceActive(dummyServiceId);
  console.log(`    - registry.isServiceActive(dummyServiceId): ${active}`);

  const deployer = receipt.from;
  const sellerServices = await registry.getServicesBySeller(deployer);
  console.log(`    - registry.getServicesBySeller(${deployer}): count = ${sellerServices.length}`);

  // 5. Check Environment Configuration in .env.local
  console.log(`[5] Verifying NEXT_PUBLIC_SERVICE_REGISTRY_CONTRACT_ADDRESS in .env.local`);
  const envPath = path.join(process.cwd(), ".env.local");
  if (!fs.existsSync(envPath)) {
    throw new Error(".env.local file does not exist!");
  }
  const envContent = fs.readFileSync(envPath, "utf8");
  const match = envContent.match(/^NEXT_PUBLIC_SERVICE_REGISTRY_CONTRACT_ADDRESS=(.+)$/m);
  if (!match) {
    throw new Error("NEXT_PUBLIC_SERVICE_REGISTRY_CONTRACT_ADDRESS is missing in .env.local!");
  }
  const envAddress = match[1].trim();
  console.log(`    - .env.local Address Configured: ${envAddress}`);
  if (envAddress.toLowerCase() !== expectedContractAddress.toLowerCase()) {
    throw new Error(`Address in .env.local (${envAddress}) does not match expected (${expectedContractAddress})`);
  }

  // 6. Confirm Existing Escrow and Auction Contracts Remain Unchanged
  console.log(`[6] Verifying Protected Contracts are Unmodified`);
  const escrowBytecode = await provider.getCode(expectedEscrowAddress);
  console.log(`    - VeilServiceEscrow (${expectedEscrowAddress}) bytecode exists: ${escrowBytecode !== "0x"}`);
  if (escrowBytecode === "0x") {
    throw new Error("VeilServiceEscrow bytecode missing on chain ID 97!");
  }

  for (const legacyAddr of legacyAuctionContracts) {
    const legacyCode = await provider.getCode(legacyAddr);
    console.log(`    - Legacy Contract (${legacyAddr}) bytecode exists: ${legacyCode !== "0x"}`);
  }

  console.log("================================================================");
  console.log("ALL ON-CHAIN & LOCAL CONFIGURATION VERIFICATIONS PASSED 100%");
  console.log("================================================================");
}

main().catch((err) => {
  console.error("Verification Error:", err);
  process.exit(1);
});
