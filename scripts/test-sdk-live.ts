import { createPublicClient, http } from "viem";
import { bscTestnet } from "viem/chains";
import {
  createVeilioServicesClient,
  VEILIO_CONTRACT_ADDRESS,
} from "../lib/agent-sdk/index";

async function main() {
  const contractAddress = process.env.NEXT_PUBLIC_SERVICE_ESCROW_CONTRACT_ADDRESS as `0x${string}`;
  console.log("Testing SDK with deployed contract address:", contractAddress);

  const publicClient = createPublicClient({
    chain: bscTestnet,
    transport: http(process.env.NEXT_PUBLIC_BNB_CHAIN_RPC || "https://data-seed-prebsc-1-s1.bnbchain.org:8545"),
  });

  const servicesClient = createVeilioServicesClient({
    publicClient,
    contractAddress,
  });

  console.log("Services client initialized with address:", servicesClient.address);
  console.log("Target chain ID:", servicesClient.chainId);

  if (servicesClient.address.toLowerCase() === VEILIO_CONTRACT_ADDRESS.toLowerCase()) {
    throw new Error("Services client should not match auction contract address!");
  }

  const feeConfig = await servicesClient.getFeeConfig();
  console.log("Live SDK getFeeConfig result:", feeConfig);

  const reviewer = await servicesClient.getReviewer();
  console.log("Live SDK getReviewer result:", reviewer);

  console.log("Live SDK read-only checks against deployed contract succeeded!");
}

main().catch((err) => {
  console.error("SDK test failed:", err);
  process.exitCode = 1;
});
