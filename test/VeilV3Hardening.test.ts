import { expect } from "chai";
import hre from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";

const { ethers } = hre;

describe("VeilV3 hardening (review timeout, penalties, caps, admin, cancel)", function () {
  const startingPrice = ethers.parseEther("1.0");
  const commitDuration = 3600;
  const revealDuration = 3600;
  const inspectionDuration = 86400;
  const SEVEN_DAYS = 7 * 24 * 60 * 60;
  const s1 = ethers.keccak256(ethers.toUtf8Bytes("h-secret-1"));
  const s2 = ethers.keccak256(ethers.toUtf8Bytes("h-secret-2"));
  const s3 = ethers.keccak256(ethers.toUtf8Bytes("h-secret-3"));

  let veil: any;
  let owner: any, seller: any, b1: any, b2: any, b3: any, stranger: any, feeRecipient: any, reviewer2: any;

  beforeEach(async function () {
    [owner, seller, b1, b2, b3, stranger, feeRecipient, reviewer2] = await ethers.getSigners();
    veil = await (await ethers.getContractFactory("VeilV3")).deploy(owner.address, feeRecipient.address);
  });

  async function create() {
    await veil.connect(seller).createAuction("Item", "Desc", "uri", startingPrice, commitDuration, revealDuration, inspectionDuration);
  }

  async function commit(id: number, who: any, maxBid: bigint, secret: string, deposit: bigint) {
    const c = await veil.computeCommitment(id, who.address, maxBid, secret);
    await veil.connect(who).commitBid(id, c, { value: deposit });
  }

  async function toInspection() {
    await create();
    await commit(1, b1, ethers.parseEther("2"), s1, ethers.parseEther("2"));
    await commit(1, b2, ethers.parseEther("1"), s2, ethers.parseEther("1"));
    await time.increase(commitDuration + 1);
    await veil.connect(b1).revealBid(1, ethers.parseEther("2"), s1);
    await veil.connect(b2).revealBid(1, ethers.parseEther("1"), s2);
    await time.increase(revealDuration + 1);
    await veil.settleAuction(1);
  }

  async function sumPending(addrs: string[]) {
    let total = 0n;
    for (const a of addrs) total += await veil.pendingRefunds(a);
    return total;
  }

  describe("admin", function () {
    it("constructor rejects zero reviewer / fee recipient and records the deployer as owner", async function () {
      const F = await ethers.getContractFactory("VeilV3");
      await expect(F.deploy(ethers.ZeroAddress, feeRecipient.address)).to.be.revertedWith("Invalid reviewer");
      await expect(F.deploy(owner.address, ethers.ZeroAddress)).to.be.revertedWith("Invalid fee recipient");
      expect(await veil.owner()).to.equal(owner.address);
    });

    it("owner rotates reviewer; only the new reviewer can act", async function () {
      await expect(veil.connect(stranger).setReviewer(reviewer2.address)).to.be.revertedWith("Not authorized: Owner only");
      await expect(veil.setReviewer(ethers.ZeroAddress)).to.be.revertedWith("Invalid reviewer");
      await expect(veil.setReviewer(reviewer2.address))
        .to.emit(veil, "ReviewerUpdated").withArgs(owner.address, reviewer2.address);
      expect(await veil.reviewer()).to.equal(reviewer2.address);

      await toInspection();
      await veil.connect(b1).requestRefund(1, "ev");
      await expect(veil.connect(owner).markUnderReview(1)).to.be.revertedWith("Not authorized: Reviewer only");
      await veil.connect(reviewer2).markUnderReview(1);
      await veil.connect(reviewer2).resolveRefund(1, true, "ok");
      expect(await veil.getAuctionState(1)).to.equal(7);
    });

    it("owner rotates fee recipient; new fees accrue to the new recipient", async function () {
      await expect(veil.connect(stranger).setFeeRecipient(stranger.address)).to.be.revertedWith("Not authorized: Owner only");
      await expect(veil.setFeeRecipient(ethers.ZeroAddress)).to.be.revertedWith("Invalid fee recipient");
      await expect(veil.setFeeRecipient(stranger.address))
        .to.emit(veil, "FeeRecipientUpdated").withArgs(feeRecipient.address, stranger.address);
      await toInspection();
      await veil.connect(b1).acceptDataset(1);
      expect(await veil.pendingRefunds(stranger.address)).to.equal(ethers.parseEther("0.2"));
      expect(await veil.pendingRefunds(feeRecipient.address)).to.equal(0);
    });

    it("ownership can be transferred to a non-zero address only", async function () {
      await expect(veil.transferOwnership(ethers.ZeroAddress)).to.be.revertedWith("Invalid owner");
      await expect(veil.connect(stranger).transferOwnership(stranger.address)).to.be.revertedWith("Not authorized: Owner only");
      await expect(veil.transferOwnership(stranger.address))
        .to.emit(veil, "OwnershipTransferred").withArgs(owner.address, stranger.address);
      await expect(veil.setReviewer(reviewer2.address)).to.be.revertedWith("Not authorized: Owner only");
      await veil.connect(stranger).setReviewer(reviewer2.address);
    });
  });

  describe("input validation", function () {
    it("rejects a zero starting price", async function () {
      await expect(
        veil.connect(seller).createAuction("Item", "Desc", "uri", 0, commitDuration, revealDuration, inspectionDuration),
      ).to.be.revertedWith("Starting price must be positive");
    });

    it("rejects a zero deposit", async function () {
      await create();
      const c = await veil.computeCommitment(1, b1.address, startingPrice, s1);
      await expect(veil.connect(b1).commitBid(1, c, { value: 0 })).to.be.revertedWith("Deposit must be positive");
    });
  });

  describe("non-reveal penalty accounting", function () {
    it("credits the 5% penalty to feeRecipient when there is a winner; nothing is stranded", async function () {
      await create();
      await commit(1, b1, ethers.parseEther("2"), s1, ethers.parseEther("3"));
      await commit(1, b2, ethers.parseEther("1"), s2, ethers.parseEther("1"));
      await commit(1, b3, ethers.parseEther("1.5"), s3, ethers.parseEther("2")); // never reveals
      await time.increase(commitDuration + 1);
      await veil.connect(b1).revealBid(1, ethers.parseEther("2"), s1);
      await veil.connect(b2).revealBid(1, ethers.parseEther("1"), s2);
      await time.increase(revealDuration + 1);

      const penalty = ethers.parseEther("0.1"); // 5% of 2.0
      await expect(veil.settleAuction(1))
        .to.emit(veil, "NonRevealPenaltyCollected").withArgs(1, feeRecipient.address, penalty);
      expect(await veil.pendingRefunds(feeRecipient.address)).to.equal(penalty);
      expect(await veil.pendingRefunds(b3.address)).to.equal(ethers.parseEther("1.9"));

      await veil.connect(b1).acceptDataset(1);
      const all = [seller, b1, b2, b3, feeRecipient].map((s) => s.address);
      const balance = await ethers.provider.getBalance(await veil.getAddress());
      expect(await sumPending(all)).to.equal(balance); // every wei is claimable by someone
      expect(await veil.pendingRefunds(feeRecipient.address)).to.equal(penalty + ethers.parseEther("0.2"));
    });

    it("credits the penalty to feeRecipient when nobody reveals (no winner)", async function () {
      await create();
      await commit(1, b1, ethers.parseEther("2"), s1, ethers.parseEther("2"));
      await commit(1, b2, ethers.parseEther("1"), s2, ethers.parseEther("1"));
      await time.increase(commitDuration + revealDuration + 2);
      await expect(veil.settleAuction(1))
        .to.emit(veil, "NonRevealPenaltyCollected").withArgs(1, feeRecipient.address, ethers.parseEther("0.15"));
      const balance = await ethers.provider.getBalance(await veil.getAddress());
      expect(await sumPending([b1.address, b2.address, feeRecipient.address])).to.equal(balance);
      await veil.connect(feeRecipient).withdrawRefund();
      expect(await veil.pendingRefunds(feeRecipient.address)).to.equal(0);
    });
  });

  describe("bidder cap", function () {
    it("caps commitments at MAX_BIDDERS_PER_AUCTION and settles a full auction within a bounded gas budget", async function () {
      this.timeout(180000);
      const max = Number(await veil.MAX_BIDDERS_PER_AUCTION());
      expect(max).to.equal(100);
      await veil.connect(seller).createAuction("Item", "Desc", "uri", startingPrice, 3600 * 4, revealDuration, inspectionDuration);
      const fund = startingPrice + ethers.parseEther("0.05");
      const wallets: any[] = [];
      for (let i = 0; i < max + 1; i++) {
        const w = ethers.Wallet.createRandom().connect(ethers.provider);
        await owner.sendTransaction({ to: w.address, value: fund });
        wallets.push(w);
      }
      for (let i = 0; i < max; i++) {
        const c = await veil.computeCommitment(1, wallets[i].address, startingPrice, s1);
        await veil.connect(wallets[i]).commitBid(1, c, { value: startingPrice });
      }
      const extra = wallets[max];
      const c = await veil.computeCommitment(1, extra.address, startingPrice, s1);
      await expect(veil.connect(extra).commitBid(1, c, { value: startingPrice })).to.be.revertedWith("Bidder limit reached");

      await time.increase(3600 * 4 + revealDuration + 2);
      const tx = await veil.settleAuction(1); // worst case: nobody revealed, every bidder penalised
      const receipt = await tx.wait();
      expect(receipt!.gasUsed).to.be.lessThan(10_000_000n);
      const balance = await ethers.provider.getBalance(await veil.getAddress());
      expect(await sumPending([...wallets.slice(0, max).map((w) => w.address), feeRecipient.address])).to.equal(balance);
    });
  });

  describe("refund review timeout", function () {
    it("records the request time and blocks the timeout until REVIEW_TIMEOUT has elapsed", async function () {
      expect(await veil.REVIEW_TIMEOUT()).to.equal(SEVEN_DAYS);
      await toInspection();
      await expect(veil.finalizeRefundTimeout(1)).to.be.revertedWith("No refund pending review");
      await veil.connect(b1).requestRefund(1, "ev");
      expect(await veil.refundRequestedAt(1)).to.be.greaterThan(0);
      await time.increase(SEVEN_DAYS - 10);
      await expect(veil.connect(stranger).finalizeRefundTimeout(1)).to.be.revertedWith("Review period still active");
    });

    it("anyone can refund the winner after the reviewer stays silent (RefundRequested)", async function () {
      await toInspection();
      await veil.connect(b1).requestRefund(1, "ev");
      await time.increase(SEVEN_DAYS + 1);
      await expect(veil.connect(stranger).finalizeRefundTimeout(1))
        .to.emit(veil, "RefundReviewTimedOut").withArgs(1, b1.address, ethers.parseEther("2"))
        .and.to.emit(veil, "RefundResolved").withArgs(1, true, "Reviewer timeout");
      expect(await veil.getAuctionState(1)).to.equal(7); // Refunded
      expect(await veil.pendingRefunds(b1.address)).to.equal(ethers.parseEther("2"));
      expect(await veil.pendingRefunds(seller.address)).to.equal(0);
      expect(await veil.pendingRefunds(feeRecipient.address)).to.equal(0);
      await expect(veil.finalizeRefundTimeout(1)).to.be.revertedWith("No refund pending review");
      await expect(veil.connect(owner).resolveRefund(1, false, "late")).to.be.revertedWith("Refund must be UnderReview to resolve");
    });

    it("also times out a dispute stuck in UnderReview", async function () {
      await toInspection();
      await veil.connect(b1).requestRefund(1, "ev");
      await veil.connect(owner).markUnderReview(1);
      await time.increase(SEVEN_DAYS + 1);
      await veil.connect(b2).finalizeRefundTimeout(1);
      expect(await veil.getAuctionState(1)).to.equal(7);
      const balance = await ethers.provider.getBalance(await veil.getAddress());
      expect(await sumPending([b1.address, b2.address, seller.address, feeRecipient.address])).to.equal(balance);
    });

    it("the reviewer can still decide before anyone triggers the timeout", async function () {
      await toInspection();
      await veil.connect(b1).requestRefund(1, "ev");
      await veil.connect(owner).markUnderReview(1);
      await time.increase(SEVEN_DAYS + 1);
      await veil.connect(owner).resolveRefund(1, false, "Rejected");
      expect(await veil.getAuctionState(1)).to.equal(6);
      await expect(veil.finalizeRefundTimeout(1)).to.be.revertedWith("No refund pending review");
    });
  });

  describe("seller cancel", function () {
    it("seller can cancel an auction with no commitments", async function () {
      await create();
      await expect(veil.connect(stranger).cancelAuction(1)).to.be.revertedWith("Only seller can cancel");
      await expect(veil.connect(seller).cancelAuction(1)).to.emit(veil, "AuctionCancelled").withArgs(1, seller.address);
      expect(await veil.getAuctionState(1)).to.equal(8); // Cancelled
      const c = await veil.computeCommitment(1, b1.address, startingPrice, s1);
      await expect(veil.connect(b1).commitBid(1, c, { value: startingPrice })).to.be.revertedWith("Auction is not open for bids");
      await time.increase(commitDuration + revealDuration + 2);
      await expect(veil.settleAuction(1)).to.be.revertedWith("Auction already settled");
      await expect(veil.connect(seller).cancelAuction(1)).to.be.revertedWith("Auction cannot be cancelled");
    });

    it("seller cannot cancel once a bid is committed", async function () {
      await create();
      await commit(1, b1, startingPrice, s1, startingPrice);
      await expect(veil.connect(seller).cancelAuction(1)).to.be.revertedWith("Auction already has bids");
    });
  });
});
