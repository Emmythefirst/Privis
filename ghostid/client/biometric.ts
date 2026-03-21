/**
 * biometric.ts
 *
 * Converts a 128-dimensional face embedding (Float32Array from face-api.js)
 * into 8 encrypted u128 ciphertexts ready for submission to the GhostID
 * Arcium computation.
 *
 * Pipeline:
 *   Float32Array(128)   — raw face-api.js embedding (already roughly L2-normalized)
 *   → normalizeEmbedding → Float32Array(128) in [-1, 1], ||v|| = 1
 *   → quantizeToU8      → Uint8Array(128) in [0, 255]
 *   → packToU128s       → bigint[8]  (16 bytes packed per u128, little-endian)
 *   → encryptBiometric  → number[][8]  (RescueCipher ciphertexts)
 */

import { RescueCipher, x25519 } from "@arcium-hq/client";
// Use Web Crypto API instead of Node crypto for browser compatibility

// ─────────────────────────────────────────────────────────────────────────────
// Encoding
// ─────────────────────────────────────────────────────────────────────────────

/**
 * L2-normalize a Float32Array embedding.
 * face-api.js embeddings are already normalized but this ensures it.
 */
export function normalizeEmbedding(embedding: Float32Array): Float32Array {
  let norm = 0;
  for (let i = 0; i < embedding.length; i++) {
    norm += embedding[i] * embedding[i];
  }
  norm = Math.sqrt(norm);
  if (norm === 0) throw new Error("Zero-norm embedding — invalid face data");
  return new Float32Array(embedding.map((v) => v / norm));
}

/**
 * Quantize a normalized Float32Array (values in [-1, 1]) to Uint8Array [0, 255].
 * Maps: -1 → 0, 0 → 127.5, +1 → 255
 */
export function quantizeToU8(normalized: Float32Array): Uint8Array {
  return new Uint8Array(
    Array.from(normalized).map((v) =>
      Math.min(255, Math.max(0, Math.round((v + 1) * 127.5))),
    ),
  );
}

/**
 * Pack 128 u8 values into 8 u128 values (little-endian, 16 bytes per u128).
 * Returns array of 8 bigints.
 */
export function packToU128s(quantized: Uint8Array): bigint[] {
  if (quantized.length !== 128) {
    throw new Error(`Expected 128 bytes, got ${quantized.length}`);
  }
  const result: bigint[] = [];
  for (let i = 0; i < 8; i++) {
    let val = 0n;
    for (let j = 0; j < 16; j++) {
      val |= BigInt(quantized[i * 16 + j]) << BigInt(j * 8);
    }
    result.push(val);
  }
  return result;
}

/**
 * Unpack 8 u128 bigints back to Uint8Array(128).
 * Inverse of packToU128s — useful for local testing.
 */
export function unpackFromU128s(packed: bigint[]): Uint8Array {
  const result = new Uint8Array(128);
  for (let i = 0; i < 8; i++) {
    for (let j = 0; j < 16; j++) {
      result[i * 16 + j] = Number((packed[i] >> BigInt(j * 8)) & 0xffn);
    }
  }
  return result;
}

/**
 * Full pipeline: Float32Array → Uint8Array(128)
 */
export function embeddingToQuantized(embedding: Float32Array): Uint8Array {
  const normalized = normalizeEmbedding(embedding);
  return quantizeToU8(normalized);
}

/**
 * Full pipeline: Float32Array → bigint[8]
 */
export function embeddingToPacked(embedding: Float32Array): bigint[] {
  return packToU128s(embeddingToQuantized(embedding));
}

// ─────────────────────────────────────────────────────────────────────────────
// Encryption
// ─────────────────────────────────────────────────────────────────────────────

