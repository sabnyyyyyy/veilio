import { ethers } from "ethers";
import fs from "fs";

function main() {
    const deployer = ethers.Wallet.createRandom();
    const reviewer = ethers.Wallet.createRandom();
    const feeRecipient = ethers.Wallet.createRandom();

    const envContent = `DEPLOYER_PRIVATE_KEY=${deployer.privateKey}
REVIEWER_ADDRESS=${reviewer.address}
FEE_RECIPIENT_ADDRESS=${feeRecipient.address}
`;

    fs.writeFileSync(".env.testnet", envContent);

    console.log("Generated testnet wallets for deployment:");
    console.log("-----------------------------------------");
    console.log("Deployer Address:", deployer.address);
    console.log("Reviewer Address:", reviewer.address);
    console.log("Fee Recipient Address:", feeRecipient.address);
    console.log("-----------------------------------------");
    console.log("Private keys saved to .env.testnet");
    console.log("ACTION REQUIRED: Please send testnet BNB to the Deployer Address to pay for gas!");
}

main();
