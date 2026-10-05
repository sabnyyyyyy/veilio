import { ethers } from "hardhat";

async function main() {
  const reviewer = process.env.REVIEWER_ADDRESS;
  const feeRecipient = process.env.FEE_RECIPIENT_ADDRESS;
  if (!reviewer || !feeRecipient) throw new Error("Set REVIEWER_ADDRESS and FEE_RECIPIENT_ADDRESS before deployment.");

  const factory = await ethers.getContractFactory("VeilNFTV4");
  const contract = await factory.deploy(reviewer, feeRecipient);
  await contract.waitForDeployment();
  console.log(`VeilNFTV4 deployed at ${await contract.getAddress()}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
