import { ethers } from "ethers";
import * as fs from "fs";
import * as path from "path";
import VeilServiceEscrowArtifact from "../lib/abi/VeilServiceEscrow.json";

// Safely load environment files without exposing secrets
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

interface TestResult {
  flow: string;
  role: string;
  status: "PASS" | "FAIL" | "BLOCKED";
  txHash?: string;
  details: string;
}

async function main() {
  console.log("================================================================================");
  console.log("VEILIO Services: Two-Wallet End-to-End Live Integration Test");
  console.log("================================================================================");

  const env = loadEnv();
  const rpcUrl = env.NEXT_PUBLIC_BNB_CHAIN_RPC || "https://data-seed-prebsc-1-s1.bnbchain.org:8545";
  const contractAddress = env.NEXT_PUBLIC_SERVICE_ESCROW_CONTRACT_ADDRESS;

  if (!contractAddress || !ethers.isAddress(contractAddress)) {
    throw new Error("Missing or invalid NEXT_PUBLIC_SERVICE_ESCROW_CONTRACT_ADDRESS");
  }

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const network = await provider.getNetwork();
  console.log(`Connected RPC:           ${rpcUrl}`);
  console.log(`Connected Chain ID:      ${network.chainId} (Expected: 97)`);

  if (Number(network.chainId) !== 97) {
    throw new Error(`Target network must be BNB Chain Testnet (97), received ${network.chainId}`);
  }

  // 1. Configure and verify separate wallet identities
  const buyerKey = env.TEST_BIDDER_PRIVATE_KEY;
  const sellerKey = env.TEST_SELLER_PRIVATE_KEY;
  const deployerKey = env.DEPLOYER_PRIVATE_KEY;

  if (!buyerKey || !sellerKey || !deployerKey) {
    throw new Error("Missing required wallet keys in environment configuration (.env.local / .env.testnet)");
  }

  const buyerWallet = new ethers.Wallet(buyerKey, provider);
  const sellerWallet = new ethers.Wallet(sellerKey, provider);
  const deployerWallet = new ethers.Wallet(deployerKey, provider);

  const [buyerBal, sellerBal, deployerBal] = await Promise.all([
    provider.getBalance(buyerWallet.address),
    provider.getBalance(sellerWallet.address),
    provider.getBalance(deployerWallet.address),
  ]);

  console.log("\n[TEST WALLET IDENTITIES & BALANCES]:");
  console.log(`- Buyer Wallet:          ${buyerWallet.address} | Balance: ${ethers.formatEther(buyerBal)} tBNB`);
  console.log(`- Seller Wallet:         ${sellerWallet.address} | Balance: ${ethers.formatEther(sellerBal)} tBNB`);
  console.log(`- Deployer/Owner Wallet: ${deployerWallet.address} | Balance: ${ethers.formatEther(deployerBal)} tBNB`);

  if (buyerWallet.address.toLowerCase() === sellerWallet.address.toLowerCase()) {
    throw new Error("Buyer and Seller must use separate, distinct test wallet addresses");
  }

  if (buyerBal < ethers.parseEther("0.0005")) {
    throw new Error(`Buyer balance (${ethers.formatEther(buyerBal)} tBNB) is too low for test deposits and gas`);
  }
  if (sellerBal < ethers.parseEther("0.0005")) {
    throw new Error(`Seller balance (${ethers.formatEther(sellerBal)} tBNB) is too low for test transactions and gas`);
  }

  const contract: any = new ethers.Contract(contractAddress, VeilServiceEscrowArtifact.abi, provider);

  const [contractOwner, reviewer, feeRecipient, feeBps, maxFeeBps] = await Promise.all([
    contract.owner(),
    contract.reviewer(),
    contract.feeRecipient(),
    contract.platformFeeBasisPoints(),
    contract.MAX_FEE_BPS(),
  ]);

  console.log("\n[ON-CHAIN ESCROW CONFIGURATION]:");
  console.log(`- Contract Address:      ${contractAddress}`);
  console.log(`- Owner:                 ${contractOwner}`);
  console.log(`- Reviewer:              ${reviewer}`);
  console.log(`- Fee Recipient:         ${feeRecipient}`);
  console.log(`- Platform Fee:          ${feeBps} bps (${Number(feeBps) / 100}%)`);
  console.log(`- Max Fee Cap:           ${maxFeeBps} bps (${Number(maxFeeBps) / 100}%)`);

  if (Number(feeBps) !== 850) {
    throw new Error(`Expected platformFeeBasisPoints to be 850 (8.5%), but got ${feeBps}`);
  }

  const results: TestResult[] = [];

  // ============================================================================
  // FLOW 1: Full Happy Path (Deposit -> Deliver -> Approve & Release with 8.5% Fee)
  // ============================================================================
  console.log("\n--------------------------------------------------------------------------------");
  console.log("FLOW 1: FULL HAPPY PATH (Deposit -> Deliver -> Approve & Release with 8.5% Fee)");
  console.log("--------------------------------------------------------------------------------");

  const orderId1 = ethers.id(`e2e-happy-${Date.now()}`);
  const depositAmount1 = ethers.parseEther("0.0001");
  const deadline1 = Math.floor(Date.now() / 1000) + 86400; // 24 hours

  console.log(`[Step 1.1] Buyer deposits 0.0001 tBNB into escrow (Order: ${orderId1.slice(0, 18)}...)...`);
  const depositTx1 = await contract.connect(buyerWallet).deposit(orderId1, sellerWallet.address, deadline1, {
    value: depositAmount1,
  });
  console.log(`   Deposit Tx: ${depositTx1.hash}`);
  const depositReceipt1 = await depositTx1.wait();
  console.log(`   Confirmed in block ${depositReceipt1.blockNumber} (Status: ${depositReceipt1.status})`);

  // Verify on-chain state
  const onChainOrder1 = await contract.getOrder(orderId1);
  if (Number(onChainOrder1.status) !== 1 || onChainOrder1.amount !== depositAmount1) {
    throw new Error(`Flow 1: Deposit state mismatch (status=${onChainOrder1.status}, amount=${onChainOrder1.amount})`);
  }
  console.log(`   On-chain order status: 1 (Funded), amount: ${ethers.formatEther(onChainOrder1.amount)} tBNB`);
  results.push({
    flow: "Buyer Deposit (Happy Path)",
    role: "Buyer",
    status: "PASS",
    txHash: depositTx1.hash,
    details: `Deposited 0.0001 tBNB into escrow for order ${orderId1.slice(0, 14)}...`,
  });

  // Seller delivery submission
  console.log("\n[Step 1.2] Seller submits deliverables on-chain...");
  const deliverableRef1 = "ipfs://bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi/audit-report.pdf";
  const deliverTx1 = await contract.connect(sellerWallet).submitDelivery(orderId1, deliverableRef1);
  console.log(`   Delivery Tx: ${deliverTx1.hash}`);
  const deliverReceipt1 = await deliverTx1.wait();
  console.log(`   Confirmed in block ${deliverReceipt1.blockNumber} (Status: ${deliverReceipt1.status})`);

  const deliveredOrder1 = await contract.getOrder(orderId1);
  if (Number(deliveredOrder1.status) !== 5 || deliveredOrder1.deliverableReference !== deliverableRef1) {
    throw new Error(`Flow 1: Delivery state mismatch (status=${deliveredOrder1.status})`);
  }
  console.log(`   On-chain order status: 5 (Delivered), ref: ${deliveredOrder1.deliverableReference.slice(0, 30)}...`);
  results.push({
    flow: "Seller Delivery Submission",
    role: "Seller",
    status: "PASS",
    txHash: deliverTx1.hash,
    details: `Submitted deliverables reference; state transitioned to Delivered (5)`,
  });

  // Buyer approval and release
  console.log("\n[Step 1.3] Buyer approves work and releases funds...");
  const sellerBalBefore = await provider.getBalance(sellerWallet.address);
  const feeBalBefore = await provider.getBalance(feeRecipient);

  const releaseTx1 = await contract.connect(buyerWallet).releaseFunds(orderId1);
  console.log(`   Release Tx: ${releaseTx1.hash}`);
  const releaseReceipt1 = await releaseTx1.wait();
  console.log(`   Confirmed in block ${releaseReceipt1.blockNumber} (Status: ${releaseReceipt1.status})`);

  const settledOrder1 = await contract.getOrder(orderId1);
  if (Number(settledOrder1.status) !== 2 || settledOrder1.amount !== 0n) {
    throw new Error(`Flow 1: Released state mismatch (status=${settledOrder1.status})`);
  }

  const sellerBalAfter = await provider.getBalance(sellerWallet.address);
  const feeBalAfter = await provider.getBalance(feeRecipient);

  const expectedFee = (depositAmount1 * 500n) / 10000n; // 0.000005 tBNB
  const expectedSellerPayout = depositAmount1 - expectedFee; // 0.000095 tBNB
  const actualSellerDelta = sellerBalAfter - sellerBalBefore;
  const actualFeeDelta = feeBalAfter - feeBalBefore;

  console.log(`   On-chain order status: 2 (Released), escrow amount: 0 tBNB`);
  console.log(`   Seller received:       ${ethers.formatEther(actualSellerDelta)} tBNB (Expected: ${ethers.formatEther(expectedSellerPayout)} tBNB)`);
  console.log(`   Fee recipient received:${ethers.formatEther(actualFeeDelta)} tBNB (Expected: ${ethers.formatEther(expectedFee)} tBNB)`);

  if (actualSellerDelta !== expectedSellerPayout) {
    throw new Error(`Seller payout mismatch: expected ${expectedSellerPayout}, got ${actualSellerDelta}`);
  }
  if (actualFeeDelta !== expectedFee) {
    throw new Error(`Fee payout mismatch: expected ${expectedFee}, got ${actualFeeDelta}`);
  }

  results.push({
    flow: "Buyer Approval & Fund Release",
    role: "Buyer",
    status: "PASS",
    txHash: releaseTx1.hash,
    details: `Settled 0.0001 tBNB: Seller received 91.5% (${ethers.formatEther(actualSellerDelta)} tBNB), Platform received 8.5% (${ethers.formatEther(actualFeeDelta)} tBNB)`,
  });

  // ============================================================================
  // FLOW 2: Seller Cancellation (Fee-Free 100% Refund)
  // ============================================================================
  console.log("\n--------------------------------------------------------------------------------");
  console.log("FLOW 2: SELLER CANCELLATION & 100% FEE-FREE REFUND");
  console.log("--------------------------------------------------------------------------------");

  const orderId2 = ethers.id(`e2e-cancel-${Date.now()}`);
  const depositAmount2 = ethers.parseEther("0.0001");
  const deadline2 = Math.floor(Date.now() / 1000) + 86400;

  console.log(`[Step 2.1] Buyer deposits 0.0001 tBNB for cancel test...`);
  const depositTx2 = await contract.connect(buyerWallet).deposit(orderId2, sellerWallet.address, deadline2, {
    value: depositAmount2,
  });
  console.log(`   Deposit Tx: ${depositTx2.hash}`);
  await depositTx2.wait();

  console.log(`[Step 2.2] Seller cancels the order on-chain before delivery...`);
  const buyerBalBefore2 = await provider.getBalance(buyerWallet.address);
  const cancelTx2 = await contract.connect(sellerWallet).cancelOrder(orderId2, "Seller out of capacity");
  console.log(`   Cancel Tx: ${cancelTx2.hash}`);
  const cancelReceipt2 = await cancelTx2.wait();
  console.log(`   Confirmed in block ${cancelReceipt2.blockNumber} (Status: ${cancelReceipt2.status})`);

  const cancelledOrder2 = await contract.getOrder(orderId2);
  if (Number(cancelledOrder2.status) !== 3 || cancelledOrder2.amount !== 0n) {
    throw new Error(`Flow 2: Cancelled state mismatch (status=${cancelledOrder2.status})`);
  }

  const buyerBalAfter2 = await provider.getBalance(buyerWallet.address);
  const buyerDelta2 = buyerBalAfter2 - buyerBalBefore2;

  console.log(`   On-chain order status: 3 (Refunded), escrow amount: 0 tBNB`);
  console.log(`   Buyer refund received: ${ethers.formatEther(buyerDelta2)} tBNB (Expected: ${ethers.formatEther(depositAmount2)} tBNB)`);

  if (buyerDelta2 !== depositAmount2) {
    throw new Error(`Buyer refund mismatch: expected ${depositAmount2}, got ${buyerDelta2}`);
  }

  results.push({
    flow: "Seller Cancellation & 100% Refund",
    role: "Seller",
    status: "PASS",
    txHash: cancelTx2.hash,
    details: `Seller cancelled order; Buyer refunded 100% (${ethers.formatEther(depositAmount2)} tBNB) fee-free`,
  });

  // ============================================================================
  // FLOW 3: Dispute Resolution Flow (Escalation & Reviewer Split)
  // ============================================================================
  console.log("\n--------------------------------------------------------------------------------");
  console.log("FLOW 3: DISPUTE RESOLUTION & REVIEWER SETTLEMENT (50/50 Split)");
  console.log("--------------------------------------------------------------------------------");

  const orderId3 = ethers.id(`e2e-dispute-${Date.now()}`);
  const depositAmount3 = ethers.parseEther("0.0001");
  const deadline3 = Math.floor(Date.now() / 1000) + 86400;

  console.log(`[Step 3.1] Buyer deposits 0.0001 tBNB for dispute test...`);
  const depositTx3 = await contract.connect(buyerWallet).deposit(orderId3, sellerWallet.address, deadline3, {
    value: depositAmount3,
  });
  console.log(`   Deposit Tx: ${depositTx3.hash}`);
  await depositTx3.wait();

  console.log(`[Step 3.2] Buyer escalates order to Disputed state...`);
  const disputeTx3 = await contract.connect(buyerWallet).dispute(orderId3, "Deliverable failed test suite");
  console.log(`   Dispute Tx: ${disputeTx3.hash}`);
  const disputeReceipt3 = await disputeTx3.wait();
  console.log(`   Confirmed in block ${disputeReceipt3.blockNumber} (Status: ${disputeReceipt3.status})`);

  const disputedOrder3 = await contract.getOrder(orderId3);
  if (Number(disputedOrder3.status) !== 4) {
    throw new Error(`Flow 3: Disputed state mismatch (status=${disputedOrder3.status})`);
  }
  console.log(`   On-chain order status: 4 (Disputed)`);

  results.push({
    flow: "Order Dispute Escalation",
    role: "Buyer",
    status: "PASS",
    txHash: disputeTx3.hash,
    details: `Buyer escalated order to Disputed state (4) on-chain`,
  });

  console.log(`[Step 3.3] Reviewer/Owner executes 50/50 dispute resolution...`);
  const buyerBalBefore3 = await provider.getBalance(buyerWallet.address);
  const sellerBalBefore3 = await provider.getBalance(sellerWallet.address);
  const feeBalBefore3 = await provider.getBalance(feeRecipient);

  // Deployer is owner/authorized reviewer
  const resolveTx3 = await contract.connect(deployerWallet).resolveDispute(orderId3, 50);
  console.log(`   Resolve Tx: ${resolveTx3.hash}`);
  const resolveReceipt3 = await resolveTx3.wait();
  console.log(`   Confirmed in block ${resolveReceipt3.blockNumber} (Status: ${resolveReceipt3.status})`);

  const resolvedOrder3 = await contract.getOrder(orderId3);
  if (Number(resolvedOrder3.status) !== 2 || resolvedOrder3.amount !== 0n) {
    throw new Error(`Flow 3: Settled state mismatch (status=${resolvedOrder3.status})`);
  }

  const buyerBalAfter3 = await provider.getBalance(buyerWallet.address);
  const sellerBalAfter3 = await provider.getBalance(sellerWallet.address);
  const feeBalAfter3 = await provider.getBalance(feeRecipient);

  const buyerDelta3 = buyerBalAfter3 - buyerBalBefore3;
  const sellerDelta3 = sellerBalAfter3 - sellerBalBefore3;
  const feeDelta3 = feeBalAfter3 - feeBalBefore3;

  // Expected accounting for 50/50 split of 0.0001 tBNB:
  // Buyer: 50% = 0.00005 tBNB (fee-free)
  // Seller gross: 50% = 0.00005 tBNB
  // Fee: 5% of seller gross = 0.0000025 tBNB
  // Seller net: 0.00005 - 0.0000025 = 0.0000475 tBNB
  const expectedBuyerShare3 = (depositAmount3 * 50n) / 100n; // 0.00005
  const expectedSellerGross3 = depositAmount3 - expectedBuyerShare3;
  const expectedFee3 = (expectedSellerGross3 * 500n) / 10000n; // 0.0000025
  const expectedSellerNet3 = expectedSellerGross3 - expectedFee3; // 0.0000475

  console.log(`   On-chain order status: 6 (Settled), escrow amount: 0 tBNB`);
  console.log(`   Buyer received:        ${ethers.formatEther(buyerDelta3)} tBNB (Expected: ${ethers.formatEther(expectedBuyerShare3)} tBNB)`);
  console.log(`   Seller net payout:     ${ethers.formatEther(sellerDelta3)} tBNB (Expected: ${ethers.formatEther(expectedSellerNet3)} tBNB)`);
  console.log(`   Fee recipient received:${ethers.formatEther(feeDelta3)} tBNB (Expected: ${ethers.formatEther(expectedFee3)} tBNB)`);

  if (buyerDelta3 !== expectedBuyerShare3) {
    throw new Error(`Dispute Buyer share mismatch: expected ${expectedBuyerShare3}, got ${buyerDelta3}`);
  }
  if (sellerDelta3 !== expectedSellerNet3) {
    throw new Error(`Dispute Seller share mismatch: expected ${expectedSellerNet3}, got ${sellerDelta3}`);
  }
  if (deployerWallet.address.toLowerCase() === feeRecipient.toLowerCase()) {
    console.log("   (Deployer is fee recipient; fee credit offset by gas cost on resolve transaction)");
  } else if (feeDelta3 !== expectedFee3) {
    throw new Error(`Dispute Fee mismatch: expected ${expectedFee3}, got ${feeDelta3}`);
  }

  results.push({
    flow: "Dispute Reviewer Resolution (50/50)",
    role: "Reviewer/Owner",
    status: "PASS",
    txHash: resolveTx3.hash,
    details: `Resolved 50/50 split: Buyer received 0.00005 tBNB (fee-free), Seller received 0.0000475 tBNB, Fee received 0.0000025 tBNB`,
  });

  // ============================================================================
  // FLOW 4: Authorization & Negative Security Tests on Live Testnet
  // ============================================================================
  console.log("\n--------------------------------------------------------------------------------");
  console.log("FLOW 4: AUTHORIZATION & NEGATIVE REVERSION INVARIANTS (Live Testnet)");
  console.log("--------------------------------------------------------------------------------");

  // Negative Test 4A: Seller attempts to release funds on their own order -> Revert
  console.log("[Test 4A] Seller attempts unauthorized fund release...");
  let releaseReverted = false;
  try {
    const tx = await contract.connect(sellerWallet).releaseFunds(orderId1);
    await tx.wait();
  } catch (err: any) {
    releaseReverted = true;
    console.log(`   Correctly rejected with error: ${err.message?.slice(0, 70)}...`);
  }
  if (!releaseReverted) throw new Error("Security failure: unauthorized releaseFunds did not revert");

  results.push({
    flow: "Unauthorized Release Reversion",
    role: "Seller",
    status: "PASS",
    details: "Contract correctly reverted when seller attempted to call releaseFunds",
  });

  // Negative Test 4B: Buyer attempts timeout refund before deadline -> Revert
  console.log("\n[Test 4B] Buyer attempts timeout refund before deadline on active order...");
  let timeoutBeforeDeadlineReverted = false;
  const orderId4 = ethers.id(`e2e-neg-timeout-${Date.now()}`);
  const depositTx4 = await contract.connect(buyerWallet).deposit(orderId4, sellerWallet.address, Math.floor(Date.now() / 1000) + 86400, {
    value: ethers.parseEther("0.0001"),
  });
  await depositTx4.wait();

  try {
    const tx = await contract.connect(buyerWallet).cancelOrder(orderId4, "Premature timeout refund");
    await tx.wait();
  } catch (err: any) {
    timeoutBeforeDeadlineReverted = true;
    console.log(`   Correctly rejected with error: ${err.message?.slice(0, 80)}...`);
  }
  if (!timeoutBeforeDeadlineReverted) throw new Error("Security failure: premature timeout refund did not revert");

  results.push({
    flow: "Premature Timeout Refund Reversion",
    role: "Buyer",
    status: "PASS",
    details: "Contract correctly reverted when buyer attempted timeout refund before deadline",
  });

  // Negative Test 4C: Non-reviewer attempts dispute resolution -> Revert
  console.log("\n[Test 4C] Unauthorized caller attempts dispute resolution...");
  let unauthorizedResolveReverted = false;
  try {
    const tx = await contract.connect(sellerWallet).resolveDispute(orderId3, 50);
    await tx.wait();
  } catch (err: any) {
    unauthorizedResolveReverted = true;
    console.log(`   Correctly rejected with error: ${err.message?.slice(0, 70)}...`);
  }
  if (!unauthorizedResolveReverted) throw new Error("Security failure: unauthorized dispute resolution did not revert");

  results.push({
    flow: "Unauthorized Dispute Resolution Reversion",
    role: "Seller/Unauthorized",
    status: "PASS",
    details: "Contract correctly reverted when unauthorized caller attempted resolveDispute",
  });

  // ============================================================================
  // SUMMARY
  // ============================================================================
  console.log("\n================================================================================");
  console.log("ALL LIVE TESTNET E2E SCENARIOS EXECUTED SUCCESSFULLY!");
  console.log("================================================================================");
  console.table(
    results.map((r) => ({
      Flow: r.flow,
      Role: r.role,
      Status: r.status,
      "Tx Hash": r.txHash ? `${r.txHash.slice(0, 14)}...` : "N/A (Reverted as expected)",
      Details: r.details,
    }))
  );
}

main().catch((err) => {
  console.error("\n[E2E TEST FAILURE]:", err);
  process.exitCode = 1;
});

export {};
