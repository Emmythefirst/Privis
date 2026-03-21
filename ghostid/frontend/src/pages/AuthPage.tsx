import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { type Idl, Program } from "@coral-xyz/anchor";
import { FaceCapture } from "../components/FaceCapture";
import { ComputationStatus, type ComputationPhase } from "../components/ComputationStatus";
import { useGhostID } from "../hooks/useGhostID";
import { verify, MATCH_THRESHOLD } from "../../../client/verify";

// AuthPage needs the enrollment shared secret + nonce to decrypt the stored
// template before running match. In a real app these come from the SDK/session.
// For the demo we read them from sessionStorage (set by EnrollPage after enrollment).

export function AuthPage() {
  const nav = useNavigate();
  const { program, provider, connected } = useGhostID();
  const wallet = useWallet();

  const [phase, setPhase] = useState<ComputationPhase | null>(null);
  const [result, setResult] = useState<"MATCHED" | "REJECTED" | undefined>();
  const [sig, setSig] = useState<string | undefined>();
  const [distance, setDistance] = useState<bigint | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleCapture = async (embedding: Float32Array) => {
    if (!program || !provider || !wallet.publicKey) return;

    // Retrieve enrollment secret from sessionStorage
    const ssStr = sessionStorage.getItem("ghostid_shared_secret");
    const nonceStr = sessionStorage.getItem("ghostid_nonce");

    if (!ssStr || !nonceStr) {
      setError("No enrollment found. Please enroll first.");
      return;
    }

    const enrollSharedSecret = Uint8Array.from(JSON.parse(ssStr));
    const enrollNonce = Uint8Array.from(JSON.parse(nonceStr));

    setPhase("waiting");
    setError(null);

    try {
      setPhase("computing");
      const res = await verify(
        embedding,
        wallet.publicKey,
        enrollSharedSecret,
        enrollNonce,
        program as unknown as Program<Idl>,
        provider,
        wallet.publicKey!,
      );
      setPhase("finalizing");
      await new Promise((r) => setTimeout(r, 800));

      setDistance(res.decryptedDistance);
      setSig(res.finalizeSig);
      setResult(res.matched ? "MATCHED" : "REJECTED");
      setPhase("success");
    } catch (err: any) {
      console.error("Verify error:", err);
      setError(err?.message ?? "Unknown error");
      setPhase("failed");
    }
  };

  return (
    <div style={s.root}>
      <button style={s.back} onClick={() => nav("/")}>← BACK</button>

      <div style={s.title}>AUTHENTICATE</div>
      <div style={s.subtitle}>Verify your biometric identity</div>

      {!connected ? (
        <div style={s.connectWrapper}>
          <p style={s.connectHint}>Connect your wallet to authenticate</p>
          <WalletMultiButton style={s.walletBtn as any} />
        </div>
      ) : (
        <FaceCapture
          onCapture={handleCapture}
          label="BIOMETRIC VERIFICATION"
          modelsPath="/models"
        />
      )}

      {/* Distance readout after match */}
      {distance !== null && phase === "success" && (
        <div style={s.distanceRow}>
          <span style={s.distanceLabel}>L2 DISTANCE</span>
          <span style={{
            ...s.distanceValue,
            color: result === "MATCHED" ? "var(--green)" : "var(--red)",
          }}>
            {distance.toString()}
          </span>
          <span style={s.distanceThreshold}>/ {MATCH_THRESHOLD}</span>
        </div>
      )}

      {error && <div style={s.errorMsg}>{error}</div>}

      {phase && (
        <ComputationStatus
          phase={phase}
          result={result}
          sig={sig}
          onDismiss={() => setPhase(null)}
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
  distanceRow: {
    display: "flex",
    alignItems: "center",
    gap: "10px",
    fontFamily: "var(--font-mono)",
    fontSize: "10px",
    letterSpacing: "0.12em",
  },
  distanceLabel: {
    color: "var(--fg-ghost)",
  },
  distanceValue: {
    fontVariantNumeric: "tabular-nums",
  },
  distanceThreshold: {
    color: "var(--fg-ghost)",
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