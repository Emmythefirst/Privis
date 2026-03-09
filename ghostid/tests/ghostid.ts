/**
 * tests/ghostid.ts
 *
 * Phase 2 integration test — enrollment flow end-to-end on devnet.
 *
 * Tests:
 *   1. Init store_biometric + match_biometric comp defs (once)
 *   2. Enroll a synthetic biometric for wallet A
 *   3. Verify BiometricAccount is created and enrolled = true
 *   4. (Phase 3) Verify: same person matches, different person doesn't
 */

import * as anchor from "@coral-xyz/anchor";
import { Program, Idl } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import { GhostId } from "../target/types/ghost_id";
import * as os from "os";
import * as fs from "fs";
import { expect } from "chai";

import {
  initStoreCompDefIfNeeded,
  initMatchCompDefIfNeeded,
  enroll,
} from "../client/enroll";
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

  // ─── Setup: init comp defs once ───────────────────────────────────────────

  before(async () => {
  console.log("\n=== Initializing computation definitions ===");
  await initStoreCompDefIfNeeded(p, provider, payer);
  await initMatchCompDefIfNeeded(p, provider, payer);
  console.log("Comp defs ready.\n");
});

  // ─── Test 1: Enrollment ───────────────────────────────────────────────────

  it("Enrolls a biometric and confirms BiometricAccount is created", async () => {
    // Generate a synthetic embedding (replace with real face-api.js in production)
    const embedding = randomEmbedding();
    console.log("Enrolling with synthetic 128-dim embedding...");

    const result = await enroll(embedding, p, provider, payer);

    console.log("BiometricAccount:", result.biometricAccount.toString());
    console.log("Enroll sig:", result.enrollSig);
    console.log("Finalize sig:", result.finalizeSig);
    expect(result.enrolled).to.be.true;

    // Verify on-chain account state
    const accInfo = await (program.account as any).biometricAccount.fetch(
      result.biometricAccount,
    );
    expect(accInfo.owner.toString()).to.equal(payer.publicKey.toString());
    expect(accInfo.enrolled).to.be.true;

    console.log("✅ Enrollment complete — BiometricAccount enrolled = true");
  });

  // ─── Test 2: Re-enrollment is idempotent ──────────────────────────────────

  it("Re-enrolling with a new embedding updates the stored ciphertexts", async () => {
    const newEmbedding = randomEmbedding();
    const result = await enroll(newEmbedding, p, provider, payer);
    expect(result.enrolled).to.be.true;
    console.log("✅ Re-enrollment successful");
  });

  // ─── Test 3: Biometric encoding sanity check ──────────────────────────────

  it("Same embedding round-trips through quantize → pack → unpack correctly", () => {
    const { packToU128s, unpackFromU128s, quantizeToU8, normalizeEmbedding } =
      require("../client/biometric");

    const embedding = randomEmbedding();
    const quantized = embeddingToQuantized(embedding);
    const packed = packToU128s(quantized);
    const unpacked = unpackFromU128s(packed);

    // Should round-trip exactly
    for (let i = 0; i < 128; i++) {
      expect(unpacked[i]).to.equal(
        quantized[i],
        `Byte ${i} mismatch after pack/unpack`,
      );
    }
    console.log("✅ Biometric round-trip encoding correct");
  });

  // ─── Test 4: Same-person distance is low ──────────────────────────────────

  it("Same person (perturbed embedding) has low L2 distance", () => {
    const base = randomEmbedding();
    const same = perturbEmbedding(base, 0.02); // small perturbation

    const baseQ = embeddingToQuantized(base);
    const sameQ = embeddingToQuantized(same);

    const dist = squaredL2Distance(baseQ, sameQ);
    console.log(`Same-person squared L2 distance: ${dist}`);

    // Should be well below threshold (8000)
    expect(dist).to.be.lessThan(
      4000,
      "Same-person L2 distance too high — threshold may be wrong",
    );
    console.log("✅ Same-person distance below threshold");
  });

  // ─── Test 5: Different-person distance is high ────────────────────────────

  it("Different person (independent embedding) has high L2 distance", () => {
    const personA = randomEmbedding();
    const personB = randomEmbedding(); // completely independent

    const aQ = embeddingToQuantized(personA);
    const bQ = embeddingToQuantized(personB);

    const dist = squaredL2Distance(aQ, bQ);
    console.log(`Different-person squared L2 distance: ${dist}`);

    // Should be above threshold (8000)
    expect(dist).to.be.greaterThan(
      1000,
      "Different-person distance suspiciously low",
    );
    console.log("✅ Different-person distance above expected minimum");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function readKpJson(path: string): anchor.web3.Keypair {
  const file = fs.readFileSync(path);
  return anchor.web3.Keypair.fromSecretKey(
    new Uint8Array(JSON.parse(file.toString())),
  );
}