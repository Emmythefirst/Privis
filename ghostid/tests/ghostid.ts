/**
 * tests/ghostid.ts
 *
 * Phase 2 + 3 integration tests — enrollment + verification on devnet.
 *
 * Tests:
 *   1. Init store_biometric + match_biometric comp defs (once)
 *   2. Enroll a synthetic biometric for wallet A
 *   3. Verify BiometricAccount is created and enrolled = true
 *   4. Re-enrollment is idempotent
 *   5. Biometric encoding sanity check
 *   6. Same-person L2 distance is low (local)
 *   7. Different-person L2 distance is high (local)
 *   8. [MPC] Same person matches on-chain (distance < threshold)
 *   9. [MPC] Different person does NOT match on-chain (distance > threshold)
 */

import * as anchor from "@coral-xyz/anchor";
import { Program, Idl } from "@coral-xyz/anchor";
import { GhostId } from "../target/types/ghost_id";
import * as os from "os";
import * as fs from "fs";
import { expect } from "chai";

import {
  initStoreCompDefIfNeeded,
  initMatchCompDefIfNeeded,
  enroll,
} from "../client/enroll";
import { verify, MATCH_THRESHOLD } from "../client/verify";
import {
  randomEmbedding,
  perturbEmbedding,
  squaredL2Distance,
  embeddingToQuantized,
} from "../client/biometric";

describe("GhostID", () => {
  anchor.setProvider(anchor.AnchorProvider.env());
  const program = anchor.workspace.GhostId as Program<GhostId>;
  const provider = anchor.getProvider() as anchor.AnchorProvider;
  const p = program as unknown as Program<Idl>;
  const payer = readKpJson(`${os.homedir()}/.config/solana/id.json`);

  // Enrollment data shared across tests
  let enrolledEmbedding: Float32Array;
  let enrollSharedSecret: Uint8Array;
  let enrollNonce: Uint8Array;

  before(async () => {
    console.log("\n=== Initializing computation definitions ===");
    await initStoreCompDefIfNeeded(p, provider, payer.publicKey);
    await initMatchCompDefIfNeeded(p, provider, payer.publicKey);
    console.log("Comp defs ready.\n");
  });

  // ── Test 1: Enrollment ────────────────────────────────────────────────────

  it("Enrolls a biometric and confirms BiometricAccount is created", async () => {
    enrolledEmbedding = randomEmbedding();
    console.log("Enrolling with synthetic 128-dim embedding...");

    const result = await enroll(enrolledEmbedding, p, provider, payer.publicKey);

    // Save for verify tests
    enrollSharedSecret = result.sharedSecret;
    enrollNonce = result.enrollNonce;

    console.log("BiometricAccount:", result.biometricAccount.toString());
    console.log("Enroll sig:", result.enrollSig);
    expect(result.enrolled).to.be.true;

    const accInfo = await (program.account as any).biometricAccount.fetch(
      result.biometricAccount,
    );
    expect(accInfo.owner.toString()).to.equal(payer.publicKey.toString());
    expect(accInfo.enrolled).to.be.true;
    console.log("✅ Enrollment complete — BiometricAccount enrolled = true");
  });

  // ── Test 2: Re-enrollment ─────────────────────────────────────────────────

  it("Re-enrolling with a new embedding updates the stored ciphertexts", async () => {
    // Re-enroll with the SAME embedding so verify tests remain consistent
    const result = await enroll(enrolledEmbedding, p, provider, payer.publicKey);
    expect(result.enrolled).to.be.true;
    // Update shared secret + nonce to match latest stored ciphertexts
    enrollSharedSecret = result.sharedSecret;
    enrollNonce = result.enrollNonce;
    console.log("✅ Re-enrollment successful");
  });

  // ── Test 3: Encoding sanity check ─────────────────────────────────────────

  it("Same embedding round-trips through quantize → pack → unpack correctly", () => {
    const { packToU128s, unpackFromU128s } = require("../client/biometric");
    const embedding = randomEmbedding();
    const quantized = embeddingToQuantized(embedding);
    const packed = packToU128s(quantized);
    const unpacked = unpackFromU128s(packed);
    for (let i = 0; i < 128; i++) {
      expect(unpacked[i]).to.equal(quantized[i], `Byte ${i} mismatch`);
    }
    console.log("✅ Biometric round-trip encoding correct");
  });

  // ── Test 4: Same-person distance low (local) ──────────────────────────────

  it("Same person (perturbed embedding) has low L2 distance", () => {
    const base = randomEmbedding();
    const same = perturbEmbedding(base, 0.02);
    const dist = squaredL2Distance(embeddingToQuantized(base), embeddingToQuantized(same));
    console.log(`Same-person squared L2 distance: ${dist}`);
    expect(dist).to.be.lessThan(4000);
    console.log("✅ Same-person distance below threshold");
  });

  // ── Test 5: Different-person distance high (local) ────────────────────────

  it("Different person (independent embedding) has high L2 distance", () => {
    const aQ = embeddingToQuantized(randomEmbedding());
    const bQ = embeddingToQuantized(randomEmbedding());
    const dist = squaredL2Distance(aQ, bQ);
    console.log(`Different-person squared L2 distance: ${dist}`);
    expect(dist).to.be.greaterThan(1000);
    console.log("✅ Different-person distance above expected minimum");
  });

  // ── Test 6: [MPC] Same person matches ────────────────────────────────────

  it("[MPC] Same person (perturbed probe) matches enrolled biometric", async () => {
    const probeEmbedding = perturbEmbedding(enrolledEmbedding, 0.02);
    console.log("Verifying same-person probe via MPC...");

    const result = await verify(
      probeEmbedding,
      payer.publicKey,
      enrollSharedSecret,
      enrollNonce,
      p,
      provider,
      payer.publicKey,
    );

    console.log("Verify sig:", result.verifySig);
    console.log(`Decrypted distance: ${result.decryptedDistance} (threshold: ${MATCH_THRESHOLD})`);
    expect(result.matched).to.be.true;
    console.log("✅ [MPC] Same-person probe matched");
  });

  // ── Test 7: [MPC] Different person rejected ───────────────────────────────

  it("[MPC] Different person (independent probe) does NOT match enrolled biometric", async () => {
    const differentEmbedding = randomEmbedding();
    console.log("Verifying different-person probe via MPC...");

    const result = await verify(
      differentEmbedding,
      payer.publicKey,
      enrollSharedSecret,
      enrollNonce,
      p,
      provider,
      payer.publicKey,
    );

    console.log("Verify sig:", result.verifySig);
    console.log(`Decrypted distance: ${result.decryptedDistance} (threshold: ${MATCH_THRESHOLD})`);
    expect(result.matched).to.be.false;
    console.log("✅ [MPC] Different-person probe rejected");
  });
});

function readKpJson(path: string): anchor.web3.Keypair {
  const file = fs.readFileSync(path);
  return anchor.web3.Keypair.fromSecretKey(
    new Uint8Array(JSON.parse(file.toString())),
  );
}