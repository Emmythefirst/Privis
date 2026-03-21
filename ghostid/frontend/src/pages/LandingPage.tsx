import { useNavigate } from "react-router-dom";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { useWallet } from "@solana/wallet-adapter-react";

export function LandingPage() {
  const nav = useNavigate();
  const { connected } = useWallet();

  return (
    <div style={s.root}>
      <div style={s.wordmark}>GHOST ID</div>

      <p style={s.tagline}>
        Universal private biometric login.<br />
        <em>Your face. No data stored.</em>
      </p>

      <div style={s.divider} />

      <div style={s.actions}>
        <button style={s.btnPrimary} onClick={() => nav("/enroll")}>
          ENROLL
        </button>
        <button style={s.btnGhost} onClick={() => nav("/auth")}>
          AUTHENTICATE
        </button>
      </div>

      <div style={s.walletRow}>
        <WalletMultiButton style={s.walletBtn as any} />
        {connected && (
          <span style={s.connectedBadge}>● CONNECTED</span>
        )}
      </div>

      <div style={s.footnote}>
        Powered by Arcium MPC · Solana devnet
      </div>
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
    gap: "28px",
    padding: "40px 24px",
    position: "relative",
  },
  wordmark: {
    fontFamily: "var(--font-display)",
    fontSize: "32px",
    fontWeight: 300,
    letterSpacing: "0.45em",
    color: "var(--cream)",
  },
  tagline: {
    fontFamily: "var(--font-mono)",
    fontSize: "11px",
    letterSpacing: "0.08em",
    color: "var(--fg-dim)",
    textAlign: "center",
    lineHeight: 1.8,
  },
  divider: {
    width: "1px",
    height: "40px",
    background: "var(--border)",
  },
  actions: {
    display: "flex",
    flexDirection: "column",
    gap: "12px",
    alignItems: "center",
  },
  btnPrimary: {
    fontFamily: "var(--font-mono)",
    fontSize: "10px",
    letterSpacing: "0.22em",
    color: "#0a0a0a",
    background: "rgba(232,224,208,0.5)",
    border: "1px solid rgba(232,224,208,0.5)",
    padding: "13px 44px",
    cursor: "pointer",
    transition: "all 0.22s ease",
    borderRadius: "2px",
  },
  btnGhost: {
    fontFamily: "var(--font-mono)",
    fontSize: "10px",
    letterSpacing: "0.22em",
    color: "var(--fg-dim)",
    background: "transparent",
    border: "1px solid var(--border)",
    padding: "13px 44px",
    cursor: "pointer",
    transition: "all 0.22s ease",
    borderRadius: "2px",
  },
  walletRow: {
    display: "flex",
    alignItems: "center",
    gap: "12px",
  },
  walletBtn: {
    fontFamily: "var(--font-mono)",
    fontSize: "9px",
    letterSpacing: "0.18em",
    background: "transparent",
    border: "1px solid var(--border)",
    color: "var(--fg-ghost)",
    borderRadius: "2px",
    height: "36px",
    padding: "0 16px",
  },
  connectedBadge: {
    fontFamily: "var(--font-mono)",
    fontSize: "8px",
    letterSpacing: "0.2em",
    color: "var(--green)",
  },
  footnote: {
    fontFamily: "var(--font-mono)",
    fontSize: "9px",
    letterSpacing: "0.15em",
    color: "var(--fg-ghost)",
    position: "absolute",
    bottom: "28px",
  },
};