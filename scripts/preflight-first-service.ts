import { ethers } from "ethers";
import * as fs from "fs";
import * as path from "path";
import {
  buildCanonicalMetadata,
  hashCanonicalMetadata,
  formatServiceRegistryId,
  CanonicalServiceMetadata,
} from "../lib/serviceRegistry";
import VeilServiceRegistryArtifact from "../lib/abi/VeilServiceRegistry.json";


function loadEnv() {
  const env: Record<string, string> = {};
  for (const file of [".env.local", ".env.testnet"]) {
    const fullPath = path.resolve(process.cwd(), file);
    if (fs.existsSync(fullPath)) {
      const content = fs.readFileSync(fullPath, "utf8");
      for (const line of content.split("\n")) {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith("#")) {
          const idx = trimmed.indexOf("=");
          if (idx !== -1) {
            const key = trimmed.slice(0, idx).trim();
            const val = trimmed.slice(idx + 1).trim();
            if (!env[key]) {
              env[key] = val;
            }
          }
        }
      }
    }
  }
  return env;
}

async function main() {
  const env = loadEnv();
  const rpcUrl = env.NEXT_PUBLIC_BNB_CHAIN_RPC || "https://data-seed-prebsc-1-s1.bnbchain.org:8545";
  const registryAddress = "0x016A23A069180587d5D8B09413e97E1e78ccD702";

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const network = await provider.getNetwork();
  const chainId = Number(network.chainId);

  console.log("=== PREFLIGHT REGISTRATION CHECK ===");
  console.log(`RPC URL: ${rpcUrl}`);
  console.log(`Chain ID: ${chainId}`);

  // Derived addresses (NEVER print private keys)
  const sellerKey = env.TEST_SELLER_PRIVATE_KEY;
  const deployerKey = env.DEPLOYER_PRIVATE_KEY;
  const buyerKey = env.TEST_BIDDER_PRIVATE_KEY;

  if (!sellerKey) throw new Error("Missing TEST_SELLER_PRIVATE_KEY");
  const sellerWallet = new ethers.Wallet(sellerKey, provider);
  const deployerWallet = deployerKey ? new ethers.Wallet(deployerKey, provider) : null;
  const buyerWallet = buyerKey ? new ethers.Wallet(buyerKey, provider) : null;

  const sellerBalance = await provider.getBalance(sellerWallet.address);
  console.log(`Configured Seller Wallet: ${sellerWallet.address}`);
  console.log(`Seller Balance: ${ethers.formatEther(sellerBalance)} tBNB`);

  if (deployerWallet) {
    const depBal = await provider.getBalance(deployerWallet.address);
    console.log(`Deployer Wallet: ${deployerWallet.address}`);
    console.log(`Deployer Balance: ${ethers.formatEther(depBal)} tBNB`);
  }

  // Registry Contract
  const registry = new ethers.Contract(registryAddress, VeilServiceRegistryArtifact.abi, sellerWallet);

  // Proposed 1st Service Listing Metadata
  // We use the canonical seller service representing the core VEILIO AI Service offering:
  // "Autonomous Smart Contract Security Audit & Formal Verification"
  const serviceIdStr = "srv-veilio-audit-001";
  const serviceIdBytes32 = formatServiceRegistryId(serviceIdStr);

  const metadata: CanonicalServiceMetadata = buildCanonicalMetadata({
    id: serviceIdStr,
    seller: sellerWallet.address,
    sellerType: "agent",
    sellerName: "VEILIO Sentinel AI",
    title: "Autonomous Smart Contract Security Audit & Verification",
    description: "End-to-end vulnerability scanning, reentrancy analysis, access control audit, and formal invariant validation for Solidity smart contracts on BNB Chain.",
    category: "Smart Contract Audit",
    price: "0.05",
    currency: "BNB",
    deliveryTime: "24 Hours",
    sampleDeliverables: [
      "Executive Vulnerability & Remediation Report (PDF/MD)",
      "Automated Invariant & Fuzzing Test Suite (Hardhat/Foundry)",
      "Verified Deployment Preflight Checklist"
    ],
    createdAt: 1791699900000 // Deterministic fixed timestamp for reproducible hash
  });

  const metadataHash = hashCanonicalMetadata(metadata);
  const metadataURI = `ipfs://bafkreiaveilioaudit001sentinelmetadata`;

  console.log("\n--- Proposed Canonical Listing Metadata ---");
  console.log(`Service ID (string): ${serviceIdStr}`);
  console.log(`Service ID (bytes32): ${serviceIdBytes32}`);
  console.log(`Seller: ${metadata.seller}`);
  console.log(`Seller Name: ${metadata.sellerName} (${metadata.sellerType})`);
  console.log(`Title: ${metadata.title}`);
  console.log(`Category: ${metadata.category}`);
  console.log(`Price: ${metadata.price} ${metadata.currency}`);
  console.log(`Delivery Time: ${metadata.deliveryTime}`);
  console.log(`Metadata Hash (SHA-256): ${metadataHash}`);
  console.log(`Metadata URI: ${metadataURI}`);

  // Check if service already exists
  const alreadyExists = await registry.serviceExists(serviceIdBytes32);
  console.log(`\nserviceExists(${serviceIdBytes32}): ${alreadyExists}`);
  if (alreadyExists) {
    throw new Error(`Service ${serviceIdStr} already registered!`);
  }

  // Simulate registerService call
  console.log("\n--- Simulating registerService on BSC Testnet ---");
  try {
    const simResult = await registry.registerService.staticCall(
      serviceIdBytes32,
      metadataHash,
      metadataURI
    );
    console.log("Static call (simulation) succeeded without reversion!");
  } catch (simErr: any) {
    console.error("Static call failed:", simErr);
    throw simErr;
  }

  // Estimate gas
  const gasEstimate = await registry.registerService.estimateGas(
    serviceIdBytes32,
    metadataHash,
    metadataURI
  );
  const feeData = await provider.getFeeData();
  const gasPrice = feeData.gasPrice || ethers.parseUnits("3", "gwei");
  const estimatedCostWei = gasEstimate * gasPrice;

  console.log(`Gas Estimate: ${gasEstimate.toString()} units`);
  console.log(`Gas Price: ${ethers.formatUnits(gasPrice, "gwei")} Gwei`);
  console.log(`Estimated Tx Cost: ${ethers.formatEther(estimatedCostWei)} tBNB`);

  console.log("\n=== PREFLIGHT & SIMULATION COMPLETED SUCCESSFULLY ===");
}

main().catch((err) => {
  console.error("Preflight failure:", err);
  process.exit(1);
});
