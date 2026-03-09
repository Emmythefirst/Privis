use anchor_lang::prelude::*;
use arcium_anchor::prelude::*;
use arcium_client::idl::arcium::types::{CircuitSource, OffChainCircuitSource};
use arcium_macros::circuit_hash;

declare_id!("FvYk7gGNJijiY82XXcGKXER65JdrqmAh9h23EA86GkoB");

const COMP_DEF_OFFSET_STORE_BIOMETRIC: u32 = comp_def_offset("store_biometric");
const COMP_DEF_OFFSET_MATCH_BIOMETRIC: u32 = comp_def_offset("match_biometric");

// space = discriminator(8) + owner(32) + enrolled(1) + bios(8*32=256) + ephem_pubkey(32) + nonce(16) + bump(1)
const BIOMETRIC_ACCOUNT_SPACE: usize = 8 + 32 + 1 + 256 + 32 + 16 + 1;

#[arcium_program]
pub mod ghost_id {
    use super::*;

    // ─── Comp def initializers ─────────────────────────────────────────────

    pub fn init_store_biometric_comp_def(
        ctx: Context<InitStoreBiometricCompDef>,
    ) -> Result<()> {
        init_comp_def(
            ctx.accounts,
            Some(CircuitSource::OffChain(OffChainCircuitSource {
                source: "https://raw.githubusercontent.com/Emmythefirst/Privis/master/ghostid/build/store_biometric.arcis".to_string(),
                hash: circuit_hash!("store_biometric"),
            })),
            None,
        )?;
        Ok(())
    }

    pub fn init_match_biometric_comp_def(
        ctx: Context<InitMatchBiometricCompDef>,
    ) -> Result<()> {
        init_comp_def(
            ctx.accounts,
            Some(CircuitSource::OffChain(OffChainCircuitSource {
                source: "https://raw.githubusercontent.com/Emmythefirst/Privis/master/ghostid/build/match_biometric.arcis".to_string(),
                hash: circuit_hash!("match_biometric"),
            })),
            None,
        )?;
        Ok(())
    }

    // ─── Enroll: store encrypted biometric + queue store_biometric MPC ────

    pub fn enroll(
        ctx: Context<Enroll>,
        computation_offset: u64,
        bio0: [u8; 32],
        bio1: [u8; 32],
        bio2: [u8; 32],
        bio3: [u8; 32],
        bio4: [u8; 32],
        bio5: [u8; 32],
        bio6: [u8; 32],
        bio7: [u8; 32],
        pubkey: [u8; 32],
        nonce: u128,
    ) -> Result<()> {
        ctx.accounts.sign_pda_account.bump = ctx.bumps.sign_pda_account;

        // Persist encrypted ciphertexts on-chain for later matching
        let bio_acc = &mut ctx.accounts.biometric_account;
        bio_acc.owner = ctx.accounts.payer.key();
        bio_acc.enrolled = false;
        bio_acc.bios = [bio0, bio1, bio2, bio3, bio4, bio5, bio6, bio7];
        bio_acc.ephem_pubkey = pubkey;
        bio_acc.nonce = nonce.to_le_bytes();
        bio_acc.bump = ctx.bumps.biometric_account;

        let args = ArgBuilder::new()
            .x25519_pubkey(pubkey)
            .plaintext_u128(nonce)
            .encrypted_u128(bio0)
            .encrypted_u128(bio1)
            .encrypted_u128(bio2)
            .encrypted_u128(bio3)
            .encrypted_u128(bio4)
            .encrypted_u128(bio5)
            .encrypted_u128(bio6)
            .encrypted_u128(bio7)
            .build();

        queue_computation(
            ctx.accounts,
            computation_offset,
            args,
            vec![StoreBiometricCallback::callback_ix(
                computation_offset,
                &ctx.accounts.mxe_account,
                &[],
            )?],
            1,
            0,
        )?;
        Ok(())
    }

    // ─── Store biometric callback ──────────────────────────────────────────

    #[arcium_callback(encrypted_ix = "store_biometric")]
    pub fn store_biometric_callback(
        ctx: Context<StoreBiometricCallback>,
        output: SignedComputationOutputs<StoreBiometricOutput>,
    ) -> Result<()> {
        match output.verify_output(
            &ctx.accounts.cluster_account,
            &ctx.accounts.computation_account,
        ) {
            Ok(_) => {}
            Err(_) => return Err(ErrorCode::AbortedComputation.into()),
        };

        let bio_acc = &mut ctx.accounts.biometric_account;
        bio_acc.enrolled = true;

        emit!(BiometricEnrolledEvent {
            owner: bio_acc.owner,
        });

        Ok(())
    }

