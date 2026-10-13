import { expect } from "chai";
import hre from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";

const { ethers } = hre;

describe("VeilNFTV4 non-blocking NFT release (griefing resistance)", function () {
  const reserve = ethers.parseEther("0.1");
  const maxBid = ethers.parseEther("0.2");
  const commitDuration = 60;
  const revealDuration = 60;
  const inspectionDuration = 3600;
  const SEVEN_DAYS = 7 * 24 * 60 * 60;
  const secret = ethers.keccak256(ethers.toUtf8Bytes("v4 hardening secret"));
  const secret2 = ethers.keccak256(ethers.toUtf8Bytes("v4 hardening secret 2"));

  let reviewer: any, feeRecipient: any, seller: any, bidder: any, bidder2: any, rescue: any;
  let veil: any, erc721: any, griefer: any;
  let veilAddr: string, nftAddr: string, grieferAddr: string;

  beforeEach(async function () {
    [reviewer, feeRecipient, seller, bidder, bidder2, rescue] = await ethers.getSigners();
    veil = await (await ethers.getContractFactory("VeilNFTV4")).deploy(reviewer.address, feeRecipient.address);
    erc721 = await (await ethers.getContractFactory("MockERC721")).deploy();
    griefer = await (await ethers.getContractFactory("NftGriefer")).deploy();
    veilAddr = await veil.getAddress();
    nftAddr = await erc721.getAddress();
    grieferAddr = await griefer.getAddress();
  });

  // Griefer contract lists token `tokenId` as the seller.
  async function grieferLists(tokenId: number) {
    await erc721.mint(grieferAddr, tokenId);
    await griefer.exec(nftAddr, 0, erc721.interface.encodeFunctionData("setApprovalForAll", [veilAddr, true]));
    const data = veil.interface.encodeFunctionData("createNftAuction", [
      "Griefed", "seller contract rejects NFT", "ipfs://x", reserve, commitDuration, revealDuration, inspectionDuration,
      1, nftAddr, tokenId, 1,
    ]);
    await griefer.exec(veilAddr, 0, data);
    expect(await erc721.ownerOf(tokenId)).to.equal(veilAddr);
  }

  async function sellerLists(tokenId: number) {
    await erc721.mint(seller.address, tokenId);
    await erc721.connect(seller).setApprovalForAll(veilAddr, true);
    await veil.connect(seller).createNftAuction(
      "Normal", "EOA seller", "ipfs://y", reserve, commitDuration, revealDuration, inspectionDuration, 1, nftAddr, tokenId, 1,
    );
  }

  async function commitEOA(id: number, who: any, s: string, value = maxBid) {
    const c = await veil.computeCommitment(id, who.address, maxBid, s);
    await veil.connect(who).commitBid(id, c, { value });
  }

  it("no-winner settle does not revert when the seller contract rejects the NFT; bidder refunds proceed", async function () {
    await grieferLists(1);
    await commitEOA(1, bidder, secret); // never reveals
    await griefer.setMode(1);
    await time.increase(commitDuration + revealDuration + 2);

    await expect(veil.settleAuction(1))
      .to.emit(veil, "NftTransferFailed").withArgs(1, grieferAddr);
    expect(await veil.getAuctionState(1)).to.equal(6); // Completed
    expect(await veil.pendingRefunds(bidder.address)).to.equal((maxBid * 95n) / 100n);
    expect(await veil.nftClaimant(1)).to.equal(grieferAddr);
    expect(await erc721.ownerOf(1)).to.equal(veilAddr);
    expect((await veil.nftAssets(1)).escrowed).to.equal(true);

    // Bidder can withdraw despite the stuck NFT.
    await veil.connect(bidder).withdrawRefund();

    // Only the claimant can pull; it may redirect to another address.
    await expect(veil.connect(bidder).claimNft(1, bidder.address)).to.be.revertedWith("No NFT claimable");
    const claim = veil.interface.encodeFunctionData("claimNft", [1, rescue.address]);
    await expect(griefer.exec(veilAddr, 0, claim))
      .to.emit(veil, "NftClaimed").withArgs(1, grieferAddr, rescue.address)
      .and.to.emit(veil, "NftReturned").withArgs(1, rescue.address, nftAddr, 1, 1);
    expect(await erc721.ownerOf(1)).to.equal(rescue.address);
    expect(await veil.nftClaimant(1)).to.equal(ethers.ZeroAddress);
    await expect(griefer.exec(veilAddr, 0, claim)).to.be.revertedWith("No NFT claimable");
  });

  it("finalizeSettlement pays the seller even if the winner contract rejects the NFT; winner claims later", async function () {
    await sellerLists(5);
    // Griefer bids as a contract wallet.
    const c = await veil.computeCommitment(1, grieferAddr, maxBid, secret);
    await griefer.exec(veilAddr, maxBid, veil.interface.encodeFunctionData("commitBid", [1, c]), { value: maxBid });
    await time.increase(commitDuration + 1);
    await griefer.exec(veilAddr, 0, veil.interface.encodeFunctionData("revealBid", [1, maxBid, secret]));
    await time.increase(revealDuration + 1);
    await veil.settleAuction(1);
    await griefer.setMode(2); // burn all forwarded gas
    await time.increase(inspectionDuration + 1);

    await expect(veil.finalizeSettlement(1, { gasLimit: 3_000_000 }))
      .to.emit(veil, "NftTransferFailed").withArgs(1, grieferAddr)
      .and.to.emit(veil, "AuctionCompleted");
    expect(await veil.pendingRefunds(seller.address)).to.equal((maxBid * 90n) / 100n);
    expect(await veil.pendingRefunds(feeRecipient.address)).to.equal((maxBid * 10n) / 100n);
    expect(await veil.nftClaimant(1)).to.equal(grieferAddr);

    await griefer.setMode(0);
    await expect(griefer.exec(veilAddr, 0, veil.interface.encodeFunctionData("claimNft", [1, grieferAddr])))
      .to.emit(veil, "NftDelivered").withArgs(1, grieferAddr, nftAddr, 5, 1);
    expect(await erc721.ownerOf(5)).to.equal(grieferAddr);
    const asset = await veil.nftAssets(1);
    expect(asset.escrowed).to.equal(false);
    expect(asset.delivered).to.equal(true);
  });

  it("approved refund credits the winner even when the seller contract rejects the returned NFT", async function () {
    await grieferLists(2);
    await commitEOA(1, bidder, secret);
    await time.increase(commitDuration + 1);
    await veil.connect(bidder).revealBid(1, maxBid, secret);
    await time.increase(revealDuration + 1);
    await veil.settleAuction(1);
    await veil.connect(bidder).requestRefund(1, "ipfs://evidence");
    await veil.connect(reviewer).markUnderReview(1);
    await griefer.setMode(1);
    await expect(veil.connect(reviewer).resolveRefund(1, true, "Approved"))
      .to.emit(veil, "NftTransferFailed").withArgs(1, grieferAddr);
    expect(await veil.pendingRefunds(bidder.address)).to.equal(maxBid);
    expect(await veil.getAuctionState(1)).to.equal(7);
  });

  it("reviewer timeout returns the NFT to the seller and refunds the winner", async function () {
    await sellerLists(3);
    await commitEOA(1, bidder, secret);
    await time.increase(commitDuration + 1);
    await veil.connect(bidder).revealBid(1, maxBid, secret);
    await time.increase(revealDuration + 1);
    await veil.settleAuction(1);
    await veil.connect(bidder).requestRefund(1, "ipfs://evidence");
    await time.increase(SEVEN_DAYS + 1);
    await expect(veil.connect(bidder2).finalizeRefundTimeout(1))
      .to.emit(veil, "NftReturned").withArgs(1, seller.address, nftAddr, 3, 1)
      .and.to.emit(veil, "RefundReviewTimedOut");
    expect(await erc721.ownerOf(3)).to.equal(seller.address);
    expect(await veil.pendingRefunds(bidder.address)).to.equal(maxBid);
  });

  it("seller cancel of an NFT auction with no bids returns the NFT", async function () {
    await sellerLists(4);
    await expect(veil.connect(seller).cancelAuction(1))
      .to.emit(veil, "NftReturned").withArgs(1, seller.address, nftAddr, 4, 1)
      .and.to.emit(veil, "AuctionCancelled");
    expect(await erc721.ownerOf(4)).to.equal(seller.address);
    expect(await veil.getAuctionState(1)).to.equal(8);
  });

  it("winner path with an EOA still delivers immediately and leaves no claimant", async function () {
    await sellerLists(6);
    await commitEOA(1, bidder, secret);
    await commitEOA(1, bidder2, secret2);
    await time.increase(commitDuration + 1);
    await veil.connect(bidder).revealBid(1, maxBid, secret);
    await time.increase(revealDuration + 1);
    await veil.settleAuction(1); // bidder2 never revealed -> penalty to feeRecipient
    expect(await veil.pendingRefunds(feeRecipient.address)).to.equal((maxBid * 5n) / 100n);
    await time.increase(inspectionDuration + 1);
    await expect(veil.finalizeSettlement(1)).to.emit(veil, "NftDelivered").withArgs(1, bidder.address, nftAddr, 6, 1);
    expect(await veil.nftClaimant(1)).to.equal(ethers.ZeroAddress);
    await expect(veil.connect(bidder).claimNft(1, bidder.address)).to.be.revertedWith("No NFT claimable");
  });

  it("rejects claimNft to the zero address", async function () {
    await grieferLists(7);
    await griefer.setMode(1);
    await time.increase(commitDuration + revealDuration + 2);
    await veil.settleAuction(1);
    await expect(griefer.exec(veilAddr, 0, veil.interface.encodeFunctionData("claimNft", [1, ethers.ZeroAddress])))
      .to.be.revertedWith("Invalid recipient");
  });
});
