/**
 * client/verify.ts
 *
 * Verify (match) flow for GhostID.
 *
 * The match_biometric circuit expects all 16 fields (8 template + 8 probe)
 * encrypted under a SINGLE key+nonce. The stored template was encrypted with
 * the enrollment key, so we:
 *   1. Decrypt the stored template using the enrollment shared secret
 *   2. Pack the probe embedding
 *   3. Re-encrypt [template..., probe...] together under a fresh key
 *   4. Send all 16 ciphertexts explicitly to the updated verify() instruction
 *   5. Decrypt the result with the same fresh key
 */

import * as anchor from "@coral-xyz/anchor";
import { Program, AnchorProvider, Idl } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import {
  getMXEPublicKey,
  getMXEAccAddress,
  getMempoolAccAddress,
  getCompDefAccAddress,
  getExecutingPoolAccAddress,
  getComputationAccAddress,
  getClusterAccAddress,
  deserializeLE,
  RescueCipher,
  x25519,
} from "@arcium-hq/client";
// Web Crypto API used instead of Node crypto
import { embeddingToPacked } from "./biometric";

async function pollComputationFinalization(
  provider: AnchorProvider,
  computationOffset: anchor.BN,
  program: Program<Idl>,
  timeoutMs: number = 1800000,
): Promise<string> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    await new Promise(r => setTimeout(r, 3000));
    try {
      const sigs = await provider.connection.getSignaturesForAddress(
        program.programId, { limit: 20 }, "confirmed"
      );
      for (const s of sigs) {
        const tx = await provider.connection.getTransaction(s.signature, {
          commitment: "confirmed",
          maxSupportedTransactionVersion: 0,
        });
        const logs = tx?.meta?.logMessages ?? [];
        const found = extractMatchEvent(logs, program);
        if (found) {
          return s.signature;
        }
      }
    } catch (_) {}
  }
  throw new Error("Computation did not finalize within timeout");
}

export const MATCH_THRESHOLD = 4000;

export interface VerifyResult {
  verifySig: string;
  finalizeSig: string;
  decryptedDistance: bigint;
  matched: boolean;
}

/**
 * @param probeEmbedding      Float32Array (128-dim)
 * @param subjectPubkey       Wallet of the enrolled subject
 * @param enrollSharedSecret  From EnrollResult — used to decrypt stored template
 * @param enrollNonce         From EnrollResult — 16-byte nonce used during enrollment
 */
