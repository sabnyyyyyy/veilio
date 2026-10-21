/**
 * Creates (or, with --update, rotates) the global config PDAs of the upgraded Solana programs:
 *   - veilio-auction         AuctionConfig [b"auction_config"]: admin, reviewer
 *   - veilio-service-escrow  EscrowConfig  [b"escrow_config"]:  admin, reviewer, fee_recipient, fee_bps
 *
 * initialize_config can only be signed by each program's upgrade authority, so run this with the
 * same keypair that ran `anchor upgrade` / `solana program deploy`, right after the upgrade:
 * until the config exists the upgraded programs reject deposit / resolve_dispute /
 * create_auction / review_refund.
 *
 * Usage:
 *   SOLANA_REVIEWER=<pubkey> SOLANA_FEE_RECIPIENT=<pubkey> [SOLANA_FEE_BPS=850] \
 *   [ANCHOR_WALLET=~/.config/solana/id.json] [SOLANA_RPC_URL=https://api.devnet.solana.com] \
 *   npx ts-node --project tsconfig.hardhat.json scripts/init-solana-configs.ts [--dry-run] [--update] [--only=auction|escrow]
 *
 * The secret key is only read to sign; it is never printed.
 */
import fs from "fs";
import os from "os";
import path from "path";
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  DEFAULT_SOLANA_AUCTION_PROGRAM_ID,
  createInitializeAuctionConfigInstruction,
  createInitializeAuctionFeeConfigInstruction,
  createUpdateAuctionFeeConfigInstruction,
  createUpdateAuctionConfigInstruction,
  decodeAuctionConfigAccount,
  decodeAuctionFeeConfigAccount,
  findAuctionConfigPda,
  findAuctionFeeConfigPda,
} from "../lib/cross-chain/solanaAuction";
import {
  DEFAULT_SOLANA_SERVICE_ESCROW_PROGRAM_ID,
  DEFAULT_SOLANA_SERVICE_FEE_RECIPIENT,
  MAX_FEE_BPS,
  createInitializeEscrowConfigInstruction,
  createUpdateEscrowConfigInstruction,
  decodeEscrowConfigAccount,
  findEscrowConfigPda,
} from "../lib/cross-chain/solanaServiceEscrow";
import { findProgramDataPda, type SolanaCompiledInstruction } from "../lib/cross-chain/solanaServiceRegistry";

const DEFAULT_RPC = "https://api.devnet.solana.com";

interface Options {
  dryRun: boolean;
  update: boolean;
  only: "auction" | "escrow" | null;
}

