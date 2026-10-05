import { artifacts, ethers } from "hardhat";

const POLL_INTERVAL_MS = 30_000;

async function main() {
  const address = process.env.NEXT_PUBLIC_V4_CONTRACT_ADDRESS;
  if (!address) throw new Error("Set NEXT_PUBLIC_V4_CONTRACT_ADDRESS to the deployed VeilNFTV4 address.");
  const keeperKey = process.env.NFT_KEEPER_PRIVATE_KEY;
  if (!keeperKey) throw new Error("Set NFT_KEEPER_PRIVATE_KEY to a funded BNB Chain account.");
  const keeper = new ethers.Wallet(keeperKey, ethers.provider);

  const artifact = await artifacts.readArtifact("VeilNFTV4");
  const veil = new ethers.Contract(address, artifact.abi, keeper);
  console.log(`NFT keeper running as ${keeper.address} for ${address}`);

  for (;;) {
    try {
      const count = BigInt(await veil.auctionCount());
      const latest = await ethers.provider.getBlock("latest");
      const now = BigInt(latest?.timestamp ?? Math.floor(Date.now() / 1000));
      for (let auctionId = BigInt(1); auctionId <= count; auctionId++) {
        try {
          const [auction, asset] = await Promise.all([
            veil.auctions(auctionId),
            veil.nftAssets(auctionId),
          ]);
          const state = BigInt(auction.state ?? auction[10]);
          const revealEnd = BigInt(auction.revealEndTime ?? auction[7]);
          const inspectionEnd = BigInt(auction.inspectionEndTime ?? auction[9]);
          const standard = BigInt(asset.standard ?? asset[0]);
          if (standard === BigInt(0)) continue;

          let tx;
          if (state === BigInt(0) && now >= revealEnd) {
            tx = await veil.settleAuction(auctionId);
          } else if (state === BigInt(3) && now > inspectionEnd) {
            tx = await veil.finalizeSettlement(auctionId);
          } else {
            continue;
          }
          const receipt = await tx.wait();
          console.log(`NFT auction ${auctionId} advanced automatically in ${receipt.hash}`);
        } catch (error) {
          console.error(`Could not finalize NFT auction ${auctionId}:`, error instanceof Error ? error.message : error);
        }
      }
    } catch (error) {
      console.error("NFT keeper polling error:", error instanceof Error ? error.message : error);
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
