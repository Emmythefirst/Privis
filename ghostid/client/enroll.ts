/**
 * client/enroll.ts
 *
 * Full enrollment flow for GhostID on Arcium/Solana devnet.
 */

import * as anchor from "@coral-xyz/anchor";
import { Program, AnchorProvider, Idl } from "@coral-xyz/anchor";
import { PublicKey, Keypair } from "@solana/web3.js";
import {
  awaitComputationFinalization,
  getArciumEnv,
  getCompDefAccOffset,
  getArciumAccountBaseSeed,
  getArciumProgramId,
  getArciumProgram,
  uploadCircuit,
  getMXEPublicKey,
  getMXEAccAddress,
  getMempoolAccAddress,
  getCompDefAccAddress,
  getExecutingPoolAccAddress,
  getComputationAccAddress,
  getClusterAccAddress,
  getLookupTableAddress,
  deserializeLE,
} from "@arcium-hq/client";
import { randomBytes } from "crypto";
import * as fs from "fs";
import { prepareEnrollment } from "./biometric";

export interface EnrollResult {
  biometricAccount: PublicKey;
  enrollSig: string;
  finalizeSig: string;
  enrolled: boolean;
  sharedSecret: Uint8Array;
  enrollNonce: Uint8Array;
}

// ─────────────────────────────────────────────────────────────────────────────
// Comp def initialization
// ─────────────────────────────────────────────────────────────────────────────

export async function initStoreCompDefIfNeeded(
  program: Program<Idl>,
  provider: AnchorProvider,
  payer: Keypair,
): Promise<void> {
  const arciumProgram = getArciumProgram(provider);
  const compDefOffset = Buffer.from(
    getCompDefAccOffset("store_biometric"),
  ).readUInt32LE();
  const compDefAccount = getCompDefAccAddress(program.programId, compDefOffset);
  const existing = await provider.connection.getAccountInfo(compDefAccount);
  if (existing) {
    console.log("store_biometric comp def already exists, skipping...");
    return;
  }

  const baseSeed = getArciumAccountBaseSeed("ComputationDefinitionAccount");
  const offset = getCompDefAccOffset("store_biometric");
  const compDefPDA = PublicKey.findProgramAddressSync(
    [baseSeed, program.programId.toBuffer(), offset],
    getArciumProgramId(),
  )[0];

  const mxeAccount = getMXEAccAddress(program.programId);
  const mxeAcc = await arciumProgram.account.mxeAccount.fetch(mxeAccount);
  const lutAddress = getLookupTableAddress(program.programId, mxeAcc.lutOffsetSlot);

  console.log("Initializing store_biometric comp def...");
  await (program as any).methods
    .initStoreBiometricCompDef()
    .accounts({
      compDefAccount: compDefPDA,
      payer: payer.publicKey,
      mxeAccount,
      addressLookupTable: lutAddress,
    })
    .signers([payer])
    .rpc({ commitment: "confirmed" });

  const rawCircuit = fs.readFileSync("build/store_biometric.arcis");
  console.log(`Uploading store_biometric circuit (${rawCircuit.length} bytes)...`);
  await uploadCircuit(
    provider,
    "store_biometric",
    program.programId,
    rawCircuit,
    true,
    5,
    { skipPreflight: true, preflightCommitment: "confirmed", commitment: "confirmed" },
  );
  console.log("store_biometric circuit uploaded and finalized.");
}

export async function initMatchCompDefIfNeeded(
  program: Program<Idl>,
  provider: AnchorProvider,
  payer: Keypair,
): Promise<void> {
  const arciumProgram = getArciumProgram(provider);
  const compDefOffset = Buffer.from(
    getCompDefAccOffset("match_biometric"),
  ).readUInt32LE();
  const compDefAccount = getCompDefAccAddress(program.programId, compDefOffset);
  const existing = await provider.connection.getAccountInfo(compDefAccount);
  if (existing) {
    console.log("match_biometric comp def already exists, skipping...");
    return;
  }

  const baseSeed = getArciumAccountBaseSeed("ComputationDefinitionAccount");
  const offset = getCompDefAccOffset("match_biometric");
  const compDefPDA = PublicKey.findProgramAddressSync(
    [baseSeed, program.programId.toBuffer(), offset],
    getArciumProgramId(),
  )[0];

  const mxeAccount = getMXEAccAddress(program.programId);
  const mxeAcc = await arciumProgram.account.mxeAccount.fetch(mxeAccount);
  const lutAddress = getLookupTableAddress(program.programId, mxeAcc.lutOffsetSlot);

  console.log("Initializing match_biometric comp def...");
  await (program as any).methods
    .initMatchBiometricCompDef()
    .accounts({
      compDefAccount: compDefPDA,
      payer: payer.publicKey,
      mxeAccount,
      addressLookupTable: lutAddress,
    })
    .signers([payer])
    .rpc({ commitment: "confirmed" });

  const rawCircuit = fs.readFileSync("build/match_biometric.arcis");
  console.log(`Uploading match_biometric circuit (${rawCircuit.length} bytes)...`);
  await uploadCircuit(
    provider,
    "match_biometric",
    program.programId,
    rawCircuit,
    true,
    5,
    { skipPreflight: true, preflightCommitment: "confirmed", commitment: "confirmed" },
  );
  console.log("match_biometric circuit uploaded and finalized.");
}

// ─────────────────────────────────────────────────────────────────────────────
// Enrollment
// ─────────────────────────────────────────────────────────────────────────────

