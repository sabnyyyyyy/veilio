import { ethers, network } from "hardhat";

async function main() {
  const expectedChainIdByNetwork: Record<string, bigint> = {
    hardhat: 31337n,
    bnbChain: 97n,
    baseSepolia: 84532n,
  };
  const expectedChainId = expectedChainIdByNetwork[network.name];
  if (expectedChainId === undefined) {
    throw new Error(`Refusing deployment on unapproved network target: ${network.name}`);
  }
  const actualChainId = (await ethers.provider.getNetwork()).chainId;
  if (actualChainId !== expectedChainId) {
    throw new Error(
      `Refusing deployment: ${network.name} is configured for chain ${expectedChainId}, RPC reports ${actualChainId}.`
    );
  }

  const reviewer = process.env.REVIEWER_ADDRESS;
  const feeRecipient = process.env.FEE_RECIPIENT_ADDRESS;
  if (!reviewer || !feeRecipient) throw new Error("Set REVIEWER_ADDRESS and FEE_RECIPIENT_ADDRESS before deployment.");
  if (!ethers.isAddress(reviewer) || !ethers.isAddress(feeRecipient)) {
    throw new Error("REVIEWER_ADDRESS and FEE_RECIPIENT_ADDRESS must be valid EVM addresses.");
  }

  console.log(`Deploying VeilNFTV4 to ${network.name} (chain ${actualChainId}).`);
  const factory = await ethers.getContractFactory("VeilNFTV4");
  const contract = await factory.deploy(reviewer, feeRecipient);
  await contract.waitForDeployment();
  console.log(`VeilNFTV4 deployed at ${await contract.getAddress()}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
