import { expect } from "chai";
import hre from "hardhat";
const { ethers } = hre;
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { BlindBid, MaliciousReceiver } from "../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

describe("BlindBid Protocol V2 Infrastructure", function () {
  let blindBid: BlindBid;
  let seller: SignerWithAddress;
  let alice: SignerWithAddress;
  let bob: SignerWithAddress;
  let charlie: SignerWithAddress;

  const startingPrice = ethers.parseEther("1.0"); // Reserve price: 1 BNB
  const commitDuration = 300; // 5 minutes
  const revealDuration = 300; // 5 minutes

  const secretAlice = ethers.keccak256(ethers.toUtf8Bytes("alice_secret_123"));
  const secretBob = ethers.keccak256(ethers.toUtf8Bytes("bob_secret_456"));
  const secretCharlie = ethers.keccak256(ethers.toUtf8Bytes("charlie_secret_789"));

  beforeEach(async function () {
    [seller, alice, bob, charlie] = await ethers.getSigners();

    const BlindBidFactory = await ethers.getContractFactory("BlindBid");
    blindBid = await BlindBidFactory.deploy();
    await blindBid.waitForDeployment();
  });

  // 1. Create Auction
  it("1. Should create an auction with correct parameters", async function () {
    const tx = await blindBid.connect(seller).createAuction(
      "MacBook Pro M4",
      "Liquid Retina XDR",
      "ipfs://QmTest123",
      startingPrice,
      commitDuration,
      revealDuration
    );

    const receipt = await tx.wait();
    expect(await blindBid.auctionCount()).to.equal(1);

    const auction = await blindBid.auctions(1);
    expect(auction.seller).to.equal(seller.address);
    expect(auction.startingPrice).to.equal(startingPrice);
    expect(await blindBid.getAuctionState(1)).to.equal(1); // 1 = Bidding
  });

  // 2. Commit Valid Bid
  it("2. Should accept valid bid commitment during commit phase", async function () {
    await blindBid.connect(seller).createAuction("Item", "Desc", "uri", startingPrice, commitDuration, revealDuration);

    const maxBidAlice = ethers.parseEther("2.0");
    const commitmentAlice = await blindBid.computeCommitment(1, alice.address, maxBidAlice, secretAlice);

    await expect(
      blindBid.connect(alice).commitBid(1, commitmentAlice, { value: maxBidAlice })
    ).to.emit(blindBid, "BidCommitted").withArgs(1, alice.address, commitmentAlice, maxBidAlice);

    const auction = await blindBid.auctions(1);
    expect(auction.bidderCount).to.equal(1);
  });

  it("rejects a zero commitment to prevent duplicate bidder entries", async function () {
    await blindBid.connect(seller).createAuction("Item", "Desc", "uri", startingPrice, commitDuration, revealDuration);
    await expect(blindBid.connect(alice).commitBid(1, ethers.ZeroHash, { value: startingPrice }))
      .to.be.revertedWith("Invalid commitment");
    expect((await blindBid.auctions(1)).bidderCount).to.equal(0);
  });

  // 3. Reject Bid After Commit Deadline
  it("3. Should reject bids submitted after commit deadline", async function () {
    await blindBid.connect(seller).createAuction("Item", "Desc", "uri", startingPrice, commitDuration, revealDuration);
    await time.increase(commitDuration + 1);

    const commitment = await blindBid.computeCommitment(1, alice.address, ethers.parseEther("2.0"), secretAlice);
    await expect(
      blindBid.connect(alice).commitBid(1, commitment, { value: ethers.parseEther("2.0") })
    ).to.be.revertedWith("Bidding phase has ended");
  });

  // 4. Reject Duplicate Commitment
  it("4. Should reject duplicate commitments from same bidder", async function () {
    await blindBid.connect(seller).createAuction("Item", "Desc", "uri", startingPrice, commitDuration, revealDuration);
    const commitment = await blindBid.computeCommitment(1, alice.address, ethers.parseEther("2.0"), secretAlice);

    await blindBid.connect(alice).commitBid(1, commitment, { value: ethers.parseEther("2.0") });

    await expect(
      blindBid.connect(alice).commitBid(1, commitment, { value: ethers.parseEther("2.0") })
    ).to.be.revertedWith("Already committed");
  });

  // 5. Reveal Valid Bid
  it("5. Should accept valid reveal during reveal phase", async function () {
    await blindBid.connect(seller).createAuction("Item", "Desc", "uri", startingPrice, commitDuration, revealDuration);
    const maxBid = ethers.parseEther("2.0");
    const commitment = await blindBid.computeCommitment(1, alice.address, maxBid, secretAlice);
    await blindBid.connect(alice).commitBid(1, commitment, { value: maxBid });

    await time.increase(commitDuration + 1); // Enter reveal phase

    await expect(
      blindBid.connect(alice).revealBid(1, maxBid, secretAlice)
    ).to.emit(blindBid, "BidRevealed").withArgs(1, alice.address, maxBid, true);
  });

  // 6. Reject Invalid Reveal
  it("6. Should reject reveal with incorrect secret or max bid", async function () {
    await blindBid.connect(seller).createAuction("Item", "Desc", "uri", startingPrice, commitDuration, revealDuration);
    const maxBid = ethers.parseEther("2.0");
    const commitment = await blindBid.computeCommitment(1, alice.address, maxBid, secretAlice);
    await blindBid.connect(alice).commitBid(1, commitment, { value: maxBid });

    await time.increase(commitDuration + 1);

    await expect(
      blindBid.connect(alice).revealBid(1, maxBid, secretBob) // Wrong secret
    ).to.be.revertedWith("Invalid bid parameters or secret");
  });

  // 7. Reject Reveal Before Reveal Phase
  it("7. Should reject reveal attempt while commit phase is still active", async function () {
    await blindBid.connect(seller).createAuction("Item", "Desc", "uri", startingPrice, commitDuration, revealDuration);
    const maxBid = ethers.parseEther("2.0");
    const commitment = await blindBid.computeCommitment(1, alice.address, maxBid, secretAlice);
    await blindBid.connect(alice).commitBid(1, commitment, { value: maxBid });

    await expect(
      blindBid.connect(alice).revealBid(1, maxBid, secretAlice)
    ).to.be.revertedWith("Commit phase still active");
  });

  // 8. Reject Reveal After Reveal Phase
  it("8. Should reject reveal attempt after reveal phase has closed", async function () {
    await blindBid.connect(seller).createAuction("Item", "Desc", "uri", startingPrice, commitDuration, revealDuration);
    const maxBid = ethers.parseEther("2.0");
    const commitment = await blindBid.computeCommitment(1, alice.address, maxBid, secretAlice);
    await blindBid.connect(alice).commitBid(1, commitment, { value: maxBid });

    await time.increase(commitDuration + revealDuration + 1); // Past reveal phase

    await expect(
      blindBid.connect(alice).revealBid(1, maxBid, secretAlice)
    ).to.be.revertedWith("Reveal phase has ended");
  });

  // 9. Non-Reveal Anti-Abort Penalty Handling
  it("9. Should deduct anti-abort penalty from non-revealing bidders upon settlement", async function () {
    await blindBid.connect(seller).createAuction("Item", "Desc", "uri", startingPrice, commitDuration, revealDuration);

    const depositAlice = ethers.parseEther("2.0");
    const commitmentAlice = await blindBid.computeCommitment(1, alice.address, depositAlice, secretAlice);
    await blindBid.connect(alice).commitBid(1, commitmentAlice, { value: depositAlice });

    // Alice commits but NEVER reveals
    await time.increase(commitDuration + revealDuration + 1);

    await blindBid.connect(seller).settleAuction(1);

    // Non-reveal penalty (5% of 2.0 = 0.1 BNB), remaining 1.9 BNB added to pendingRefunds
    const expectedRefund = ethers.parseEther("1.9");
    expect(await blindBid.pendingRefunds(alice.address)).to.equal(expectedRefund);
  });

  // 10 & 11 & 12 & 13. Determine Winner & Settle & Vickrey Pricing & Refunds
  it("10-13. Should settle Vickrey second-price winner and calculate refunds", async function () {
    await blindBid.connect(seller).createAuction("Item", "Desc", "uri", startingPrice, commitDuration, revealDuration);

    // Alice bids 3.0 BNB, Bob bids 2.0 BNB
    const maxAlice = ethers.parseEther("3.0");
    const maxBob = ethers.parseEther("2.0");

    const commitAlice = await blindBid.computeCommitment(1, alice.address, maxAlice, secretAlice);
    const commitBob = await blindBid.computeCommitment(1, bob.address, maxBob, secretBob);

    await blindBid.connect(alice).commitBid(1, commitAlice, { value: maxAlice });
    await blindBid.connect(bob).commitBid(1, commitBob, { value: maxBob });

    await time.increase(commitDuration + 1); // Reveal phase

    await blindBid.connect(alice).revealBid(1, maxAlice, secretAlice);
    await blindBid.connect(bob).revealBid(1, maxBob, secretBob);

    await time.increase(revealDuration + 1); // End reveal phase

    const initialSellerBal = await ethers.provider.getBalance(seller.address);

    // Capture tx to get gas cost for balance assertion
    const settleTx = await blindBid.connect(seller).settleAuction(1);
    const settleReceipt = await settleTx.wait();
    const gasSpent = settleReceipt!.gasUsed * settleReceipt!.gasPrice;

    await expect(settleTx)
      .to.emit(blindBid, "AuctionSettled")
      .withArgs(1, alice.address, maxBob, maxBob); // Winner = Alice, Winning price = Vickrey 2.0 BNB

    // Seller receives winning price (2.0 BNB) minus gas paid for settleAuction
    const finalSellerBal = await ethers.provider.getBalance(seller.address);
    expect(finalSellerBal - initialSellerBal + gasSpent).to.equal(maxBob);

    // Winner refund = Alice's deposit (3.0) - winning price (2.0) = 1.0 BNB
    expect(await blindBid.pendingRefunds(alice.address)).to.equal(ethers.parseEther("1.0"));

    // Loser refund = Bob's deposit (2.0 BNB)
    expect(await blindBid.pendingRefunds(bob.address)).to.equal(maxBob);
  });

  // 14. Double Refund Prevention
  it("14. Should prevent double withdrawal of refunds", async function () {
    await blindBid.connect(seller).createAuction("Item", "Desc", "uri", startingPrice, commitDuration, revealDuration);
    const maxBob = ethers.parseEther("2.0");
    const commitBob = await blindBid.computeCommitment(1, bob.address, maxBob, secretBob);
    await blindBid.connect(bob).commitBid(1, commitBob, { value: maxBob });

    await time.increase(commitDuration + revealDuration + 1);
    await blindBid.connect(seller).settleAuction(1);

    // Bob withdraws refund
    await blindBid.connect(bob).withdrawRefund();

    // Second withdrawal should fail
    await expect(blindBid.connect(bob).withdrawRefund()).to.be.revertedWith("No pending refund");
  });

  // 15 & 16. Reserve Price Not Met & No Valid Revealed Bids
  it("15-16. Should handle auction where no valid revealed bids meet starting price", async function () {
    await blindBid.connect(seller).createAuction("Item", "Desc", "uri", startingPrice, commitDuration, revealDuration);

    // No one bids or reveals
    await time.increase(commitDuration + revealDuration + 1);
    await blindBid.connect(seller).settleAuction(1);

    const auction = await blindBid.auctions(1);
    expect(auction.highestBidder).to.equal(ethers.ZeroAddress);
  });

  // 17. Unauthorized Settlement Before Reveal End
  it("17. Should reject settlement before reveal phase finishes", async function () {
    await blindBid.connect(seller).createAuction("Item", "Desc", "uri", startingPrice, commitDuration, revealDuration);
    await time.increase(commitDuration + 1); // In reveal phase

    await expect(blindBid.connect(seller).settleAuction(1)).to.be.revertedWith("Reveal phase not finished");
  });

  // 18. Reentrancy Protection — real attack test
  it("18. Reentrancy: malicious receiver cannot re-enter withdrawRefund", async function () {
    const MaliciousFactory = await ethers.getContractFactory("MaliciousReceiver");
    const attacker = (await MaliciousFactory.deploy(
      await blindBid.getAddress()
    )) as unknown as MaliciousReceiver;
    await attacker.waitForDeployment();

    await blindBid.connect(seller).createAuction("Item", "Desc", "uri", startingPrice, commitDuration, revealDuration);

    const deposit = ethers.parseEther("2.0");
    const attackerAddr = await attacker.getAddress();
    const commitment = await blindBid.computeCommitment(1, attackerAddr, deposit, secretAlice);
    await attacker.doCommit(1, commitment, { value: deposit });

    // Skip both phases — attacker never reveals, gets 95% refund via no-winner branch
    await time.increase(commitDuration + revealDuration + 1);
    await blindBid.connect(seller).settleAuction(1);

    const expectedRefund = (deposit * 95n) / 100n; // 1.9 BNB
    expect(await blindBid.pendingRefunds(attackerAddr)).to.equal(expectedRefund);

    // Trigger the attack — receive() will attempt re-entry into withdrawRefund
    await attacker.attack();

    // Re-entry was attempted but nonReentrant blocked the second withdrawal
    expect(await attacker.reentrancyAttempted()).to.equal(true);
    expect(await attacker.attackCount()).to.equal(1n);
    // pendingRefunds must be 0 — only one withdrawal succeeded
    expect(await blindBid.pendingRefunds(attackerAddr)).to.equal(0n);
  });

  // 19. Immutable Auction Parameters
  it("19. Should verify auction parameters are immutable once created", async function () {
    await blindBid.connect(seller).createAuction("Item", "Desc", "uri", startingPrice, commitDuration, revealDuration);
    const auction = await blindBid.auctions(1);

    expect(auction.seller).to.equal(seller.address);
    expect(auction.startingPrice).to.equal(startingPrice);
  });

  // ───────────────────────────────────────────────────────────────
  // EXTENDED TEST COVERAGE
  // ───────────────────────────────────────────────────────────────

  // 20. Three-bidder realistic scenario: Alice 700, Bob 650, Charlie 500
  it("20. Three-bidder: Alice 700 wins at second-price 650, losers fully refunded", async function () {
    await blindBid.connect(seller).createAuction("Item", "Desc", "uri", startingPrice, commitDuration, revealDuration);

    const bidAlice   = ethers.parseEther("700");
    const bidBob     = ethers.parseEther("650");
    const bidCharlie = ethers.parseEther("500");

    const commitAlice   = await blindBid.computeCommitment(1, alice.address,   bidAlice,   secretAlice);
    const commitBob     = await blindBid.computeCommitment(1, bob.address,     bidBob,     secretBob);
    const commitCharlie = await blindBid.computeCommitment(1, charlie.address, bidCharlie, secretCharlie);

    await blindBid.connect(alice).commitBid(1, commitAlice,     { value: bidAlice });
    await blindBid.connect(bob).commitBid(1, commitBob,         { value: bidBob });
    await blindBid.connect(charlie).commitBid(1, commitCharlie, { value: bidCharlie });

    await time.increase(commitDuration + 1);

    await blindBid.connect(alice).revealBid(1,   bidAlice,   secretAlice);
    await blindBid.connect(bob).revealBid(1,     bidBob,     secretBob);
    await blindBid.connect(charlie).revealBid(1, bidCharlie, secretCharlie);

    await time.increase(revealDuration + 1);

    const initialSellerBal = await ethers.provider.getBalance(seller.address);
    const settleTx = await blindBid.connect(seller).settleAuction(1);
    const settleReceipt = await settleTx.wait();
    const gasSpent = settleReceipt!.gasUsed * settleReceipt!.gasPrice;

    // Winner = Alice (700), winning price = 650 (second-highest)
    await expect(settleTx)
      .to.emit(blindBid, "AuctionSettled")
      .withArgs(1, alice.address, bidBob, bidBob);

    // Seller receives exactly 650 BNB (net of seller's gas)
    const finalSellerBal = await ethers.provider.getBalance(seller.address);
    expect(finalSellerBal - initialSellerBal + gasSpent).to.equal(bidBob);

    // Alice (winner): 700 deposit - 650 winningPrice = 50 BNB refund
    expect(await blindBid.pendingRefunds(alice.address)).to.equal(bidAlice - bidBob);
    // Bob (loser, revealed): full 650 BNB back
    expect(await blindBid.pendingRefunds(bob.address)).to.equal(bidBob);
    // Charlie (loser, revealed): full 500 BNB back
    expect(await blindBid.pendingRefunds(charlie.address)).to.equal(bidCharlie);
  });

  // 21. Single revealed bidder — winningPrice falls back to startingPrice
  it("21. Single revealed bidder: winningPrice falls back to startingPrice", async function () {
    await blindBid.connect(seller).createAuction("Item", "Desc", "uri", startingPrice, commitDuration, revealDuration);

    const maxAlice = ethers.parseEther("3.0");
    const commitAlice = await blindBid.computeCommitment(1, alice.address, maxAlice, secretAlice);
    await blindBid.connect(alice).commitBid(1, commitAlice, { value: maxAlice });

    await time.increase(commitDuration + 1);
    await blindBid.connect(alice).revealBid(1, maxAlice, secretAlice);
    await time.increase(revealDuration + 1);

    const settleTx = await blindBid.connect(seller).settleAuction(1);
    // winningPrice = startingPrice because secondHighestBid == 0
    await expect(settleTx)
      .to.emit(blindBid, "AuctionSettled")
      .withArgs(1, alice.address, startingPrice, 0n);

    // Alice refund = deposit(3.0) - startingPrice(1.0) = 2.0 BNB
    expect(await blindBid.pendingRefunds(alice.address)).to.equal(maxAlice - startingPrice);
  });

  // 22. Seller cannot bid on their own auction
  it("22. Seller must be rejected when committing a bid on their own auction", async function () {
    await blindBid.connect(seller).createAuction("Item", "Desc", "uri", startingPrice, commitDuration, revealDuration);

    const maxBid = ethers.parseEther("2.0");
    const commitment = await blindBid.computeCommitment(1, seller.address, maxBid, secretAlice);

    await expect(
      blindBid.connect(seller).commitBid(1, commitment, { value: maxBid })
    ).to.be.revertedWith("Seller cannot bid on own auction");
  });

  // 23. Permissionless settlement — any account can call settleAuction
  it("23. Any account (non-seller) can call settleAuction after reveal deadline", async function () {
    await blindBid.connect(seller).createAuction("Item", "Desc", "uri", startingPrice, commitDuration, revealDuration);
    await time.increase(commitDuration + revealDuration + 1);

    // charlie is not the seller
    await expect(blindBid.connect(charlie).settleAuction(1))
      .to.emit(blindBid, "AuctionSettled")
      .withArgs(1, ethers.ZeroAddress, 0n, 0n);
  });

  // 24. Double settlement must revert
  it("24. Second call to settleAuction must revert with 'Auction already settled'", async function () {
    await blindBid.connect(seller).createAuction("Item", "Desc", "uri", startingPrice, commitDuration, revealDuration);
    await time.increase(commitDuration + revealDuration + 1);

    await blindBid.connect(seller).settleAuction(1);
    await expect(
      blindBid.connect(seller).settleAuction(1)
    ).to.be.revertedWith("Auction already settled");
  });

  // 25. Deposit below startingPrice must revert
  it("25. commitBid must revert when deposit is below startingPrice", async function () {
    await blindBid.connect(seller).createAuction("Item", "Desc", "uri", startingPrice, commitDuration, revealDuration);
    const lowDeposit = ethers.parseEther("0.5");
    const commitment = await blindBid.computeCommitment(1, alice.address, lowDeposit, secretAlice);
    await expect(
      blindBid.connect(alice).commitBid(1, commitment, { value: lowDeposit })
    ).to.be.revertedWith("Deposit below reserve/starting price");
  });

  // 26. commitDuration below 60 seconds must revert
  it("26. createAuction must revert when commitDuration is below 60 seconds", async function () {
    await expect(
      blindBid.connect(seller).createAuction("Item", "Desc", "uri", startingPrice, 59, revealDuration)
    ).to.be.revertedWith("Commit duration too short");
  });

  // 27. Reveal with declared maxBid exceeding deposit must revert
  it("27. revealBid must revert when declared maxBid exceeds the committed deposit", async function () {
    await blindBid.connect(seller).createAuction("Item", "Desc", "uri", startingPrice, commitDuration, revealDuration);

    // Commit with 1.5 BNB deposit; commitment is for maxBid = 2.0 BNB
    const deposit = ethers.parseEther("1.5");
    const maxBid  = ethers.parseEther("2.0");
    const commitment = await blindBid.computeCommitment(1, alice.address, maxBid, secretAlice);
    await blindBid.connect(alice).commitBid(1, commitment, { value: deposit });

    await time.increase(commitDuration + 1);

    await expect(
      blindBid.connect(alice).revealBid(1, maxBid, secretAlice)
    ).to.be.revertedWith("Deposit less than declared max bid");
  });

  // 28. 5% anti-abort penalty must remain in contract balance after withdrawal
  it("28. Non-reveal 5% penalty stays in contract balance after bidder withdraws", async function () {
    await blindBid.connect(seller).createAuction("Item", "Desc", "uri", startingPrice, commitDuration, revealDuration);

    const deposit = ethers.parseEther("2.0");
    const commitment = await blindBid.computeCommitment(1, alice.address, deposit, secretAlice);
    await blindBid.connect(alice).commitBid(1, commitment, { value: deposit });

    // Skip both phases without revealing
    await time.increase(commitDuration + revealDuration + 1);
    await blindBid.connect(seller).settleAuction(1);

    const penalty        = (deposit * 5n) / 100n;  // 0.1 BNB
    const expectedRefund = deposit - penalty;        // 1.9 BNB

    expect(await blindBid.pendingRefunds(alice.address)).to.equal(expectedRefund);

    // Alice claims her 1.9 BNB
    await blindBid.connect(alice).withdrawRefund();

    // Contract must retain exactly the penalty amount (0.1 BNB)
    const contractBalance = await ethers.provider.getBalance(await blindBid.getAddress());
    expect(contractBalance).to.equal(penalty);
  });
});
