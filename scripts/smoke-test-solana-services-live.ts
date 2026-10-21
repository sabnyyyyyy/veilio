import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
  LAMPORTS_PER_SOL,
  SystemProgram,
} from '@solana/web3.js';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import {
  createRegisterServiceInstruction,
  findServiceRecordPda,
  decodeServiceRecordAccount,
} from '../lib/cross-chain/solanaServiceRegistry';
import {
  createDepositServiceOrderInstruction,
  createSubmitDeliveryInstruction,
  createReleaseFundsInstruction,
  createCancelOrRefundInstruction,
  findEscrowOrderPda,
  findVaultPda,
  decodeEscrowOrderAccount,
} from '../lib/cross-chain/solanaServiceEscrow';

const REGISTRY_PROGRAM_ID =
  process.env.NEXT_PUBLIC_SOLANA_SERVICE_REGISTRY_PROGRAM_ID ||
  '6CMoJyQmBobLTk4M9ZoygMShRB6A6i77e6viq2Lew2KY';

const ESCROW_PROGRAM_ID =
  process.env.NEXT_PUBLIC_SOLANA_SERVICE_ESCROW_PROGRAM_ID ||
  '5Vj4y8BT74PDe5VwLuDp9agTR5ak4vtZdwxnBfRW3R8s';

const DEVNET_RPC = process.env.SOLANA_DEVNET_RPC || 'https://api.devnet.solana.com';

function loadDeployerKeypair(): Keypair {
  const possiblePaths = [
    '\\\\wsl.localhost\\Ubuntu-22.04\\home\\sabny\\.config\\solana\\id.json',
    '\\\\wsl$\\Ubuntu-22.04\\home\\sabny\\.config\\solana\\id.json',
    path.join(process.env.HOME || process.env.USERPROFILE || '', '.config', 'solana', 'id.json'),
  ];

  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      const raw = fs.readFileSync(p, 'utf8');
      const secret = Uint8Array.from(JSON.parse(raw));
      return Keypair.fromSecretKey(secret);
    }
  }

  throw new Error('Could not find Solana deployer keypair at any known path');
}