export async function verify(
  probeEmbedding: Float32Array,
  subjectPubkey: PublicKey,
  enrollSharedSecret: Uint8Array,
  enrollNonce: Uint8Array,
  program: Program<Idl>,
  provider: AnchorProvider,
  payerKey: PublicKey,
): Promise<VerifyResult> {
    const mxePublicKey = await getMXEPublicKey(provider, program.programId);

  // ── 1. Fetch stored template ciphertexts from BiometricAccount ────────────
  const [biometricAccount] = PublicKey.findProgramAddressSync(
    [Buffer.from("biometric"), subjectPubkey.toBuffer()],
    program.programId,
  );
  console.log("BiometricAccount PDA:", biometricAccount.toString());

  const accInfo = await (program as any).account.biometricAccount.fetch(
    biometricAccount,
  );
  const storedCiphertexts: number[][] = accInfo.bios; // [[u8;32]; 8]

  // ── 2. Decrypt stored template using enrollment shared secret ─────────────
  const enrollCipher = new RescueCipher(enrollSharedSecret);
  const templateValues: bigint[] = enrollCipher.decrypt(
    storedCiphertexts,
    enrollNonce,
  );
  console.log("Stored template decrypted — 8 u128 values.");

  // ── 3. Pack probe embedding ───────────────────────────────────────────────
  const probeValues: bigint[] = embeddingToPacked(probeEmbedding);
  console.log("Probe packed — 8 u128 values.");

  // ── 4. Re-encrypt template + probe together under a fresh shared key ──────
  const ephemeralPrivateKey = x25519.utils.randomSecretKey();
  const ephemeralPublicKey = x25519.getPublicKey(ephemeralPrivateKey);
  const sharedSecret = x25519.getSharedSecret(ephemeralPrivateKey, mxePublicKey);
  const verifyNonceArr = new Uint8Array(16);
  globalThis.crypto.getRandomValues(verifyNonceArr);
  const verifyNonce = Buffer.from(verifyNonceArr);

  const verifyCipher = new RescueCipher(sharedSecret);
  // Circuit order: tmpl0..7 then probe0..7 → encrypt all 16 together
  const allCiphertexts: number[][] = verifyCipher.encrypt(
    [...templateValues, ...probeValues],
    verifyNonce,
  );
  console.log("Template + probe re-encrypted together under fresh key.");

  // ── 5. Send verify tx with all 16 explicit ciphertexts ───────────────────
  const compDefOffset = 3958313864;
  const offsetArr = new Uint8Array(8);
  globalThis.crypto.getRandomValues(offsetArr);
  const computationOffset = new anchor.BN(Buffer.from(offsetArr).toString("hex"), "hex");

  const tmpl = allCiphertexts.slice(0, 8).map(ct => Array.from(ct));
  const probe = allCiphertexts.slice(8, 16).map(ct => Array.from(ct));

  const tx = await (program as any).methods
    .verify(
      computationOffset,
      tmpl,
      probe,
      Array.from(ephemeralPublicKey),
      new anchor.BN(deserializeLE(verifyNonce).toString()),
    )
    .accountsPartial({
      payer: payerKey,
      biometricAccount,
      subject: subjectPubkey,
      computationAccount: getComputationAccAddress(
        456,
        computationOffset,
      ),
      clusterAccount: getClusterAccAddress(456),
      mxeAccount: getMXEAccAddress(program.programId),
      mempoolAccount: getMempoolAccAddress(456),
      executingPool: getExecutingPoolAccAddress(456),
      compDefAccount: getCompDefAccAddress(program.programId, compDefOffset as any),
    })
    .transaction();

  console.log("Sending verify tx...");
  const { blockhash, lastValidBlockHeight } =
    await provider.connection.getLatestBlockhash("confirmed");
  tx.recentBlockhash = blockhash;
  tx.lastValidBlockHeight = lastValidBlockHeight;
  tx.feePayer = payerKey;

  const signedTx = await provider.wallet.signTransaction(tx);
  const verifySig = await provider.connection.sendRawTransaction(
    signedTx.serialize(),
    { skipPreflight: true },
  );
  await provider.connection.confirmTransaction(
    { signature: verifySig, blockhash, lastValidBlockHeight },
    "confirmed",
  );
  console.log("Verify sig:", verifySig);

  // ── 6. Await MPC finalization ─────────────────────────────────────────────
  console.log("Awaiting match_biometric MPC finalization (up to 10 min)...");
  const finalizeSig = await pollComputationFinalization(
    provider,
    computationOffset,
    program,
    1800000,
  );
  console.log("Finalize sig:", finalizeSig);

  // ── 7. Parse MatchResultEvent and decrypt result ──────────────────────────
  const { encryptedDistance, resultNonce } = await parseMatchResultEvent(
    finalizeSig,
    program,
    provider,
  );

  const [decryptedDistance] = verifyCipher.decrypt(
    [Array.from(encryptedDistance)],
    resultNonce,
  );

  const matched = decryptedDistance < BigInt(MATCH_THRESHOLD);
  return { verifySig, finalizeSig, decryptedDistance, matched };
}

// ─────────────────────────────────────────────────────────────────────────────
// Event parsing
// ─────────────────────────────────────────────────────────────────────────────

async function parseMatchResultEvent(
  finalizeSig: string,
  program: Program<Idl>,
  provider: AnchorProvider,
): Promise<{ encryptedDistance: Uint8Array; resultNonce: Uint8Array }> {
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
      const result = extractMatchEvent(candidateLogs, program);
      if (result) {
        console.log("Found real callback tx:", sigInfo.signature);
        return result;
      }
    }
  }

  const result = extractMatchEvent(logs, program);
  if (!result) throw new Error("MatchResultEvent not found in logs");
  return result;
}

function extractMatchEvent(
  logs: string[],
  program: Program<Idl>,
): { encryptedDistance: Uint8Array; resultNonce: Uint8Array } | null {
  for (const log of logs) {
    if (log.startsWith("Program data: ")) {
      try {
        const decoded = program.coder.events.decode(
          log.slice("Program data: ".length),
        );
        if (decoded?.name === "matchResultEvent") {
          console.log("MatchResultEvent received.");
          return {
            encryptedDistance: Uint8Array.from(decoded.data.result as number[]),
            resultNonce: Uint8Array.from(decoded.data.nonce as number[]),
          };
        }
      } catch (_) {}
    }
  }
  return null;
}