export async function enroll(
  embedding: Float32Array,
  program: Program<Idl>,
  provider: AnchorProvider,
  payer: Keypair,
): Promise<EnrollResult> {
  const arciumEnv = getArciumEnv();

  const mxePublicKey = await getMXEPublicKey(provider, program.programId);
  const encrypted = prepareEnrollment(embedding, mxePublicKey);
  console.log("Biometric encrypted — 8 ciphertexts ready.");

  const [biometricAccount] = PublicKey.findProgramAddressSync(
    [Buffer.from("biometric"), payer.publicKey.toBuffer()],
    program.programId,
  );
  console.log("BiometricAccount PDA:", biometricAccount.toString());

  const compDefOffset = Buffer.from(
    getCompDefAccOffset("store_biometric"),
  ).readUInt32LE();
  const computationOffset = new anchor.BN(randomBytes(8), "hex");

  const tx = await (program as any).methods
    .enroll(
      computationOffset,
      Array.from(encrypted.ciphertexts[0]),
      Array.from(encrypted.ciphertexts[1]),
      Array.from(encrypted.ciphertexts[2]),
      Array.from(encrypted.ciphertexts[3]),
      Array.from(encrypted.ciphertexts[4]),
      Array.from(encrypted.ciphertexts[5]),
      Array.from(encrypted.ciphertexts[6]),
      Array.from(encrypted.ciphertexts[7]),
      Array.from(encrypted.ephemeralPublicKey),
      new anchor.BN(deserializeLE(encrypted.nonce).toString()),
    )
    .accountsPartial({
      payer: payer.publicKey,
      biometricAccount,
      computationAccount: getComputationAccAddress(
        arciumEnv.arciumClusterOffset,
        computationOffset,
      ),
      clusterAccount: getClusterAccAddress(arciumEnv.arciumClusterOffset),
      mxeAccount: getMXEAccAddress(program.programId),
      mempoolAccount: getMempoolAccAddress(arciumEnv.arciumClusterOffset),
      executingPool: getExecutingPoolAccAddress(arciumEnv.arciumClusterOffset),
      compDefAccount: getCompDefAccAddress(program.programId, compDefOffset),
    })
    .transaction();

  console.log("Sending enroll tx...");
  const { blockhash, lastValidBlockHeight } =
    await provider.connection.getLatestBlockhash("confirmed");
  tx.recentBlockhash = blockhash;
  tx.lastValidBlockHeight = lastValidBlockHeight;
  tx.feePayer = payer.publicKey;

  const signedTx = await provider.wallet.signTransaction(tx);
  const enrollSig = await provider.connection.sendRawTransaction(
    signedTx.serialize(),
    { skipPreflight: true },
  );
  await provider.connection.confirmTransaction(
    { signature: enrollSig, blockhash, lastValidBlockHeight },
    "confirmed",
  );
  console.log("Enroll sig:", enrollSig);

  console.log("Awaiting store_biometric MPC finalization (up to 10 min)...");
  const finalizeSig = await awaitComputationFinalization(
    provider,
    computationOffset,
    program.programId,
    "confirmed",
    1800000,
  );
  console.log("Finalize sig:", finalizeSig);

  const enrolled = await parseBiometricEnrolledEvent(
    finalizeSig,
    program,
    provider,
  );

  return { biometricAccount, enrollSig, finalizeSig, enrolled, sharedSecret: encrypted.sharedSecret, enrollNonce: new Uint8Array(encrypted.nonce) };
}

// ─────────────────────────────────────────────────────────────────────────────
// Event parsing — AlreadyCallbackedComputation-safe (same pattern as hello_world)
// ─────────────────────────────────────────────────────────────────────────────

async function parseBiometricEnrolledEvent(
  finalizeSig: string,
  program: Program<Idl>,
  provider: AnchorProvider,
): Promise<boolean> {
  let txInfo = await provider.connection.getTransaction(finalizeSig, {
    commitment: "confirmed",
    maxSupportedTransactionVersion: 0,
  });
  let logs = txInfo?.meta?.logMessages ?? [];

  if (logs.some((l) => l.includes("AlreadyCallbackedComputation"))) {
    console.log("Got AlreadyCallbackedComputation — searching for real callback tx...");
    const sigs = await provider.connection.getSignaturesForAddress(
      program.programId,
      { limit: 30 },
      "confirmed",
    );
    for (const sigInfo of sigs) {
      if (sigInfo.signature === finalizeSig) continue;
      const candidate = await provider.connection.getTransaction(
        sigInfo.signature,
        { commitment: "confirmed", maxSupportedTransactionVersion: 0 },
      );
      const candidateLogs = candidate?.meta?.logMessages ?? [];
      if (logsHaveEnrolledEvent(candidateLogs, program)) {
        logs = candidateLogs;
        console.log("Found real callback tx:", sigInfo.signature);
        break;
      }
    }
  }

  return logsHaveEnrolledEvent(logs, program);
}

function logsHaveEnrolledEvent(logs: string[], program: Program<Idl>): boolean {
  for (const log of logs) {
    if (log.startsWith("Program data: ")) {
      try {
        const decoded = program.coder.events.decode(
          log.slice("Program data: ".length),
        );
        if (decoded?.name === "biometricEnrolledEvent") {
          console.log("BiometricEnrolledEvent:", decoded.data);
          return true;
        }
      } catch (_) {}
    }
  }
  return false;
}