    // ─── Verify: queue match_biometric MPC against stored template ─────────

    pub fn verify(
        ctx: Context<Verify>,
        computation_offset: u64,
        probe0: [u8; 32],
        probe1: [u8; 32],
        probe2: [u8; 32],
        probe3: [u8; 32],
        probe4: [u8; 32],
        probe5: [u8; 32],
        probe6: [u8; 32],
        probe7: [u8; 32],
        pubkey: [u8; 32],
        nonce: u128,
    ) -> Result<()> {
        ctx.accounts.sign_pda_account.bump = ctx.bumps.sign_pda_account;

        require!(
            ctx.accounts.biometric_account.enrolled,
            ErrorCode::NotEnrolled
        );

        let bio = &ctx.accounts.biometric_account;

        // Pass stored template ciphertexts + probe ciphertexts to the match circuit
        let args = ArgBuilder::new()
            .x25519_pubkey(pubkey)
            .plaintext_u128(nonce)
            // stored template (re-encrypted under the same MXE key)
            .encrypted_u128(bio.bios[0])
            .encrypted_u128(bio.bios[1])
            .encrypted_u128(bio.bios[2])
            .encrypted_u128(bio.bios[3])
            .encrypted_u128(bio.bios[4])
            .encrypted_u128(bio.bios[5])
            .encrypted_u128(bio.bios[6])
            .encrypted_u128(bio.bios[7])
            // probe
            .encrypted_u128(probe0)
            .encrypted_u128(probe1)
            .encrypted_u128(probe2)
            .encrypted_u128(probe3)
            .encrypted_u128(probe4)
            .encrypted_u128(probe5)
            .encrypted_u128(probe6)
            .encrypted_u128(probe7)
            .build();

        queue_computation(
            ctx.accounts,
            computation_offset,
            args,
            vec![MatchBiometricCallback::callback_ix(
                computation_offset,
                &ctx.accounts.mxe_account,
                &[],
            )?],
            1,
            0,
        )?;
        Ok(())
    }

    // ─── Match biometric callback ──────────────────────────────────────────

    #[arcium_callback(encrypted_ix = "match_biometric")]
    pub fn match_biometric_callback(
        ctx: Context<MatchBiometricCallback>,
        output: SignedComputationOutputs<MatchBiometricOutput>,
    ) -> Result<()> {
        let o = match output.verify_output(
            &ctx.accounts.cluster_account,
            &ctx.accounts.computation_account,
        ) {
            Ok(MatchBiometricOutput { field_0 }) => field_0,
            Err(_) => return Err(ErrorCode::AbortedComputation.into()),
        };

        // Emit the encrypted distance — caller decrypts and checks vs threshold
        emit!(MatchResultEvent {
            result: o.ciphertexts[0],
            nonce: o.nonce.to_le_bytes(),
        });

        Ok(())
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// On-chain account
// ─────────────────────────────────────────────────────────────────────────────

#[account]
pub struct BiometricAccount {
    pub owner: Pubkey,          // 32
    pub enrolled: bool,         // 1
    pub bios: [[u8; 32]; 8],   // 256 — encrypted biometric ciphertexts
    pub ephem_pubkey: [u8; 32], // 32
    pub nonce: [u8; 16],        // 16
    pub bump: u8,               // 1
}

// ─────────────────────────────────────────────────────────────────────────────
// Instruction contexts
// ─────────────────────────────────────────────────────────────────────────────

#[init_computation_definition_accounts("store_biometric", payer)]
#[derive(Accounts)]
pub struct InitStoreBiometricCompDef<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(
        mut,
        address = derive_mxe_pda!()
    )]
    pub mxe_account: Box<Account<'info, MXEAccount>>,
    #[account(mut)]
    /// CHECK: comp_def_account, checked by arcium program.
    pub comp_def_account: UncheckedAccount<'info>,
    #[account(
        mut,
        address = derive_mxe_lut_pda!(mxe_account.lut_offset_slot)
    )]
    /// CHECK: address_lookup_table, checked by arcium program.
    pub address_lookup_table: UncheckedAccount<'info>,
    #[account(address = LUT_PROGRAM_ID)]
    /// CHECK: lut_program is the Address Lookup Table program.
    pub lut_program: UncheckedAccount<'info>,
    pub arcium_program: Program<'info, Arcium>,
    pub system_program: Program<'info, System>,
}

