const hre = require("hardhat");
const { ethers } = hre;

async function main() {
  console.log("==================================================");
  console.log("VEILIO Services Escrow: On-Chain Smoke Test");
  console.log("==================================================");

  const network = await ethers.provider.getNetwork();
  console.log(`Connected Network Chain ID: ${network.chainId} (Expected: 97)`);
  if (Number(network.chainId) !== 97) {
    throw new Error(`Invalid network: expected 97, got ${network.chainId}`);
  }

  const contractAddress = process.env.NEXT_PUBLIC_SERVICE_ESCROW_CONTRACT_ADDRESS;
  console.log(`Target Contract Address: ${contractAddress}`);
  if (!contractAddress || !ethers.isAddress(contractAddress)) {
    throw new Error("Invalid or missing NEXT_PUBLIC_SERVICE_ESCROW_CONTRACT_ADDRESS");
  }

  // 1. Read on-chain state
  const factory = await ethers.getContractFactory("VeilServiceEscrow");
  const contract = factory.attach(contractAddress);

  const [owner, reviewer, feeRecipient, feeBps, maxFeeBps] = await Promise.all([
    contract.owner(),
    contract.reviewer(),
    contract.feeRecipient(),
    contract.platformFeeBasisPoints(),
    contract.MAX_FEE_BPS(),
  ]);

  console.log("\n[ON-CHAIN CONTRACT STATE VERIFIED]:");
  console.log(`- Owner:                 ${owner}`);
  console.log(`- Reviewer:              ${reviewer}`);
  console.log(`- Fee Recipient:         ${feeRecipient}`);
  console.log(`- Platform Fee BPS:      ${feeBps} (${Number(feeBps) / 100}%)`);
  console.log(`- Max Fee BPS:           ${maxFeeBps} (${Number(maxFeeBps) / 100}%)`);

  if (Number(feeBps) !== 500) {
    throw new Error(`Expected platformFeeBasisPoints to be 500, but got ${feeBps}`);
  }
  if (Number(maxFeeBps) !== 500) {
    throw new Error(`Expected MAX_FEE_BPS to be 500, but got ${maxFeeBps}`);
  }

  // 2. Perform a live small-value escrow workflow smoke test
  const [deployer] = await ethers.getSigners();
  const balance = await ethers.provider.getBalance(deployer.address);
  console.log(`\nTester Account: ${deployer.address}`);
  console.log(`Tester Balance: ${ethers.formatEther(balance)} tBNB`);

  // We can use a test order ID
  const testOrderId = ethers.id(`smoke-test-${Date.now()}`);
  const testSeller = reviewer; // Use distinct reviewer address as test seller
  const depositAmount = ethers.parseEther("0.0001"); // Minimal 0.0001 tBNB
  const deadline = Math.floor(Date.now() / 1000) + 86400; // 24 hours

  console.log("\nExecuting live on-chain deposit (0.0001 tBNB)...");
  const depositTx = await contract.connect(deployer).deposit(testOrderId, testSeller, deadline, {
    value: depositAmount,
  });
  console.log(`Deposit Tx Hash: ${depositTx.hash}`);
  const depositReceipt = await depositTx.wait();
  console.log(`Deposit confirmed in block ${depositReceipt.blockNumber} (Status: ${depositReceipt.status})`);

  // Verify order on-chain
  const order = await contract.getOrder(testOrderId);
  console.log(`Order on-chain status: ${order.status} (1 = Funded)`);
  console.log(`Order on-chain amount: ${ethers.formatEther(order.amount)} tBNB`);

  // Approve and release funds to seller and platform fee
  console.log("\nExecuting live on-chain fund release...");
  const releaseTx = await contract.connect(deployer).releaseFunds(testOrderId);
  console.log(`Release Tx Hash: ${releaseTx.hash}`);
  const releaseReceipt = await releaseTx.wait();
  console.log(`Release confirmed in block ${releaseReceipt.blockNumber} (Status: ${releaseReceipt.status})`);

  const settledOrder = await contract.getOrder(testOrderId);
  console.log(`Settled order on-chain status: ${settledOrder.status} (2 = Released)`);
  console.log(`Settled order on-chain amount: ${ethers.formatEther(settledOrder.amount)} tBNB (0 = settled)`);

  console.log("\n==================================================");
  console.log("ALL ON-CHAIN READ & WRITE SMOKE TESTS PASSED!");
  console.log("==================================================");
}

main().catch((err) => {
  console.error("\n[SMOKE TEST FAILED]:", err);
  process.exitCode = 1;
});

export {};