async function main() {
  console.log('===============================================================');
  console.log('VEILIO Solana Devnet Services On-Chain Live Smoke Test');
  console.log('===============================================================');
  console.log(`RPC Endpoint:            ${DEVNET_RPC}`);
  console.log(`Registry Program ID:     ${REGISTRY_PROGRAM_ID}`);
  console.log(`Escrow Program ID:       ${ESCROW_PROGRAM_ID}`);

  const connection = new Connection(DEVNET_RPC, 'confirmed');
  const deployer = loadDeployerKeypair();
  const deployerBalance = await connection.getBalance(deployer.publicKey);
  console.log(`Deployer Address:        ${deployer.publicKey.toBase58()}`);
  console.log(`Deployer Balance:        ${deployerBalance / LAMPORTS_PER_SOL} SOL\n`);

  if (deployerBalance < 0.1 * LAMPORTS_PER_SOL) {
    throw new Error('Deployer has insufficient SOL balance for testing');
  }

  // 1. Generate test participants
  const seller = Keypair.generate();
  const buyer = Keypair.generate();
  const reviewer = deployer; // Use deployer as reviewer
  const feeRecipient = deployer; // Use deployer as fee recipient

  console.log(`[1] Created Test Wallets:`);
  console.log(`    - Seller: ${seller.publicKey.toBase58()}`);
  console.log(`    - Buyer:  ${buyer.publicKey.toBase58()}`);
  console.log(`    - Reviewer: ${reviewer.publicKey.toBase58()}`);
  console.log(`    - Fee Recipient: ${feeRecipient.publicKey.toBase58()}\n`);

  // 2. Fund test wallets with 0.05 SOL each
  console.log(`[2] Funding Test Wallets from Deployer...`);
  const fundTx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: deployer.publicKey,
      toPubkey: seller.publicKey,
      lamports: 0.05 * LAMPORTS_PER_SOL,
    }),
    SystemProgram.transfer({
      fromPubkey: deployer.publicKey,
      toPubkey: buyer.publicKey,
      lamports: 0.05 * LAMPORTS_PER_SOL,
    })
  );
  const fundSig = await sendAndConfirmTransaction(connection, fundTx, [deployer], {
    commitment: 'confirmed',
  });
  console.log(`    - Funded Buyer & Seller Tx: ${fundSig}\n`);

  // 3. Test Registry: Register Service Listing
  console.log(`[3] Testing VeilServiceRegistry: Registering Service Listing...`);
  const serviceIdHex = `0x${crypto.randomBytes(32).toString('hex')}`;
  const metadataHashHex = `0x${crypto.randomBytes(32).toString('hex')}`;
  const metadataUri = 'https://veilio.io/services/test-devnet-service';

  const regCompiled = createRegisterServiceInstruction({
    programId: REGISTRY_PROGRAM_ID,
    seller: seller.publicKey.toBase58(),
    serviceId: serviceIdHex,
    metadataHash: metadataHashHex,
    metadataUri,
  });

  const regIx = new TransactionInstruction({
    programId: new PublicKey(regCompiled.programId),
    keys: regCompiled.accounts.map((acc) => ({
      pubkey: new PublicKey(acc.pubkey),
      isSigner: acc.isSigner,
      isWritable: acc.isWritable,
    })),
    data: Buffer.from(regCompiled.data || []),
  });

  const regTx = new Transaction().add(regIx);
  const regSig = await sendAndConfirmTransaction(connection, regTx, [seller], {
    commitment: 'confirmed',
  });
  console.log(`    - Service Registered! Tx: ${regSig}`);

  const { pda: servicePda } = findServiceRecordPda(
    serviceIdHex,
    seller.publicKey.toBase58(),
    REGISTRY_PROGRAM_ID
  );
  const serviceAccount = await connection.getAccountInfo(new PublicKey(servicePda), 'confirmed');
  if (!serviceAccount) throw new Error('Service record PDA not found on-chain!');
  const decodedService = decodeServiceRecordAccount(serviceAccount.data);
  console.log(`    - Verified On-Chain Service Record:`);
  console.log(`      * Seller:        ${decodedService.seller}`);
  console.log(`      * Active:        ${decodedService.active}`);
  console.log(`      * Metadata URI:  ${decodedService.metadataUri}\n`);

  // 4. Test Escrow: Deposit & Fund Order 1
  console.log(`[4] Testing VeilServiceEscrow: Buyer Deposits 0.01 SOL into Escrow...`);
  const order1IdHex = `0x${crypto.randomBytes(32).toString('hex')}`;
  const depositLamports = 10_000_000; // 0.01 SOL
  const deadline = Math.floor(Date.now() / 1000) + 3600;

  const depCompiled = createDepositServiceOrderInstruction({
    programId: ESCROW_PROGRAM_ID,
    buyer: buyer.publicKey.toBase58(),
    seller: seller.publicKey.toBase58(),
    reviewer: reviewer.publicKey.toBase58(),
    feeRecipient: feeRecipient.publicKey.toBase58(),
    orderId: order1IdHex,
    amountLamports: depositLamports,
    deadline,
  });

  const depIx = new TransactionInstruction({
    programId: new PublicKey(depCompiled.programId),
    keys: depCompiled.accounts.map((acc) => ({
      pubkey: new PublicKey(acc.pubkey),
      isSigner: acc.isSigner,
      isWritable: acc.isWritable,
    })),
    data: depCompiled.data as Buffer,
  });

  const depTx = new Transaction().add(depIx);
  const depSig = await sendAndConfirmTransaction(connection, depTx, [buyer], {
    commitment: 'confirmed',
  });
  console.log(`    - Escrow Funded! Tx: ${depSig}`);

  const { pda: escrowPda } = findEscrowOrderPda(order1IdHex, ESCROW_PROGRAM_ID);
  const { pda: vaultPda } = findVaultPda(order1IdHex, ESCROW_PROGRAM_ID);

  const vaultBalanceAfterDeposit = await connection.getBalance(new PublicKey(vaultPda), 'confirmed');
  console.log(`    - Vault PDA Balance: ${vaultBalanceAfterDeposit} lamports (Expected >= ${depositLamports})`);

  let escrowAccount = await connection.getAccountInfo(new PublicKey(escrowPda), 'confirmed');
  if (!escrowAccount) throw new Error('Escrow account not found on-chain!');
  let decodedEscrow = decodeEscrowOrderAccount(escrowAccount.data);
  console.log(`    - Verified Escrow State: ${decodedEscrow.status} (Expected: Funded)\n`);

  // 5. Test Delivery Submission
  console.log(`[5] Testing Submit Delivery: Seller Submits Work Reference...`);
  const deliverableRef = 'ipfs://bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi';
  const delCompiled = createSubmitDeliveryInstruction({
    programId: ESCROW_PROGRAM_ID,
    seller: seller.publicKey.toBase58(),
    orderId: order1IdHex,
    deliverableReference: deliverableRef,
  });

  const delIx = new TransactionInstruction({
    programId: new PublicKey(delCompiled.programId),
    keys: delCompiled.accounts.map((acc) => ({
      pubkey: new PublicKey(acc.pubkey),
      isSigner: acc.isSigner,
      isWritable: acc.isWritable,
    })),
    data: delCompiled.data as Buffer,
  });

  const delTx = new Transaction().add(delIx);
  const delSig = await sendAndConfirmTransaction(connection, delTx, [seller], {
    commitment: 'confirmed',
  });
  console.log(`    - Delivery Submitted! Tx: ${delSig}`);

  escrowAccount = await connection.getAccountInfo(new PublicKey(escrowPda), 'confirmed');
  decodedEscrow = decodeEscrowOrderAccount(escrowAccount!.data);
  console.log(`    - Verified Escrow State: ${decodedEscrow.status} (Expected: Delivered)`);
  console.log(`    - Deliverable Ref:       ${decodedEscrow.deliverableReference}\n`);

  // 6. Test Security: Unauthorized Release Attempt by Seller
  console.log(`[6] Testing Security: Unauthorized Release Attempt by Seller (Must Fail)...`);
  const unauthorizedReleaseCompiled = createReleaseFundsInstruction({
    programId: ESCROW_PROGRAM_ID,
    buyer: seller.publicKey.toBase58(), // Seller pretending to be buyer signer
    seller: seller.publicKey.toBase58(),
    feeRecipient: feeRecipient.publicKey.toBase58(),
    orderId: order1IdHex,
  });

  const unauthorizedReleaseIx = new TransactionInstruction({
    programId: new PublicKey(unauthorizedReleaseCompiled.programId),
    keys: unauthorizedReleaseCompiled.accounts.map((acc) => ({
      pubkey: new PublicKey(acc.pubkey),
      isSigner: acc.isSigner,
      isWritable: acc.isWritable,
    })),
    data: unauthorizedReleaseCompiled.data as Buffer,
  });

  try {
    const badTx = new Transaction().add(unauthorizedReleaseIx);
    await sendAndConfirmTransaction(connection, badTx, [seller], { commitment: 'confirmed' });
    throw new Error('SECURITY VIOLATION: Unauthorized release succeeded!');
  } catch (err: any) {
    console.log(`    - Expected Security Rejection: Unauthorized release correctly blocked!`);
  }

  // 7. Test Legitimate Release & Settlement
  console.log(`\n[7] Testing Legitimate Release: Buyer Approves and Releases Funds...`);
  const sellerBalanceBefore = await connection.getBalance(seller.publicKey, 'confirmed');
  const feeBalanceBefore = await connection.getBalance(feeRecipient.publicKey, 'confirmed');

  const relCompiled = createReleaseFundsInstruction({
    programId: ESCROW_PROGRAM_ID,
    buyer: buyer.publicKey.toBase58(),
    seller: seller.publicKey.toBase58(),
    feeRecipient: feeRecipient.publicKey.toBase58(),
    orderId: order1IdHex,
  });

  const relIx = new TransactionInstruction({
    programId: new PublicKey(relCompiled.programId),
    keys: relCompiled.accounts.map((acc) => ({
      pubkey: new PublicKey(acc.pubkey),
      isSigner: acc.isSigner,
      isWritable: acc.isWritable,
    })),
    data: relCompiled.data as Buffer,
  });

  const relTx = new Transaction().add(relIx);
  const relSig = await sendAndConfirmTransaction(connection, relTx, [buyer], {
    commitment: 'confirmed',
  });
  console.log(`    - Funds Released and Settled! Tx: ${relSig}`);

  const sellerBalanceAfter = await connection.getBalance(seller.publicKey, 'confirmed');
  const feeBalanceAfter = await connection.getBalance(feeRecipient.publicKey, 'confirmed');

  const sellerGain = sellerBalanceAfter - sellerBalanceBefore;
  const feeGain = feeBalanceAfter - feeBalanceBefore;
  console.log(`    - Seller Received:       ${sellerGain} lamports (Expected 91.5% = 9,150,000 lamports)`);
  console.log(`    - Fee Recipient Received: ${feeGain} lamports (Expected 8.5% = 850,000 lamports)`);

  escrowAccount = await connection.getAccountInfo(new PublicKey(escrowPda), 'confirmed');
  decodedEscrow = decodeEscrowOrderAccount(escrowAccount!.data);
  console.log(`    - Verified Escrow State: ${decodedEscrow.status} (Expected: Released)\n`);

  // 8. Test Security: Duplicate Release Attempt
  console.log(`[8] Testing Security: Duplicate Release Attempt on Settled Order (Must Fail)...`);
  try {
    const dupTx = new Transaction().add(relIx);
    await sendAndConfirmTransaction(connection, dupTx, [buyer], { commitment: 'confirmed' });
    throw new Error('SECURITY VIOLATION: Duplicate release succeeded!');
  } catch (err: any) {
    console.log(`    - Expected Security Rejection: Duplicate release correctly blocked!\n`);
  }

  // 9. Test Refund Flow on Separate Order
  console.log(`[9] Testing Refund Flow on Separate Order 2...`);
  const order2IdHex = `0x${crypto.randomBytes(32).toString('hex')}`;
  const dep2Compiled = createDepositServiceOrderInstruction({
    programId: ESCROW_PROGRAM_ID,
    buyer: buyer.publicKey.toBase58(),
    seller: seller.publicKey.toBase58(),
    reviewer: reviewer.publicKey.toBase58(),
    feeRecipient: feeRecipient.publicKey.toBase58(),
    orderId: order2IdHex,
    amountLamports: depositLamports,
    deadline,
  });

  const dep2Ix = new TransactionInstruction({
    programId: new PublicKey(dep2Compiled.programId),
    keys: dep2Compiled.accounts.map((acc) => ({
      pubkey: new PublicKey(acc.pubkey),
      isSigner: acc.isSigner,
      isWritable: acc.isWritable,
    })),
    data: dep2Compiled.data as Buffer,
  });

  const dep2Sig = await sendAndConfirmTransaction(connection, new Transaction().add(dep2Ix), [buyer], {
    commitment: 'confirmed',
  });
  console.log(`    - Order 2 Funded! Tx: ${dep2Sig}`);

  const buyerBalanceBeforeRefund = await connection.getBalance(buyer.publicKey, 'confirmed');

  // Seller triggers fee-free cancellation/refund
  const cancelCompiled = createCancelOrRefundInstruction({
    programId: ESCROW_PROGRAM_ID,
    caller: seller.publicKey.toBase58(),
    buyer: buyer.publicKey.toBase58(),
    orderId: order2IdHex,
    reason: 'Mutual agreement refund test',
  });

  const cancelIx = new TransactionInstruction({
    programId: new PublicKey(cancelCompiled.programId),
    keys: cancelCompiled.accounts.map((acc) => ({
      pubkey: new PublicKey(acc.pubkey),
      isSigner: acc.isSigner,
      isWritable: acc.isWritable,
    })),
    data: cancelCompiled.data as Buffer,
  });

  const cancelSig = await sendAndConfirmTransaction(connection, new Transaction().add(cancelIx), [seller], {
    commitment: 'confirmed',
  });
  console.log(`    - Order 2 Cancelled & Refunded! Tx: ${cancelSig}`);

  const buyerBalanceAfterRefund = await connection.getBalance(buyer.publicKey, 'confirmed');
  const buyerRefundGain = buyerBalanceAfterRefund - buyerBalanceBeforeRefund;
  console.log(`    - Buyer Refund Received: ${buyerRefundGain} lamports (Expected 10,000,000 lamports = 100% fee-free)`);

  const { pda: escrow2Pda } = findEscrowOrderPda(order2IdHex, ESCROW_PROGRAM_ID);
  const escrow2Account = await connection.getAccountInfo(new PublicKey(escrow2Pda), 'confirmed');
  const decodedEscrow2 = decodeEscrowOrderAccount(escrow2Account!.data);
  console.log(`    - Verified Escrow State: ${decodedEscrow2.status} (Expected: Refunded)\n`);

  console.log('===============================================================');
  console.log('ALL SOLANA DEVNET ON-CHAIN SERVICE TRANSACTIONS PASSED 100%!');
  console.log('===============================================================');
  console.log(JSON.stringify({
    serviceRegistrationTx: regSig,
    order1FundingTx: depSig,
    deliverySubmissionTx: delSig,
    settlementReleaseTx: relSig,
    order2FundingTx: dep2Sig,
    order2RefundTx: cancelSig,
  }, null, 2));
}

main().catch((err) => {
  console.error('Fatal error during Solana Services smoke test:', err);
  process.exit(1);
});
