/**
 * ComputationStatus.tsx
 *
 * Live animation shown while Arcium MPC is running.
 * The latency is a feature — shows the privacy computation happening.
 *
 * States: waiting → computing → finalizing → success | failed
 */

import { useEffect, useState } from "react";

export type ComputationPhase =
  | "waiting"
  | "computing"
  | "finalizing"
  | "success"
  | "failed";

export interface ComputationStatusProps {
  phase: ComputationPhase;
  /** For success: "ENROLLED" | "MATCHED" | "REJECTED" */
  result?: "ENROLLED" | "MATCHED" | "REJECTED";
  /** Optional tx sig to show */
  sig?: string;
  onDismiss?: () => void;
}

const PHASE_LABELS: Record<ComputationPhase, string> = {
  waiting:    "QUEUING COMPUTATION",
  computing:  "MPC IN PROGRESS",
  finalizing: "FINALIZING",
  success:    "COMPLETE",
  failed:     "FAILED",
};

const NODE_COUNT = 4;

export function ComputationStatus({
  phase,
  result,
  sig,
  onDismiss,
}: ComputationStatusProps) {
  const [nodeStates, setNodeStates] = useState<boolean[]>(
    Array(NODE_COUNT).fill(false)
  );
  const [elapsed, setElapsed] = useState(0);
  const [startTime] = useState(Date.now());

  // Tick for animations
  useEffect(() => {
    const id = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startTime) / 1000));
    }, 80);
    return () => clearInterval(id);
  }, [startTime]);

  // Nodes light up progressively during computing
  useEffect(() => {
    if (phase === "computing") {
      const timers = Array.from({ length: NODE_COUNT }, (_, i) =>
        setTimeout(() => {
          setNodeStates((prev) => {
            const next = [...prev];
            next[i] = true;
            return next;
          });
        }, i * 600)
      );
      return () => timers.forEach(clearTimeout);
    }
    if (phase === "finalizing" || phase === "success") {
      setNodeStates(Array(NODE_COUNT).fill(true));
    }
    if (phase === "waiting") {
      setNodeStates(Array(NODE_COUNT).fill(false));
    }
  }, [phase]);

  const isActive = phase === "computing" || phase === "finalizing";
  const isDone = phase === "success" || phase === "failed";

  const resultColor =
    result === "MATCHED" || result === "ENROLLED"
      ? "var(--green)"
      : result === "REJECTED"
      ? "var(--red)"
      : "var(--cream-dim)";

  return (
    <div style={s.overlay}>
      <div style={s.panel}>

        {/* Header */}
        <div style={s.header}>
          <div style={{
            ...s.headerDot,
            background: isDone
              ? (phase === "success" ? "var(--green)" : "var(--red)")
              : "var(--amber)",
            animation: isActive ? "pulse 1.6s ease-in-out infinite" : "none",
          }} />
          <span style={s.headerLabel}>
            {PHASE_LABELS[phase]}
          </span>
          <span style={s.elapsed}>
            {String(elapsed).padStart(3, "0")}s
          </span>
        </div>

        {/* Separator */}
        <div style={s.sep} />

        {/* Node cluster visualization */}
        <div style={s.nodeSection}>
          <div style={s.nodeLabel}>ARCIUM MPC NODES</div>
          <div style={s.nodeRow}>
            {Array.from({ length: NODE_COUNT }, (_, i) => (
              <div key={i} style={s.nodeWrapper}>
                <div style={{
                  ...s.node,
                  borderColor: nodeStates[i]
                    ? "rgba(232,224,208,0.6)"
                    : "rgba(232,224,208,0.12)",
                  background: nodeStates[i]
                    ? "rgba(232,224,208,0.06)"
                    : "transparent",
                  boxShadow: nodeStates[i]
                    ? "0 0 12px rgba(232,224,208,0.08)"
                    : "none",
                  transition: "all 0.5s ease",
                }}>
                  {/* Inner pulse when active */}
                  {nodeStates[i] && isActive && (
                    <div style={{
                      ...s.nodePulse,
                      animationDelay: `${i * 200}ms`,
                    }} />
                  )}
                  {/* Check when done */}
                  {nodeStates[i] && phase === "success" && (
                    <svg width="10" height="10" viewBox="0 0 10 10" fill="none"
                      stroke="var(--green)" strokeWidth="1.5" strokeLinecap="round">
                      <path d="M2 5 L4 7 L8 3" />
                    </svg>
                  )}
                </div>
                {/* Connection line to next node */}
                {i < NODE_COUNT - 1 && (
                  <div style={{
                    ...s.connector,
                    background: nodeStates[i] && nodeStates[i + 1]
                      ? "rgba(232,224,208,0.25)"
                      : "rgba(232,224,208,0.06)",
                    transition: "background 0.5s ease",
                  }} />
                )}
              </div>
            ))}
          </div>

          {/* Data stream — scrolling hex chars during computation */}
          {isActive && (
            <div style={s.dataStream}>
              <DataStream />
            </div>
          )}
        </div>

        {/* Separator */}
        <div style={s.sep} />

        {/* Status detail */}
        <div style={s.detail}>
          {phase === "waiting" && (
            <StatusLine label="STATUS" value="AWAITING QUEUE" />
          )}
          {phase === "computing" && (
            <>
              <StatusLine label="PROTOCOL" value="RESCUE CIPHER CTR" />
              <StatusLine label="PARTIES"  value={`${nodeStates.filter(Boolean).length} / ${NODE_COUNT}`} />
              <StatusLine label="PRIVACY"  value="ZERO PLAINTEXT EXPOSED" />
            </>
          )}
          {phase === "finalizing" && (
            <>
              <StatusLine label="PROTOCOL" value="RESCUE CIPHER CTR" />
              <StatusLine label="PARTIES"  value={`${NODE_COUNT} / ${NODE_COUNT}`} />
              <StatusLine label="WRITING"  value="ON-CHAIN CALLBACK" />
            </>
          )}
          {phase === "success" && result && (
            <>
              <div style={{ ...s.resultBadge, color: resultColor, borderColor: resultColor }}>
                {result}
              </div>
              {sig && (
                <div style={s.sig}>
                  <span style={s.sigLabel}>TX</span>
                  <span style={s.sigValue}>{sig.slice(0, 8)}…{sig.slice(-8)}</span>
                </div>
              )}
            </>
          )}
          {phase === "failed" && (
            <div style={{ ...s.resultBadge, color: "var(--red)", borderColor: "var(--red)" }}>
              COMPUTATION FAILED
            </div>
          )}
        </div>

        {/* Dismiss */}
        {isDone && onDismiss && (
          <button style={s.dismiss} onClick={onDismiss}>
            CONTINUE →
          </button>
        )}
      </div>

      <style>{CSS}</style>
    </div>
  );
}

