use arcis::*;

#[encrypted]
mod circuits {
    use arcis::*;

    pub struct StoreBiometricInput {
        pub bio0: u128,
        pub bio1: u128,
        pub bio2: u128,
        pub bio3: u128,
        pub bio4: u128,
        pub bio5: u128,
        pub bio6: u128,
        pub bio7: u128,
    }

    #[instruction]
    pub fn store_biometric(input_ctxt: Enc<Shared, StoreBiometricInput>) -> Enc<Shared, u128> {
        let _input = input_ctxt.to_arcis();
        input_ctxt.owner.from_arcis(1u128)
    }

    pub struct MatchBiometricInput {
        pub tmpl0: u128,
        pub tmpl1: u128,
        pub tmpl2: u128,
        pub tmpl3: u128,
        pub tmpl4: u128,
        pub tmpl5: u128,
        pub tmpl6: u128,
        pub tmpl7: u128,
        pub probe0: u128,
        pub probe1: u128,
        pub probe2: u128,
        pub probe3: u128,
        pub probe4: u128,
        pub probe5: u128,
        pub probe6: u128,
        pub probe7: u128,
    }

    #[instruction]
    pub fn match_biometric(input_ctxt: Enc<Shared, MatchBiometricInput>) -> Enc<Shared, u128> {
        let input = input_ctxt.to_arcis();
        let dist: u128 = squared_l2_u128(input.tmpl0, input.probe0)
            + squared_l2_u128(input.tmpl1, input.probe1)
            + squared_l2_u128(input.tmpl2, input.probe2)
            + squared_l2_u128(input.tmpl3, input.probe3)
            + squared_l2_u128(input.tmpl4, input.probe4)
            + squared_l2_u128(input.tmpl5, input.probe5)
            + squared_l2_u128(input.tmpl6, input.probe6)
            + squared_l2_u128(input.tmpl7, input.probe7);
        input_ctxt.owner.from_arcis(dist)
    }

    fn squared_l2_u128(a: u128, b: u128) -> u128 {
        diff_sq((a >>   0) as u8 as u128, (b >>   0) as u8 as u128)
        + diff_sq((a >>   8) as u8 as u128, (b >>   8) as u8 as u128)
        + diff_sq((a >>  16) as u8 as u128, (b >>  16) as u8 as u128)
        + diff_sq((a >>  24) as u8 as u128, (b >>  24) as u8 as u128)
        + diff_sq((a >>  32) as u8 as u128, (b >>  32) as u8 as u128)
        + diff_sq((a >>  40) as u8 as u128, (b >>  40) as u8 as u128)
        + diff_sq((a >>  48) as u8 as u128, (b >>  48) as u8 as u128)
        + diff_sq((a >>  56) as u8 as u128, (b >>  56) as u8 as u128)
        + diff_sq((a >>  64) as u8 as u128, (b >>  64) as u8 as u128)
        + diff_sq((a >>  72) as u8 as u128, (b >>  72) as u8 as u128)
        + diff_sq((a >>  80) as u8 as u128, (b >>  80) as u8 as u128)
        + diff_sq((a >>  88) as u8 as u128, (b >>  88) as u8 as u128)
        + diff_sq((a >>  96) as u8 as u128, (b >>  96) as u8 as u128)
        + diff_sq((a >> 104) as u8 as u128, (b >> 104) as u8 as u128)
        + diff_sq((a >> 112) as u8 as u128, (b >> 112) as u8 as u128)
        + diff_sq((a >> 120) as u8 as u128, (b >> 120) as u8 as u128)
    }

    fn diff_sq(a: u128, b: u128) -> u128 {
        if a >= b { let d = a - b; d * d } else { let d = b - a; d * d }
    }
}