function parseArgs(argv: string[]): Options {
  const options: Options = { dryRun: false, update: false, only: null };
  for (const arg of argv) {
    if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--update") options.update = true;
    else if (arg === "--only=auction" || arg === "--only=escrow") options.only = arg.slice("--only=".length) as Options["only"];
    else if (arg === "--help" || arg === "-h") {
      console.log("Usage: init-solana-configs.ts [--dry-run] [--update] [--only=auction|escrow]");
      process.exit(0);
    } else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

function expandHome(p: string): string {
  if (p === "~") return os.homedir();
  if (p.startsWith("~/") || p.startsWith("~\\")) return path.join(os.homedir(), p.slice(2));
  return p;
}

function loadKeypair(): { keypair: Keypair; file: string } {
  const file = path.resolve(expandHome(process.env.ANCHOR_WALLET || path.join(os.homedir(), ".config", "solana", "id.json")));
  if (!fs.existsSync(file)) throw new Error(`Upgrade-authority keypair not found at ${file} (set ANCHOR_WALLET).`);
  let bytes: unknown;
  try {
    bytes = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    throw new Error(`Keypair file ${file} is not a JSON byte array (solana-keygen format).`);
  }
  if (!Array.isArray(bytes) || bytes.length !== 64) throw new Error(`Keypair file ${file} must contain a 64-byte JSON array.`);
  return { keypair: Keypair.fromSecretKey(Uint8Array.from(bytes as number[])), file };
}

function requirePubkey(name: string): string {
  const value = (process.env[name] || "").trim();
  if (!value) throw new Error(`${name} is required (base58 Solana public key). Refusing to continue.`);
  try {
    const key = new PublicKey(value);
    if (key.equals(PublicKey.default)) throw new Error("default key");
    return key.toBase58();
  } catch {
    throw new Error(`${name} is not a valid, non-default Solana public key: ${value}`);
  }
}

function parseFeeBps(): number {
  const raw = (process.env.SOLANA_FEE_BPS ?? "850").trim();
  const bps = Number(raw);
  if (!/^\d+$/.test(raw) || !Number.isInteger(bps) || bps < 0 || bps > MAX_FEE_BPS) {
    throw new Error(`SOLANA_FEE_BPS must be an integer between 0 and ${MAX_FEE_BPS} (got "${raw}").`);
  }
  return bps;
}

/** ProgramData layout: u32 tag (3) | u64 slot | Option<Pubkey> upgrade authority. */
function decodeUpgradeAuthority(data: Buffer): string | null {
  if (data.length < 4 + 8 + 1 || data.readUInt32LE(0) !== 3) throw new Error("Not a ProgramData account");
  if (data[12] === 0) return null;
  return new PublicKey(data.subarray(13, 45)).toBase58();
}

async function checkProgram(connection: Connection, label: string, programId: string, admin: string): Promise<void> {
  const program = await connection.getAccountInfo(new PublicKey(programId), "confirmed");
  if (!program || !program.executable) throw new Error(`${label} program ${programId} is not deployed on this cluster.`);
  const programData = findProgramDataPda(programId).pda;
  const info = await connection.getAccountInfo(new PublicKey(programData), "confirmed");
  if (!info) throw new Error(`${label} ProgramData account ${programData} not found (is the program upgradeable?).`);
  const authority = decodeUpgradeAuthority(Buffer.from(info.data));
  console.log(`  program:            ${programId}`);
  console.log(`  program data:       ${programData}`);
  console.log(`  upgrade authority:  ${authority ?? "(none - immutable)"}`);
  if (authority !== admin) {
    console.warn(`  WARNING: signer ${admin} is not the upgrade authority; initialize_config will be rejected.`);
  }
}

function toWeb3(ix: SolanaCompiledInstruction): TransactionInstruction {
  return new TransactionInstruction({
    programId: new PublicKey(ix.programId),
    keys: ix.accounts.map((a) => ({ pubkey: new PublicKey(a.pubkey), isSigner: a.isSigner, isWritable: a.isWritable })),
    data: Buffer.from(ix.data),
  });
}

function printPlan(action: string, ix: SolanaCompiledInstruction): void {
  console.log(`  plan: ${action}`);
  for (const a of ix.accounts) {
    console.log(`    ${a.pubkey}${a.isSigner ? " [signer]" : ""}${a.isWritable ? " [writable]" : ""}`);
  }
}

async function send(
  connection: Connection,
  admin: Keypair,
  label: string,
  ix: SolanaCompiledInstruction,
  cluster: string,
): Promise<string> {
  const tx = new Transaction().add(toWeb3(ix));
  tx.feePayer = admin.publicKey;
  // Simulate first so a not-yet-upgraded program (unknown instruction) fails with readable logs.
  const latest = await connection.getLatestBlockhash("confirmed");
  tx.recentBlockhash = latest.blockhash;
  const sim = await connection.simulateTransaction(tx, [admin]);
  if (sim.value.err) {
    console.error(`  simulation failed: ${JSON.stringify(sim.value.err)}`);
    for (const line of sim.value.logs || []) console.error(`    ${line}`);
    throw new Error(`${label}: simulation failed. Was the program upgraded with the new build?`);
  }
  const signature = await sendAndConfirmTransaction(connection, new Transaction().add(toWeb3(ix)), [admin], {
    commitment: "confirmed",
  });
  console.log(`  tx signature: ${signature}`);
  console.log(`  explorer:     https://explorer.solana.com/tx/${signature}${cluster}`);
  return signature;
}

function warnIfDiffers(label: string, expected: string, envName: string, envValue?: string): void {
  const value = (envValue || "").trim();
  if (value && value !== expected) {
    console.warn(`  WARNING: ${envName} (${value}) differs from the ${label} being written (${expected}). Update the app env to match.`);
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const rpcUrl = (process.env.SOLANA_RPC_URL || DEFAULT_RPC).trim();
  const cluster = rpcUrl.includes("devnet") ? "?cluster=devnet" : rpcUrl.includes("testnet") ? "?cluster=testnet" : "";
  const reviewer = requirePubkey("SOLANA_REVIEWER");
  const feeRecipient = requirePubkey("SOLANA_FEE_RECIPIENT");
  const feeBps = parseFeeBps();
  const { keypair: admin, file } = loadKeypair();
  const adminKey = admin.publicKey.toBase58();
  const auctionProgramId = process.env.NEXT_PUBLIC_SOLANA_AUCTION_PROGRAM_ID || DEFAULT_SOLANA_AUCTION_PROGRAM_ID;
  const escrowProgramId = process.env.NEXT_PUBLIC_SOLANA_SERVICE_ESCROW_PROGRAM_ID || DEFAULT_SOLANA_SERVICE_ESCROW_PROGRAM_ID;

  if (reviewer === adminKey) {
    console.warn("WARNING: SOLANA_REVIEWER equals the upgrade-authority wallet. Prefer a dedicated reviewer wallet.");
  }

  console.log(`RPC:            ${rpcUrl}`);
  console.log(`Admin (signer): ${adminKey}  (keypair file: ${file})`);
  console.log(`Reviewer:       ${reviewer}`);
  console.log(`Fee recipient:  ${feeRecipient}`);
  console.log(`Fee bps:        ${feeBps}`);
  console.log(`Mode:           ${options.dryRun ? "dry run (no transactions)" : "live"}${options.update ? ", --update" : ""}`);

  const connection = new Connection(rpcUrl, "confirmed");
  const signatures: string[] = [];

  if (options.only !== "escrow") {
    console.log("\n[veilio-auction] AuctionConfig");
    await checkProgram(connection, "veilio-auction", auctionProgramId, adminKey);
    warnIfDiffers("reviewer", reviewer, "NEXT_PUBLIC_SOLANA_AUCTION_REVIEWER", process.env.NEXT_PUBLIC_SOLANA_AUCTION_REVIEWER);
    const configPda = findAuctionConfigPda(auctionProgramId).pda;
    console.log(`  config PDA:         ${configPda}`);
    const account = await connection.getAccountInfo(new PublicKey(configPda), "confirmed");
    let ix: SolanaCompiledInstruction | null = null;
    let action = "";
    if (account && account.data.length > 0) {
      if (account.owner.toBase58() !== auctionProgramId) throw new Error(`Auction config PDA is owned by ${account.owner.toBase58()}, not the program.`);
      const current = decodeAuctionConfigAccount(account.data);
      console.log(`  exists: admin=${current.admin} reviewer=${current.reviewer} bump=${current.bump}`);
      if (!options.update) {
        console.log("  skip (already initialized; pass --update to change it)");
      } else if (current.reviewer === reviewer) {
        console.log("  skip (already up to date)");
      } else {
        if (current.admin !== adminKey) throw new Error(`Auction config admin is ${current.admin}; signer ${adminKey} cannot update it.`);
        ix = createUpdateAuctionConfigInstruction({ programId: auctionProgramId, admin: adminKey, reviewer, newAdmin: current.admin });
        action = `update_config(reviewer=${reviewer}, new_admin=${current.admin})`;
      }
    } else {
      ix = createInitializeAuctionConfigInstruction({ programId: auctionProgramId, admin: adminKey, reviewer });
      action = `initialize_config(reviewer=${reviewer})`;
    }
    if (ix) {
      printPlan(action, ix);
      if (!options.dryRun) signatures.push(await send(connection, admin, "veilio-auction", ix, cluster));
    }

    const feeConfigPda = findAuctionFeeConfigPda(auctionProgramId).pda;
    const feeConfigAccount = await connection.getAccountInfo(new PublicKey(feeConfigPda), "confirmed");
    let feeIx: SolanaCompiledInstruction | null = null;
    let feeAction = "";
    if (feeConfigAccount?.data.length) {
      if (feeConfigAccount.owner.toBase58() !== auctionProgramId) throw new Error(`Auction fee config PDA is owned by ${feeConfigAccount.owner.toBase58()}, not the program.`);
      const current = decodeAuctionFeeConfigAccount(feeConfigAccount.data);
      console.log(`  fee config:         admin=${current.admin} fee_recipient=${current.feeRecipient}`);
      if (current.feeRecipient === feeRecipient) {
        console.log("  fee config skip (already configured)");
      } else {
        if (current.admin !== adminKey) throw new Error(`Auction fee config admin is ${current.admin}; signer ${adminKey} cannot update it.`);
        feeIx = createUpdateAuctionFeeConfigInstruction({ programId: auctionProgramId, admin: adminKey, feeRecipient });
        feeAction = `update_fee_config(fee_recipient=${feeRecipient})`;
      }
    } else {
      feeIx = createInitializeAuctionFeeConfigInstruction({ programId: auctionProgramId, admin: adminKey, feeRecipient });
      feeAction = `initialize_fee_config(fee_recipient=${feeRecipient})`;
    }
    if (feeIx) {
      printPlan(feeAction, feeIx);
      if (!options.dryRun) signatures.push(await send(connection, admin, "veilio-auction", feeIx, cluster));
    }
  }

  if (options.only !== "auction") {
    console.log("\n[veilio-service-escrow] EscrowConfig");
    await checkProgram(connection, "veilio-service-escrow", escrowProgramId, adminKey);
    warnIfDiffers("reviewer", reviewer, "NEXT_PUBLIC_SOLANA_SERVICE_REVIEWER", process.env.NEXT_PUBLIC_SOLANA_SERVICE_REVIEWER);
    // The app builds release_funds / resolve_dispute with this fee recipient; it must match the order's.
    warnIfDiffers("fee recipient", feeRecipient, "NEXT_PUBLIC_SOLANA_FEE_RECIPIENT", process.env.NEXT_PUBLIC_SOLANA_FEE_RECIPIENT || DEFAULT_SOLANA_SERVICE_FEE_RECIPIENT);
    const configPda = findEscrowConfigPda(escrowProgramId).pda;
    console.log(`  config PDA:         ${configPda}`);
    const account = await connection.getAccountInfo(new PublicKey(configPda), "confirmed");
    let ix: SolanaCompiledInstruction | null = null;
    let action = "";
    if (account && account.data.length > 0) {
      if (account.owner.toBase58() !== escrowProgramId) throw new Error(`Escrow config PDA is owned by ${account.owner.toBase58()}, not the program.`);
      const current = decodeEscrowConfigAccount(account.data);
      console.log(
        `  exists: admin=${current.admin} reviewer=${current.reviewer} fee_recipient=${current.feeRecipient} fee_bps=${current.feeBasisPoints} bump=${current.bump}`,
      );
      if (!options.update) {
        console.log("  skip (already initialized; pass --update to change it)");
      } else if (current.reviewer === reviewer && current.feeRecipient === feeRecipient && current.feeBasisPoints === feeBps) {
        console.log("  skip (already up to date)");
      } else {
        if (current.admin !== adminKey) throw new Error(`Escrow config admin is ${current.admin}; signer ${adminKey} cannot update it.`);
        ix = createUpdateEscrowConfigInstruction({
          programId: escrowProgramId,
          admin: adminKey,
          reviewer,
          feeRecipient,
          feeBasisPoints: feeBps,
          newAdmin: current.admin,
        });
        action = `update_config(reviewer=${reviewer}, fee_recipient=${feeRecipient}, fee_bps=${feeBps}, new_admin=${current.admin})`;
      }
    } else {
      ix = createInitializeEscrowConfigInstruction({
        programId: escrowProgramId,
        admin: adminKey,
        reviewer,
        feeRecipient,
        feeBasisPoints: feeBps,
      });
      action = `initialize_config(reviewer=${reviewer}, fee_recipient=${feeRecipient}, fee_bps=${feeBps})`;
    }
    if (ix) {
      printPlan(action, ix);
      if (!options.dryRun) signatures.push(await send(connection, admin, "veilio-service-escrow", ix, cluster));
    }
  }

  console.log(
    options.dryRun
      ? "\nDry run complete: no transactions were sent."
      : `\nDone. ${signatures.length} transaction(s) sent${signatures.length ? `: ${signatures.join(", ")}` : ""}.`,
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