#[init_computation_definition_accounts("match_biometric", payer)]
#[derive(Accounts)]
pub struct InitMatchBiometricCompDef<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(
        mut,
        address = derive_mxe_pda!()
    )]
    pub mxe_account: Box<Account<'info, MXEAccount>>,
    #[account(mut)]
    /// CHECK: comp_def_account, checked by arcium program.
    pub comp_def_account: UncheckedAccount<'info>,
    #[account(
        mut,
        address = derive_mxe_lut_pda!(mxe_account.lut_offset_slot)
    )]
    /// CHECK: address_lookup_table, checked by arcium program.
    pub address_lookup_table: UncheckedAccount<'info>,
    #[account(address = LUT_PROGRAM_ID)]
    /// CHECK: lut_program is the Address Lookup Table program.
    pub lut_program: UncheckedAccount<'info>,
    pub arcium_program: Program<'info, Arcium>,
    pub system_program: Program<'info, System>,
}

#[queue_computation_accounts("store_biometric", payer)]
#[derive(Accounts)]
#[instruction(computation_offset: u64)]
pub struct Enroll<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(
        init_if_needed,
        space = BIOMETRIC_ACCOUNT_SPACE,
        payer = payer,
        seeds = [b"biometric", payer.key().as_ref()],
        bump,
    )]
    pub biometric_account: Account<'info, BiometricAccount>,

    #[account(
        init_if_needed,
        space = 9,
        payer = payer,
        seeds = [&SIGN_PDA_SEED],
        bump,
        address = derive_sign_pda!(),
    )]
    pub sign_pda_account: Account<'info, ArciumSignerAccount>,

    #[account(address = derive_mxe_pda!())]
    pub mxe_account: Account<'info, MXEAccount>,

    #[account(
        mut,
        address = derive_mempool_pda!(mxe_account, ErrorCode::ClusterNotSet)
    )]
    /// CHECK: mempool_account, checked by the arcium program.
    pub mempool_account: UncheckedAccount<'info>,

    #[account(
        mut,
        address = derive_execpool_pda!(mxe_account, ErrorCode::ClusterNotSet)
    )]
    /// CHECK: executing_pool, checked by the arcium program.
    pub executing_pool: UncheckedAccount<'info>,

    #[account(
        mut,
        address = derive_comp_pda!(computation_offset, mxe_account, ErrorCode::ClusterNotSet)
    )]
    /// CHECK: computation_account, checked by the arcium program.
    pub computation_account: UncheckedAccount<'info>,

    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_STORE_BIOMETRIC))]
    pub comp_def_account: Account<'info, ComputationDefinitionAccount>,

    #[account(
        mut,
        address = derive_cluster_pda!(mxe_account, ErrorCode::ClusterNotSet)
    )]
    pub cluster_account: Account<'info, Cluster>,

    #[account(
        mut,
        address = ARCIUM_FEE_POOL_ACCOUNT_ADDRESS,
    )]
    pub pool_account: Account<'info, FeePool>,

    #[account(
        mut,
        address = ARCIUM_CLOCK_ACCOUNT_ADDRESS
    )]
    pub clock_account: Account<'info, ClockAccount>,

    pub system_program: Program<'info, System>,
    pub arcium_program: Program<'info, Arcium>,
}

#[callback_accounts("store_biometric")]
#[derive(Accounts)]
pub struct StoreBiometricCallback<'info> {
    pub arcium_program: Program<'info, Arcium>,

    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_STORE_BIOMETRIC))]
    pub comp_def_account: Account<'info, ComputationDefinitionAccount>,

    #[account(address = derive_mxe_pda!())]
    pub mxe_account: Account<'info, MXEAccount>,

    /// CHECK: computation_account, checked by arcium program.
    pub computation_account: UncheckedAccount<'info>,

    #[account(
        address = derive_cluster_pda!(mxe_account, ErrorCode::ClusterNotSet)
    )]
    pub cluster_account: Account<'info, Cluster>,

    #[account(address = ::anchor_lang::solana_program::sysvar::instructions::ID)]
    /// CHECK: instructions_sysvar, checked by the account constraint.
    pub instructions_sysvar: AccountInfo<'info>,

    // Extra account: the biometric account to mark as enrolled
    #[account(
        mut,
        seeds = [b"biometric", biometric_account.owner.as_ref()],
        bump = biometric_account.bump,
    )]
    pub biometric_account: Account<'info, BiometricAccount>,
}

