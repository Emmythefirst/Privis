import * as anchor from '@coral-xyz/anchor';
import { uploadCircuit } from '@arcium-hq/client';
import * as fs from 'fs';
import { Connection } from '@solana/web3.js';

const PROGRAM_ID = 'HT8LVfZ55r3TyZ1DrZxzFnybi1sGxYMjv694o5vEx8BN';
const OPTS = { skipPreflight: true, preflightCommitment: 'confirmed' as const, commitment: 'confirmed' as const };

async function uploadWithRetry(provider: anchor.AnchorProvider, name: string, programId: anchor.web3.PublicKey, raw: Buffer) {
  for (let attempt = 1; attempt <= 30; attempt++) {
    try {
      console.log(`Uploading ${name} (attempt ${attempt})...`);
      await uploadCircuit(provider, name, programId, raw, true, 5, OPTS);
      console.log(`${name} done!`);
      return;
    } catch (e: any) {
      console.log(`Attempt ${attempt} failed: ${e.message?.slice(0, 100)}`);
      if (attempt < 30) {
        const delay = Math.min(5000 * attempt, 30000);
        console.log(`Retrying in ${delay/1000}s...`);
        await new Promise(r => setTimeout(r, delay));
      } else {
        throw e;
      }
    }
  }
}

async function main() {
  // Use public devnet — no rate limits
  const connection = new Connection('https://api.devnet.solana.com', 'confirmed');
  const wallet = anchor.AnchorProvider.env().wallet;
  const provider = new anchor.AnchorProvider(connection, wallet, OPTS);
  anchor.setProvider(provider);
  const programId = new anchor.web3.PublicKey(PROGRAM_ID);

  await uploadWithRetry(provider, 'store_biometric', programId, fs.readFileSync('build/store_biometric.arcis'));
  await uploadWithRetry(provider, 'match_biometric', programId, fs.readFileSync('build/match_biometric.arcis'));
}

main().catch(console.error);
