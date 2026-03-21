import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { type Idl, Program } from "@coral-xyz/anchor";
import { FaceCapture } from "../components/FaceCapture";
import { ComputationStatus, type ComputationPhase } from "../components/ComputationStatus";
import { useGhostID } from "../hooks/useGhostID";
import { enroll } from "../../../client/enroll";

export function EnrollPage() {
  const nav = useNavigate();
  const { program, provider, connected } = useGhostID();
  const wallet = useWallet();

  const [phase, setPhase] = useState<ComputationPhase | null>(null);
  const [result, setResult] = useState<"ENROLLED" | undefined>();
  const [sig, setSig] = useState<string | undefined>();
  const [error, setError] = useState<string | null>(null);

  const handleCapture = async (embedding: Float32Array) => {
    if (!program || !provider || !wallet.publicKey) return;

    // Payer shim — publicKey for PDA derivation, signing via provider.wallet
    

    setPhase("waiting");
    setError(null);

    try {
      setPhase("computing");
      const res = await enroll(
        embedding,
        program as unknown as Program<Idl>,
        provider,
        wallet.publicKey!,
      );
      setPhase("finalizing");
      await new Promise((r) => setTimeout(r, 800));

      if (res.enrolled) {
        setSig(res.finalizeSig);
        setResult("ENROLLED");
        sessionStorage.setItem("ghostid_shared_secret", JSON.stringify(Array.from(res.sharedSecret)));
        sessionStorage.setItem("ghostid_nonce", JSON.stringify(Array.from(res.enrollNonce)));
        setPhase("success");
      } else {
        setPhase("failed");
      }
    } catch (err: any) {
      console.error("Enrollment error:", err);
      setError(err?.message ?? "Unknown error");
      setPhase("failed");
    }
  };

  return (
    <div style={s.root}>
      <button style={s.back} onClick={() => nav("/")}>← BACK</button>

      <div style={s.title}>ENROLL</div>
      <div style={s.subtitle}>Register your biometric identity</div>

      {!connected ? (
        <div style={s.connectWrapper}>
          <p style={s.connectHint}>Connect your wallet to enroll</p>
          <WalletMultiButton style={s.walletBtn as any} />
        </div>
      ) : (
        <FaceCapture
          onCapture={handleCapture}
          label="BIOMETRIC ENROLLMENT"
          modelsPath="/models"
        />
      )}

      {error && <div style={s.errorMsg}>{error}</div>}

      {phase && (
        <ComputationStatus
          phase={phase}
          result={result}
          sig={sig}
          onDismiss={() => {
            setPhase(null);
            if (result === "ENROLLED") nav("/auth");
          }}
        />
      )}
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  root: {
    minHeight: "100vh",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: "24px",
    padding: "40px 24px",
    position: "relative",
  },
  back: {
    position: "absolute",
    top: "28px",
    left: "28px",
    fontFamily: "var(--font-mono)",
    fontSize: "9px",
    letterSpacing: "0.18em",
    color: "var(--fg-ghost)",
    background: "none",
    border: "none",
    cursor: "pointer",
    padding: 0,
  },
  title: {
    fontFamily: "var(--font-display)",
    fontSize: "22px",
    fontWeight: 300,
    letterSpacing: "0.35em",
    color: "var(--cream)",
  },
  subtitle: {
    fontFamily: "var(--font-mono)",
    fontSize: "10px",
    letterSpacing: "0.15em",
    color: "var(--fg-ghost)",
  },
  connectWrapper: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: "16px",
    marginTop: "16px",
  },
  connectHint: {
    fontFamily: "var(--font-mono)",
    fontSize: "10px",
    letterSpacing: "0.15em",
    color: "var(--fg-ghost)",
  },
  walletBtn: {
    fontFamily: "var(--font-mono)",
    fontSize: "10px",
    letterSpacing: "0.2em",
    background: "transparent",
    border: "1px solid var(--border)",
    color: "var(--fg-dim)",
    borderRadius: "2px",
    height: "42px",
  },
  errorMsg: {
    fontFamily: "var(--font-mono)",
    fontSize: "9px",
    letterSpacing: "0.12em",
    color: "var(--red)",
    maxWidth: "320px",
    textAlign: "center",
  },
};