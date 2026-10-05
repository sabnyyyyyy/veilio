import { expect } from "chai";
import hre from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";

const { ethers } = hre;

describe("VeilNFTV4 NFT escrow and delivery", function () {
  const reserve = ethers.parseEther("0.1");
  const maxBid = ethers.parseEther("0.2");
  const commitDuration = 60;
  const revealDuration = 60;
  const inspectionDuration = 3600;
  const secret = ethers.keccak256(ethers.toUtf8Bytes("v4 nft test secret"));

  let reviewer: any;
  let feeRecipient: any;
  let seller: any;
  let bidder: any;
  let veil: any;
  let erc721: any;

  beforeEach(async function () {
    [reviewer, feeRecipient, seller, bidder] = await ethers.getSigners();
    veil = await (await ethers.getContractFactory("VeilNFTV4")).deploy(reviewer.address, feeRecipient.address);
    erc721 = await (await ethers.getContractFactory("MockERC721")).deploy();
    await erc721.mint(seller.address, 1);
    await erc721.mint(seller.address, 2);
    await erc721.connect(seller).setApprovalForAll(await veil.getAddress(), true);
  });

  async function list721(tokenId: number, auctionName = "Test collectible") {
    const tx = await veil.connect(seller).createNftAuction(
      auctionName,
      "V4 escrow regression test",
      "ipfs://test-metadata",
      reserve,
      commitDuration,
      revealDuration,
      inspectionDuration,
      1,
      await erc721.getAddress(),
      tokenId,
      1,
    );
    await tx.wait();
  }

  async function sell721(auctionId: number, tokenId: number) {
    const commitment = await veil.computeCommitment(auctionId, bidder.address, maxBid, secret);
    await veil.connect(bidder).commitBid(auctionId, commitment, { value: maxBid });
    await time.increase(commitDuration + 1);
    await veil.connect(bidder).revealBid(auctionId, maxBid, secret);
    await time.increase(revealDuration + 1);
    await veil.connect(reviewer).settleAuction(auctionId);
    await time.increase(inspectionDuration + 1);
    await expect(veil.connect(reviewer).finalizeSettlement(auctionId))
      .to.emit(veil, "NftDelivered")
      .withArgs(auctionId, bidder.address, await erc721.getAddress(), tokenId, 1);
  }

  it("escrows an ERC-721 when VEILIO is the transfer operator", async function () {
    await list721(1);
    expect(await erc721.ownerOf(1)).to.equal(await veil.getAddress());
    const asset = await veil.nftAssets(1);
    expect(asset.escrowed).to.equal(true);
    expect(asset.delivered).to.equal(false);
  });

  it("returns an escrowed ERC-721 to the seller when no bidder wins", async function () {
    await list721(1);
    await time.increase(commitDuration + revealDuration + 1);
    await expect(veil.connect(reviewer).settleAuction(1))
      .to.emit(veil, "NftReturned")
      .withArgs(1, seller.address, await erc721.getAddress(), 1, 1);
    expect(await erc721.ownerOf(1)).to.equal(seller.address);
  });

  it("delivers ERC-721 to the winner after inspection finishes", async function () {
    await list721(1);
    expect(await erc721.ownerOf(1)).to.equal(await veil.getAddress());
    await sell721(1, 1);
    expect(await erc721.ownerOf(1)).to.equal(bidder.address);
    const asset = await veil.nftAssets(1);
    expect(asset.escrowed).to.equal(false);
    expect(asset.delivered).to.equal(true);
  });

  it("returns the NFT to the seller when the reviewer approves a refund", async function () {
    await list721(2, "Refund test collectible");
    const commitment = await veil.computeCommitment(1, bidder.address, maxBid, secret);
    await veil.connect(bidder).commitBid(1, commitment, { value: maxBid });
    await time.increase(commitDuration + 1);
    await veil.connect(bidder).revealBid(1, maxBid, secret);
    await time.increase(revealDuration + 1);
    await veil.settleAuction(1);
    await veil.connect(bidder).requestRefund(1, "ipfs://evidence");
    await veil.connect(reviewer).markUnderReview(1);
    await expect(veil.connect(reviewer).resolveRefund(1, true, "Approved"))
      .to.emit(veil, "NftReturned")
      .withArgs(1, seller.address, await erc721.getAddress(), 2, 1);
    expect(await erc721.ownerOf(2)).to.equal(seller.address);
  });

  it("escrows and returns an ERC-1155 when there is no winner", async function () {
    const erc1155 = await (await ethers.getContractFactory("MockERC1155")).deploy();
    await erc1155.mint(seller.address, 7, 5);
    await erc1155.connect(seller).setApprovalForAll(await veil.getAddress(), true);
    await veil.connect(seller).createNftAuction(
      "Test multi-token",
      "V4 ERC-1155 regression test",
      "ipfs://test-1155",
      reserve,
      commitDuration,
      revealDuration,
      inspectionDuration,
      2,
      await erc1155.getAddress(),
      7,
      3,
    );
    expect(await erc1155.balanceOf(await veil.getAddress(), 7)).to.equal(3);
    await time.increase(commitDuration + revealDuration + 1);
    await expect(veil.settleAuction(1))
      .to.emit(veil, "NftReturned")
      .withArgs(1, seller.address, await erc1155.getAddress(), 7, 3);
    expect(await erc1155.balanceOf(seller.address, 7)).to.equal(5);
  });
});