export interface EncryptedBiometric {
  /** 8 ciphertexts — RescueCipher returns number[][] */
  ciphertexts: number[][];
  /** Caller's ephemeral x25519 public key — passed on-chain */
  ephemeralPublicKey: Uint8Array;
  /** 16-byte nonce — passed on-chain as u128 */
  nonce: Buffer;
  /** Keep private — used to decrypt the callback result */
  ephemeralPrivateKey: Uint8Array;
  /** Shared secret — keep private */
  sharedSecret: Uint8Array;
}

/**
 * Encrypt a packed biometric (8 u128s) with the MXE's x25519 public key.
 */
export function encryptBiometric(
  packed: bigint[],
  mxePublicKey: Uint8Array,
): EncryptedBiometric {
  if (packed.length !== 8) {
    throw new Error(`Expected 8 packed u128s, got ${packed.length}`);
  }

  const ephemeralPrivateKey = x25519.utils.randomSecretKey();
  const ephemeralPublicKey = x25519.getPublicKey(ephemeralPrivateKey);
  const sharedSecret = x25519.getSharedSecret(ephemeralPrivateKey, mxePublicKey);

  const cipher = new RescueCipher(sharedSecret);
  const nonceArr = new Uint8Array(16);
  globalThis.crypto.getRandomValues(nonceArr);
  const nonce = Buffer.from(nonceArr);
  // RescueCipher.encrypt returns number[][]
  const ciphertexts: number[][] = cipher.encrypt(packed, nonce);

  return {
    ciphertexts,
    ephemeralPublicKey,
    nonce,
    ephemeralPrivateKey,
    sharedSecret,
  };
}

/**
 * Full pipeline: Float32Array + MXE pubkey → EncryptedBiometric
 */
export function prepareEnrollment(
  embedding: Float32Array,
  mxePublicKey: Uint8Array,
): EncryptedBiometric {
  const packed = embeddingToPacked(embedding);
  return encryptBiometric(packed, mxePublicKey);
}

// ─────────────────────────────────────────────────────────────────────────────
// Decryption (for callback result)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Decrypt the match result returned by the match_biometric callback.
 *
 * @param encryptedResult - 32-element number[] from MatchResultEvent.result
 * @param nonce           - 16-element number[] from MatchResultEvent.nonce
 * @param sharedSecret    - Shared secret from the verify() call's ephemeral keys
 * @param threshold       - Squared L2 distance threshold (default: 8000)
 */
export function decryptMatchResult(
  encryptedResult: number[],
  nonce: number[],
  sharedSecret: Uint8Array,
  threshold: number = 8000,
): { isMatch: boolean; squaredL2Distance: bigint } {
  const cipher = new RescueCipher(sharedSecret);
  // RescueCipher.decrypt expects number[][] and number[]
  const [decrypted] = cipher.decrypt([encryptedResult], Uint8Array.from(nonce));
  return {
    squaredL2Distance: decrypted,
    isMatch: decrypted <= BigInt(threshold),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Utilities
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Compute squared L2 distance between two u8[128] embeddings.
 */
export function squaredL2Distance(a: Uint8Array, b: Uint8Array): number {
  let dist = 0;
  for (let i = 0; i < 128; i++) {
    const diff = a[i] - b[i];
    dist += diff * diff;
  }
  return dist;
}

/**
 * Cosine similarity between two Float32Array embeddings.
 */
export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Generate a synthetic random embedding for testing (without a real face image).
 */
export function randomEmbedding(): Float32Array {
  const raw = new Float32Array(128);
  for (let i = 0; i < 128; i++) {
    raw[i] = (Math.random() * 2 - 1) * 0.3;
  }
  return normalizeEmbedding(raw);
}

/**
 * Perturb an embedding slightly to simulate same-person variation.
 */
export function perturbEmbedding(
  embedding: Float32Array,
  strength: number = 0.05,
): Float32Array {
  const noise = new Float32Array(128);
  for (let i = 0; i < 128; i++) {
    noise[i] = embedding[i] + (Math.random() * 2 - 1) * strength;
  }
  return normalizeEmbedding(noise);
}