// ─── Data stream sub-component ────────────────────────────────────────────────

function DataStream() {
  const chars = "0123456789abcdef";
  const line = Array.from({ length: 28 }, () =>
    chars[Math.floor(Math.random() * chars.length)]
  ).join("");

  return (
    <div style={{ fontFamily: "var(--font-mono)", fontSize: "8px",
      color: "rgba(232,224,208,0.12)", letterSpacing: "0.12em",
      overflow: "hidden", whiteSpace: "nowrap" }}>
      {line}
    </div>
  );
}

// ─── Status line ──────────────────────────────────────────────────────────────

function StatusLine({ label, value }: { label: string; value: string }) {
  return (
    <div style={s.statusLine}>
      <span style={s.statusLineLabel}>{label}</span>
      <span style={s.statusLineValue}>{value}</span>
    </div>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s: Record<string, React.CSSProperties> = {
  overlay: {
    position: "fixed",
    inset: 0,
    background: "rgba(10,10,10,0.88)",
    backdropFilter: "blur(8px)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 100,
    animation: "fadeIn 0.3s ease",
  },
  panel: {
    width: "320px",
    background: "var(--bg-2)",
    border: "1px solid var(--border)",
    padding: "28px",
    display: "flex",
    flexDirection: "column",
    gap: "20px",
  },
  header: {
    display: "flex",
    alignItems: "center",
    gap: "10px",
  },
  headerDot: {
    width: "6px",
    height: "6px",
    borderRadius: "50%",
    flexShrink: 0,
  },
  headerLabel: {
    fontFamily: "var(--font-mono)",
    fontSize: "9px",
    letterSpacing: "0.22em",
    color: "var(--fg-dim)",
    flex: 1,
  },
  elapsed: {
    fontFamily: "var(--font-mono)",
    fontSize: "9px",
    letterSpacing: "0.1em",
    color: "var(--fg-ghost)",
    fontVariantNumeric: "tabular-nums",
  },
  sep: {
    height: "1px",
    background: "var(--border)",
  },
  nodeSection: {
    display: "flex",
    flexDirection: "column",
    gap: "14px",
  },
  nodeLabel: {
    fontFamily: "var(--font-mono)",
    fontSize: "8px",
    letterSpacing: "0.2em",
    color: "var(--fg-ghost)",
  },
  nodeRow: {
    display: "flex",
    alignItems: "center",
    gap: 0,
  },
  nodeWrapper: {
    display: "flex",
    alignItems: "center",
    flex: 1,
  },
  node: {
    width: "36px",
    height: "36px",
    border: "1px solid",
    borderRadius: "2px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
    flexShrink: 0,
  },
  nodePulse: {
    position: "absolute",
    inset: "4px",
    borderRadius: "1px",
    background: "rgba(232,224,208,0.08)",
    animation: "pulse 1.4s ease-in-out infinite",
  },
  connector: {
    flex: 1,
    height: "1px",
    minWidth: "8px",
  },
  dataStream: {
    overflow: "hidden",
  },
  detail: {
    display: "flex",
    flexDirection: "column",
    gap: "10px",
  },
  statusLine: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
  },
  statusLineLabel: {
    fontFamily: "var(--font-mono)",
    fontSize: "8px",
    letterSpacing: "0.18em",
    color: "var(--fg-ghost)",
  },
  statusLineValue: {
    fontFamily: "var(--font-mono)",
    fontSize: "8px",
    letterSpacing: "0.12em",
    color: "var(--fg-dim)",
  },
  resultBadge: {
    fontFamily: "var(--font-mono)",
    fontSize: "11px",
    letterSpacing: "0.25em",
    border: "1px solid",
    padding: "10px 0",
    textAlign: "center",
    animation: "fadeIn 0.4s ease",
  },
  sig: {
    display: "flex",
    gap: "12px",
    alignItems: "center",
  },
  sigLabel: {
    fontFamily: "var(--font-mono)",
    fontSize: "8px",
    letterSpacing: "0.18em",
    color: "var(--fg-ghost)",
  },
  sigValue: {
    fontFamily: "var(--font-mono)",
    fontSize: "8px",
    letterSpacing: "0.08em",
    color: "var(--fg-ghost)",
  },
  dismiss: {
    fontFamily: "var(--font-mono)",
    fontSize: "9px",
    letterSpacing: "0.2em",
    color: "var(--fg-dim)",
    background: "transparent",
    border: "1px solid var(--border)",
    padding: "11px",
    cursor: "pointer",
    transition: "border-color var(--transition), color var(--transition)",
    width: "100%",
  },
};

const CSS = `
  @keyframes fadeIn {
    from { opacity: 0; transform: translateY(6px); }
    to   { opacity: 1; transform: translateY(0); }
  }
  @keyframes pulse {
    0%, 100% { opacity: 0.3; }
    50%       { opacity: 1; }
  }
`;