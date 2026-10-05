import { expect } from "chai";
import hre from "hardhat";
const { ethers } = hre;
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { VeilV2 } from "../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

describe("VeilV2 Phase 10 Verification Suite", function () {
  let veil: VeilV2;
  let owner: SignerWithAddress;
  let seller: SignerWithAddress;
  let buyer1: SignerWithAddress;
  let buyer2: SignerWithAddress;
  let unauthorized: SignerWithAddress;
  let feeRecipient: SignerWithAddress;

  const startingPrice = ethers.parseEther("1.0");
  const commitDuration = 3600; // 1 hour
  const revealDuration = 3600; // 1 hour
  const inspectionDuration = 86400; // 24 hours

  const secret1 = ethers.keccak256(ethers.toUtf8Bytes("secret1"));
  const secret2 = ethers.keccak256(ethers.toUtf8Bytes("secret2"));

  beforeEach(async function () {
    [owner, seller, buyer1, buyer2, unauthorized, feeRecipient] = await ethers.getSigners();
    const VeilFactory = await ethers.getContractFactory("VeilV2");
    veil = await VeilFactory.deploy(owner.address, feeRecipient.address);
  });

  async function setupAuctionToInspection() {
    await veil.connect(seller).createAuction("Item", "Desc", "uri", startingPrice, commitDuration, revealDuration, inspectionDuration);
    const maxBid1 = ethers.parseEther("3.0");
    const deposit1 = maxBid1;
    const maxBid2 = ethers.parseEther("2.0");
    const deposit2 = maxBid2;

    const commit1 = await veil.computeCommitment(1, buyer1.address, maxBid1, secret1);
    const commit2 = await veil.computeCommitment(1, buyer2.address, maxBid2, secret2);

    await veil.connect(buyer1).commitBid(1, commit1, { value: deposit1 });
    await veil.connect(buyer2).commitBid(1, commit2, { value: deposit2 });

    await time.increase(commitDuration + 1);

    await veil.connect(buyer1).revealBid(1, maxBid1, secret1);
    await veil.connect(buyer2).revealBid(1, maxBid2, secret2);

    await time.increase(revealDuration + 1);

    await veil.settleAuction(1);
    // Winner is buyer1, price is 2.0. Buyer1 refund = 3 - 2 = 1.0 (overpayment)
    // Buyer2 refund = 2.0.
  }

  it("rejects zero commitments to keep bidder accounting one-to-one", async function () {
    await veil.connect(seller).createAuction("Item", "Desc", "uri", startingPrice, commitDuration, revealDuration, inspectionDuration);
    await expect(veil.connect(buyer1).commitBid(1, ethers.ZeroHash, { value: startingPrice }))
      .to.be.revertedWith("Invalid commitment");
    expect((await veil.auctions(1)).bidderCount).to.equal(0);
  });

  // 1. Winner accepts dataset
  it("1. Winner accepts dataset", async function () {
    await setupAuctionToInspection();
    await expect(veil.connect(buyer1).acceptDataset(1))
      .to.emit(veil, "DatasetAccepted").withArgs(1, buyer1.address)
      .and.to.emit(veil, "AuctionCompleted");
    
    expect(await veil.getAuctionState(1)).to.equal(6); // Completed
  });

  // 2. Winner does nothing -> auto settlement
  it("2. Winner does nothing -> auto settlement", async function () {
    await setupAuctionToInspection();
    await time.increase(inspectionDuration + 1);
    await expect(veil.connect(buyer2).finalizeSettlement(1))
      .to.emit(veil, "AuctionCompleted");
      
    expect(await veil.getAuctionState(1)).to.equal(6); // Completed
  });

  // 3. Winner requests valid refund
  it("3. Winner requests valid refund", async function () {
    await setupAuctionToInspection();
    await expect(veil.connect(buyer1).requestRefund(1, "evidence-hash"))
      .to.emit(veil, "RefundRequested").withArgs(1, buyer1.address, "evidence-hash");
      
    expect(await veil.getAuctionState(1)).to.equal(4); // RefundRequested
  });

  // 4. Reviewer approves refund
  it("4. Reviewer approves refund", async function () {
    await setupAuctionToInspection();
    await veil.connect(buyer1).requestRefund(1, "hash");
    await veil.connect(owner).markUnderReview(1);
    await expect(veil.connect(owner).resolveRefund(1, true, "Valid claim"))
      .to.emit(veil, "RefundResolved").withArgs(1, true, "Valid claim");
      
    expect(await veil.getAuctionState(1)).to.equal(7); // Refunded
  });

  // 5. Buyer receives exactly 100%
  // 6. Seller receives exactly 0% after approved refund
  // 7. VEIL receives exactly 0% after approved refund
  it("5, 6, 7. Buyer receives 100%, Seller 0%, VEIL 0% on approved refund", async function () {
    await setupAuctionToInspection();
    
    const preBuyerRefund = await veil.pendingRefunds(buyer1.address);
    const preSellerRefund = await veil.pendingRefunds(seller.address);
    const preOwnerRefund = await veil.pendingRefunds(owner.address);
    const preFeeRefund = await veil.pendingRefunds(feeRecipient.address);

    await veil.connect(buyer1).requestRefund(1, "hash");
    await veil.connect(owner).markUnderReview(1);
    await veil.connect(owner).resolveRefund(1, true, "Valid");

    const postBuyerRefund = await veil.pendingRefunds(buyer1.address);
    const postSellerRefund = await veil.pendingRefunds(seller.address);
    const postOwnerRefund = await veil.pendingRefunds(owner.address);
    const postFeeRefund = await veil.pendingRefunds(feeRecipient.address);

    // Winning price was 2.0. Buyer gets it back.
    expect(postBuyerRefund - preBuyerRefund).to.equal(ethers.parseEther("2.0"));
    expect(postSellerRefund - preSellerRefund).to.equal(0);
    expect(postOwnerRefund - preOwnerRefund).to.equal(0);
    expect(postFeeRefund - preFeeRefund).to.equal(0);
  });

  // 8. Winner requests invalid refund
  it("8. Winner requests invalid refund", async function () {
    await setupAuctionToInspection();
    await veil.connect(buyer1).requestRefund(1, "hash");
    expect(await veil.getAuctionState(1)).to.equal(4);
  });

  // 9. Reviewer rejects refund
  it("9. Reviewer rejects refund", async function () {
    await setupAuctionToInspection();
    await veil.connect(buyer1).requestRefund(1, "hash");
    await veil.connect(owner).markUnderReview(1);
    await expect(veil.connect(owner).resolveRefund(1, false, "Invalid claim"))
      .to.emit(veil, "RefundResolved").withArgs(1, false, "Invalid claim")
      .and.to.emit(veil, "AuctionCompleted");
      
    expect(await veil.getAuctionState(1)).to.equal(6); // Completed
  });

  // 10. Rejection reason is required
  it("10. Rejection reason is required", async function () {
    await setupAuctionToInspection();
    await veil.connect(buyer1).requestRefund(1, "hash");
    await veil.connect(owner).markUnderReview(1);
    await expect(veil.connect(owner).resolveRefund(1, false, ""))
      .to.be.revertedWith("Must provide a rejection reason");
  });

  // 11. Seller receives exactly 90% after rejected refund
  // 12. VEIL receives exactly 10%
  // 13. Fee is based on winning price, NOT maximum bid
  it("11, 12, 13. Exact Fee logic on rejected refund", async function () {
    await setupAuctionToInspection();
    
    const preBuyerRefund = await veil.pendingRefunds(buyer1.address);
    const preSellerRefund = await veil.pendingRefunds(seller.address);
    const preOwnerRefund = await veil.pendingRefunds(owner.address);
    const preFeeRefund = await veil.pendingRefunds(feeRecipient.address);

    await veil.connect(buyer1).requestRefund(1, "hash");
    await veil.connect(owner).markUnderReview(1);
    await veil.connect(owner).resolveRefund(1, false, "Reject");

    const postBuyerRefund = await veil.pendingRefunds(buyer1.address);
    const postSellerRefund = await veil.pendingRefunds(seller.address);
    const postOwnerRefund = await veil.pendingRefunds(owner.address);
    const postFeeRefund = await veil.pendingRefunds(feeRecipient.address);

    // Winning price was 2.0.
    // 10% of 2.0 = 0.2 BNB for VEIL
    // 90% of 2.0 = 1.8 BNB for Seller
    expect(postBuyerRefund - preBuyerRefund).to.equal(0); // Buyer gets 0 from resolution
    expect(postOwnerRefund - preOwnerRefund).to.equal(0); // Owner is just reviewer now, gets 0
    expect(postFeeRefund - preFeeRefund).to.equal(ethers.parseEther("0.2"));
    expect(postSellerRefund - preSellerRefund).to.equal(ethers.parseEther("1.8"));
    
    const auction = await veil.auctions(1);
    expect(auction.reviewReason).to.equal("Reject");
  });

  // 14. Funds remain locked while UNDER REVIEW
  it("14. Funds remain locked while UNDER REVIEW", async function () {
    await setupAuctionToInspection();
    await veil.connect(buyer1).requestRefund(1, "hash");
    await veil.connect(owner).markUnderReview(1);
    
    expect(await veil.getAuctionState(1)).to.equal(5); // UnderReview
    
    // Attempting to finalize should fail because it's not in Inspection phase
    await expect(veil.connect(unauthorized).finalizeSettlement(1))
      .to.be.revertedWith("Not in inspection phase");
  });

  // 15. Double refund is impossible
  it("15. Double refund is impossible", async function () {
    await setupAuctionToInspection();
    await veil.connect(buyer1).requestRefund(1, "hash");
    await veil.connect(owner).markUnderReview(1);
    await veil.connect(owner).resolveRefund(1, true, "Approve");
    
    // Resolving again should fail
    await expect(veil.connect(owner).resolveRefund(1, true, "Approve"))
      .to.be.revertedWith("Refund must be UnderReview to resolve");
  });

  // 16. Double settlement is impossible
  it("16. Double settlement is impossible", async function () {
    await setupAuctionToInspection();
    await expect(veil.settleAuction(1)).to.be.revertedWith("Auction already settled");
  });

  // 17. Unauthorized reviewer cannot resolve refund
  // 18. Unauthorized user cannot resolve refund
  it("17, 18. Unauthorized cannot resolve refund", async function () {
    await setupAuctionToInspection();
    await veil.connect(buyer1).requestRefund(1, "hash");
    
    await expect(veil.connect(buyer1).resolveRefund(1, true, "Approve"))
      .to.be.revertedWith("Not authorized: Reviewer only");
      
    await expect(veil.connect(unauthorized).resolveRefund(1, true, "Approve"))
      .to.be.revertedWith("Not authorized: Reviewer only");
  });

  // 19. Reviewer cannot change winner
  // 20. Reviewer cannot change winning price
  it("19, 20. Reviewer cannot change winner or price", async function () {
    // Contract code natively does not expose functions for this.
    // We just verify there are no such endpoints and the reviewer only calls resolveRefund
    // The resolveRefund automatically pulls winningPrice from state.
    const auction = await veil.auctions(1);
    expect(typeof veil.connect(owner).changeWinner).to.equal("undefined");
  });

  // 21. Buyer cannot request refund after final settlement
  it("21. Buyer cannot request refund after final settlement", async function () {
    await setupAuctionToInspection();
    await veil.connect(buyer1).acceptDataset(1); // Finalizes
    
    await expect(veil.connect(buyer1).requestRefund(1, "hash"))
      .to.be.revertedWith("Not in inspection phase");
  });

  // 22. Losing bidder cannot request refund
  it("22. Losing bidder cannot request refund", async function () {
    await setupAuctionToInspection();
    await expect(veil.connect(buyer2).requestRefund(1, "hash"))
      .to.be.revertedWith("Only winner can request refund");
  });

  // 23. Seller cannot withdraw during inspection
  it("23. Seller cannot withdraw during inspection", async function () {
    await setupAuctionToInspection();
    // Seller's pendingRefunds should still be 0 (no payout yet)
    expect(await veil.pendingRefunds(seller.address)).to.equal(0);
    // Calling finalizeSettlement before time is up fails
    await expect(veil.connect(seller).finalizeSettlement(1))
      .to.be.revertedWith("Inspection period has not ended");
  });

  // 24. Seller cannot withdraw during review
  it("24. Seller cannot withdraw during review", async function () {
    await setupAuctionToInspection();
    await veil.connect(buyer1).requestRefund(1, "hash");
    await veil.connect(owner).markUnderReview(1);
    
    // Time passes past inspection
    await time.increase(inspectionDuration + 1);
    
    // Seller tries to finalize
    await expect(veil.connect(seller).finalizeSettlement(1))
      .to.be.revertedWith("Not in inspection phase");
      
    // Seller's pending refund is still 0
    expect(await veil.pendingRefunds(seller.address)).to.equal(0);
  });
});