#[queue_computation_accounts("match_biometric", payer)]
#[derive(Accounts)]
#[instruction(computation_offset: u64)]
pub struct Verify<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(
        seeds = [b"biometric", subject.key().as_ref()],
        bump = biometric_account.bump,
        constraint = biometric_account.enrolled @ ErrorCode::NotEnrolled,
    )]
    pub biometric_account: Account<'info, BiometricAccount>,

    /// CHECK: subject whose biometric we're matching against
    pub subject: UncheckedAccount<'info>,

    #[account(
        init_if_needed,
        space = 9,
        payer = payer,
        seeds = [&SIGN_PDA_SEED],
        bump,
        address = derive_sign_pda!(),
    )]
    pub sign_pda_account: Account<'info, ArciumSignerAccount>,

    #[account(address = derive_mxe_pda!())]
    pub mxe_account: Account<'info, MXEAccount>,

    #[account(
        mut,
        address = derive_mempool_pda!(mxe_account, ErrorCode::ClusterNotSet)
    )]
    /// CHECK: mempool_account, checked by the arcium program.
    pub mempool_account: UncheckedAccount<'info>,

    #[account(
        mut,
        address = derive_execpool_pda!(mxe_account, ErrorCode::ClusterNotSet)
    )]
    /// CHECK: executing_pool, checked by the arcium program.
    pub executing_pool: UncheckedAccount<'info>,

    #[account(
        mut,
        address = derive_comp_pda!(computation_offset, mxe_account, ErrorCode::ClusterNotSet)
    )]
    /// CHECK: computation_account, checked by the arcium program.
    pub computation_account: UncheckedAccount<'info>,

    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_MATCH_BIOMETRIC))]
    pub comp_def_account: Account<'info, ComputationDefinitionAccount>,

    #[account(
        mut,
        address = derive_cluster_pda!(mxe_account, ErrorCode::ClusterNotSet)
    )]
    pub cluster_account: Account<'info, Cluster>,

    #[account(
        mut,
        address = ARCIUM_FEE_POOL_ACCOUNT_ADDRESS,
    )]
    pub pool_account: Account<'info, FeePool>,

    #[account(
        mut,
        address = ARCIUM_CLOCK_ACCOUNT_ADDRESS
    )]
    pub clock_account: Account<'info, ClockAccount>,

    pub system_program: Program<'info, System>,
    pub arcium_program: Program<'info, Arcium>,
}

#[callback_accounts("match_biometric")]
#[derive(Accounts)]
pub struct MatchBiometricCallback<'info> {
    pub arcium_program: Program<'info, Arcium>,

    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_MATCH_BIOMETRIC))]
    pub comp_def_account: Account<'info, ComputationDefinitionAccount>,

    #[account(address = derive_mxe_pda!())]
    pub mxe_account: Account<'info, MXEAccount>,

    /// CHECK: computation_account, checked by arcium program.
    pub computation_account: UncheckedAccount<'info>,

    #[account(
        address = derive_cluster_pda!(mxe_account, ErrorCode::ClusterNotSet)
    )]
    pub cluster_account: Account<'info, Cluster>,

    #[account(address = ::anchor_lang::solana_program::sysvar::instructions::ID)]
    /// CHECK: instructions_sysvar, checked by the account constraint.
    pub instructions_sysvar: AccountInfo<'info>,
}

// ─────────────────────────────────────────────────────────────────────────────
// Events
// ─────────────────────────────────────────────────────────────────────────────

#[event]
pub struct BiometricEnrolledEvent {
    pub owner: Pubkey,
}

#[event]
pub struct MatchResultEvent {
    pub result: [u8; 32], // encrypted squared L2 distance
    pub nonce: [u8; 16],
}

// ─────────────────────────────────────────────────────────────────────────────
// Errors
// ─────────────────────────────────────────────────────────────────────────────

#[error_code]
pub enum ErrorCode {
    #[msg("The computation was aborted")]
    AbortedComputation,
    #[msg("Cluster not set")]
    ClusterNotSet,
    #[msg("User is not enrolled")]
    NotEnrolled,
}