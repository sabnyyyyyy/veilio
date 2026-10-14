// On-chain check of the Solana escrow `partial_refund` instruction on devnet, using the app's own
// instruction builders and server-side verification. Buyer/seller are throwaway keypair files.
//   node --env-file=.env.local node_modules/jiti/lib/jiti-cli.mjs scripts/e2e-solana-partial-refund.ts <buyer.json> <seller.json> [returnTo]
// The deposit is refunded at the end; pass returnTo to sweep the test wallets' SOL back afterwards.
import fs from 'fs';
import { Connection, Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction } from '@solana/web3.js';
import {
  createCancelOrRefundInstruction,
  createDepositServiceOrderInstruction,
  createPartialRefundInstruction,
  decodeEscrowOrderAccount,
  findEscrowOrderPda,
  getSolanaServiceEscrowProgramId,
  getSolanaServiceFeeRecipient,
  getSolanaServiceReviewer,
  toSolanaEscrowOrderIdHex,
} from '../lib/cross-chain/solanaServiceEscrow';
import { verifySolanaEscrowTransaction } from '../lib/server/solanaServiceVerification';

const RPC = process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com';
const conn = new Connection(RPC, 'confirmed');
const programId = getSolanaServiceEscrowProgramId();

const load = (file: string) => Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(file, 'utf8'))));

function check(label: string, ok: boolean, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
  if (!ok) process.exitCode = 1;
  return ok;
}

async function send(ix: { programId: string; keys: Array<{ pubkey: string; isSigner: boolean; isWritable: boolean }>; data: Buffer }, signer: Keypair) {
  const tx = new Transaction().add(new TransactionInstruction({
    programId: new PublicKey(ix.programId),
    keys: ix.keys.map((k) => ({ pubkey: new PublicKey(k.pubkey), isSigner: k.isSigner, isWritable: k.isWritable })),
    data: ix.data,
  }));
  tx.feePayer = signer.publicKey;
  tx.recentBlockhash = (await conn.getLatestBlockhash('confirmed')).blockhash;
  tx.sign(signer);
  const sig = await conn.sendRawTransaction(tx.serialize());
  const res = await conn.confirmTransaction(sig, 'confirmed');
  if (res.value.err) throw new Error(`tx ${sig} failed: ${JSON.stringify(res.value.err)}`);
  return sig;
}

async function expectFailure(label: string, run: () => Promise<unknown>) {
  try {
    await run();
    check(label, false, 'transaction unexpectedly succeeded');
  } catch (err: any) {
    check(label, true, String(err?.message || err).split('\n')[0].slice(0, 90));
  }
}

async function escrowAmount(orderIdHex: string) {
  const info = await conn.getAccountInfo(new PublicKey(findEscrowOrderPda(orderIdHex, programId).pda), 'confirmed');
  return decodeEscrowOrderAccount(info!.data);
}

async function main() {
  const [buyerFile, sellerFile, returnTo] = process.argv.slice(2);
  if (!buyerFile || !sellerFile) throw new Error('Usage: e2e-solana-partial-refund.ts <buyer.json> <seller.json> [returnTo]');
  const buyer = load(buyerFile);
  const seller = load(sellerFile);
  const reviewer = getSolanaServiceReviewer();
  if (!reviewer) throw new Error('NEXT_PUBLIC_SOLANA_SERVICE_REVIEWER is not configured');

  const orderId = `e2e-sol-${Date.now().toString(36)}`;
  const orderIdHex = toSolanaEscrowOrderIdHex(orderId);
  const deposit = 10_000_000n; // 0.01 SOL
  const refund = 4_000_000n;   // 0.004 SOL
  console.log(`program ${programId}\nbuyer   ${buyer.publicKey.toBase58()}\nseller  ${seller.publicKey.toBase58()}\norder   ${orderId}\n`);

  await send(createDepositServiceOrderInstruction({
    programId,
    buyer: buyer.publicKey.toBase58(),
    seller: seller.publicKey.toBase58(),
    reviewer,
    feeRecipient: getSolanaServiceFeeRecipient(),
    orderId: orderIdHex,
    amountLamports: deposit,
    deadline: Math.floor(Date.now() / 1000) + 24 * 3600,
  }) as any, buyer);
  check('buyer deposits 0.01 SOL', (await escrowAmount(orderIdHex)).amountLamports === deposit);

  const partialIx = (signer: Keypair, amount: bigint) => createPartialRefundInstruction({
    programId,
    seller: signer.publicKey.toBase58(),
    buyer: buyer.publicKey.toBase58(),
    orderId: orderIdHex,
    refundLamports: amount,
    reason: 'Agreed lower price',
  }) as any;

  await expectFailure('program rejects the buyer as signer', () => send(partialIx(buyer, refund), buyer));
  await expectFailure('program rejects refunding the full amount', () => send(partialIx(seller, deposit), seller));

  const buyerBefore = BigInt(await conn.getBalance(buyer.publicKey, 'confirmed'));
  const sig = await send(partialIx(seller, refund), seller);
  const buyerAfter = BigInt(await conn.getBalance(buyer.publicKey, 'confirmed'));
  check('buyer receives 0.004 SOL', buyerAfter - buyerBefore === refund, sig);

  const escrow = await escrowAmount(orderIdHex);
  check('escrow keeps 0.006 SOL and stays Funded', escrow.amountLamports === deposit - refund && escrow.status === 'Funded', `${escrow.amountLamports} lamports, ${escrow.status}`);

  const verification = await verifySolanaEscrowTransaction({
    signature: sig,
    expectation: {
      orderId: orderIdHex,
      buyer: buyer.publicKey.toBase58(),
      seller: seller.publicKey.toBase58(),
      allowedStatuses: ['Funded', 'Delivered'],
      requiredSigner: seller.publicKey.toBase58(),
      instruction: 'partial_refund',
    },
  });
  check('server verification accepts the partial_refund tx', verification.ok, verification.ok ? `${verification.escrow.amountLamports} lamports` : verification.error);

  await send(createCancelOrRefundInstruction({
    programId,
    caller: seller.publicKey.toBase58(),
    buyer: buyer.publicKey.toBase58(),
    orderId: orderIdHex,
    reason: 'e2e cleanup',
  }) as any, seller);
  check('cleanup refund of the remainder', (await escrowAmount(orderIdHex)).status === 'Refunded');

  if (returnTo) {
    for (const kp of [buyer, seller]) {
      const bal = await conn.getBalance(kp.publicKey, 'confirmed');
      const tx = new Transaction().add(SystemProgram.transfer({ fromPubkey: kp.publicKey, toPubkey: new PublicKey(returnTo), lamports: bal - 5000 }));
      tx.feePayer = kp.publicKey;
      tx.recentBlockhash = (await conn.getLatestBlockhash('confirmed')).blockhash;
      tx.sign(kp);
      await conn.confirmTransaction(await conn.sendRawTransaction(tx.serialize()), 'confirmed');
    }
    console.log(`swept test wallets back to ${returnTo}`);
  }
}

main().catch((e) => {
  console.error('FAILED:', e?.message || e);
  process.exit(1);
});
