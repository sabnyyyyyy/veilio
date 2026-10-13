export {};
// eslint-disable-next-line @typescript-eslint/no-var-requires
const hre = require("hardhat");
const { ethers, network } = hre;

async function main() {
  console.log("Verifying Base Sepolia Services deployment...");
  const registryAddr = "0x74a6Bf3ed462898F7b3E13e7F4d1c444570bCb88";
  const escrowAddr = "0x13C16c508780639E86cA9d4322Ba9739C15e78Af";

  const registryCode = await ethers.provider.getCode(registryAddr);
  const escrowCode = await ethers.provider.getCode(escrowAddr);

  if (registryCode === "0x" || registryCode.length <= 2) {
    throw new Error(`VeilServiceRegistry not found at ${registryAddr}`);
  }
  if (escrowCode === "0x" || escrowCode.length <= 2) {
    throw new Error(`VeilServiceEscrow not found at ${escrowAddr}`);
  }

  console.log(`VeilServiceRegistry bytecode verified! (${registryCode.length / 2 - 1} bytes)`);
  console.log(`VeilServiceEscrow bytecode verified! (${escrowCode.length / 2 - 1} bytes)`);

  const escrow = await ethers.getContractAt("VeilServiceEscrow", escrowAddr);
  const owner = await escrow.owner();
  const reviewer = await escrow.reviewer();
  const feeRecipient = await escrow.feeRecipient();
  const feeBps = await escrow.platformFeeBasisPoints();

  console.log("VeilServiceEscrow on Base Sepolia state:");
  console.log("- Owner:        ", owner);
  console.log("- Reviewer:     ", reviewer);
  console.log("- Fee Recipient:", feeRecipient);
  console.log("- Fee BPS:      ", feeBps.toString());

  console.log("ALL BASE SEPOLIA SERVICES CONTRACTS VERIFIED ON-CHAIN!");
}

main().catch(err => {
  console.error("Verification failed:", err);
  process.exit(1);
});
