/**
 * FaceCapture.tsx
 *
 * Biometric face capture component for GhostID.
 * Uses face-api.js for real-time face detection and embedding extraction.
 *
 * States:
 *   idle       → camera not yet started
 *   loading    → loading face-api.js models
 *   detecting  → camera live, scanning for face
 *   detected   → face in frame, stable — ready to capture
 *   capturing  → processing embedding
 *   captured   → embedding ready, callback fired
 *   error      → permission denied or model load failure
 */

import { useEffect, useRef, useState, useCallback } from "react";
import * as faceapi from "face-api.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export type CaptureState =
  | "idle"
  | "loading"
  | "detecting"
  | "detected"
  | "capturing"
  | "captured"
  | "error";

export interface FaceCaptureProps {
  /** Called when a face embedding is successfully extracted */
  onCapture: (embedding: Float32Array) => void;
  /** Optional: called on unrecoverable error */
  onError?: (message: string) => void;
  /** Path to face-api.js model weights (default: /models) */
  modelsPath?: string;
  /** How long face must be stable before auto-capture (ms, default: 1200) */
  stabilityMs?: number;
  /** Label shown above the frame (default: "BIOMETRIC SCAN") */
  label?: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const MODELS_PATH = "/models";
const STABILITY_MS = 1200;
const DETECTION_INTERVAL_MS = 120;

// ─── Component ────────────────────────────────────────────────────────────────

export function FaceCapture({
  onCapture,
  onError,
  modelsPath = MODELS_PATH,
  stabilityMs = STABILITY_MS,
  label = "BIOMETRIC SCAN",
}: FaceCaptureProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const detectionLoopRef = useRef<number | null>(null);
  const stabilityTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastDetectedRef = useRef<boolean>(false);

  const [state, setState] = useState<CaptureState>("idle");
  const [statusText, setStatusText] = useState("READY");
  const [confidence, setConfidence] = useState(0);
  const [frameCount, setFrameCount] = useState(0);

  // ── Model loading ──────────────────────────────────────────────────────────

  const loadModels = useCallback(async () => {
    setState("loading");
    setStatusText("LOADING MODELS");
    try {
      await Promise.all([
        faceapi.nets.tinyFaceDetector.loadFromUri(modelsPath),
        faceapi.nets.faceRecognitionNet.loadFromUri(modelsPath),
        faceapi.nets.faceLandmark68Net.loadFromUri(modelsPath),
      ]);
      await startCamera();
    } catch (err) {
      const msg = "Failed to load face detection models";
      setState("error");
      setStatusText("MODEL LOAD FAILED");
      onError?.(msg);
    }
  }, [modelsPath]);

  // ── Camera ─────────────────────────────────────────────────────────────────

  const startCamera = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: 640, height: 480 },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setState("detecting");
      setStatusText("ALIGN FACE");
      startDetectionLoop();
    } catch (err) {
      setState("error");
      setStatusText("CAMERA ACCESS DENIED");
      onError?.("Camera permission denied");
    }
  }, []);

  const stopCamera = useCallback(() => {
    if (detectionLoopRef.current) {
      clearInterval(detectionLoopRef.current);
      detectionLoopRef.current = null;
    }
    if (stabilityTimerRef.current) {
      clearTimeout(stabilityTimerRef.current);
      stabilityTimerRef.current = null;
    }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  // ── Detection loop ─────────────────────────────────────────────────────────

  const startDetectionLoop = useCallback(() => {
    detectionLoopRef.current = setInterval(async () => {
      if (!videoRef.current || videoRef.current.readyState < 2) return;

      setFrameCount((n) => n + 1);

      const detection = await faceapi
        .detectSingleFace(
          videoRef.current,
          new faceapi.TinyFaceDetectorOptions({ scoreThreshold: 0.5 })
        )
        .withFaceLandmarks()
        .withFaceDescriptor();

      const faceDetected = !!detection;
      const score = detection?.detection.score ?? 0;

      setConfidence(Math.round(score * 100));

      if (faceDetected && !lastDetectedRef.current) {
        // Face just appeared
        lastDetectedRef.current = true;
        setState("detected");
        setStatusText("HOLD STILL");

        // Auto-capture after stability period
        stabilityTimerRef.current = setTimeout(async () => {
          if (!detection) return;
          setState("capturing");
          setStatusText("CAPTURING");

          await new Promise((r) => setTimeout(r, 300));

          const embedding = detection.descriptor as Float32Array;
          setState("captured");
          setStatusText("CAPTURED");
          stopCamera();
          onCapture(embedding);
        }, stabilityMs);
      } else if (!faceDetected && lastDetectedRef.current) {
        // Face disappeared
        lastDetectedRef.current = false;
        setState("detecting");
        setStatusText("ALIGN FACE");
        if (stabilityTimerRef.current) {
          clearTimeout(stabilityTimerRef.current);
          stabilityTimerRef.current = null;
        }
      }
    }, DETECTION_INTERVAL_MS) as unknown as number;
  }, [stabilityMs, onCapture, stopCamera]);

  // ── Cleanup ────────────────────────────────────────────────────────────────

  useEffect(() => {
    return () => stopCamera();
  }, [stopCamera]);

  // ── Retry ──────────────────────────────────────────────────────────────────

  const handleStart = () => {
    if (state === "idle" || state === "error") {
      loadModels();
    }
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div style={styles.root}>
      {/* Label */}
      <div style={styles.label}>{label}</div>

      {/* Scanner frame */}
      <div style={styles.frameWrapper}>
        {/* Oval clip */}
        <div
          style={{
            ...styles.oval,
            ...(state === "detected" || state === "captured"
              ? styles.ovalActive
              : {}),
          }}
        >
          {/* Video feed */}
          <video
            ref={videoRef}
            style={styles.video}
            muted
            playsInline
          />

          {/* Overlay canvas (for future landmark drawing) */}
          <canvas ref={canvasRef} style={styles.canvas} />

          {/* Scan line — only visible during detecting/detected */}
          {(state === "detecting" || state === "detected") && (
            <div style={styles.scanLine} />
          )}

          {/* Idle / error overlay */}
          {(state === "idle" || state === "error" || state === "loading") && (
            <div style={styles.idleOverlay}>
              {state === "loading" ? (
                <div style={styles.loadingDots}>
                  <span style={{ ...styles.dot, animationDelay: "0ms" }} />
                  <span style={{ ...styles.dot, animationDelay: "160ms" }} />
                  <span style={{ ...styles.dot, animationDelay: "320ms" }} />
                </div>
              ) : (
                <div
                  style={{
                    ...styles.startBtn,
                    ...(state === "error" ? styles.startBtnError : {}),
                  }}
                  onClick={handleStart}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => e.key === "Enter" && handleStart()}
                >
                  {state === "error" ? "RETRY" : "BEGIN"}
                </div>
              )}
            </div>
          )}

          {/* Captured checkmark */}
          {state === "captured" && (
            <div style={styles.capturedOverlay}>
              <svg
                width="48"
                height="48"
                viewBox="0 0 48 48"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              >
                <path d="M10 24 L20 34 L38 14" />
              </svg>
            </div>
          )}
        </div>

        {/* Corner marks — precision aesthetic */}
        <CornerMarks active={state === "detected" || state === "captured"} />
      </div>

      {/* Status line */}
      <div style={styles.statusRow}>
        <div
          style={{
            ...styles.statusDot,
            backgroundColor: statusColor(state),
          }}
        />
        <span style={styles.statusText}>{statusText}</span>
        {state === "detecting" || state === "detected" ? (
          <span style={styles.confidence}>
            {confidence.toString().padStart(3, "0")}%
          </span>
        ) : null}
      </div>

      {/* Frame counter — subtle technical detail */}
      {(state === "detecting" || state === "detected") && (
        <div style={styles.frameCounter}>
          {String(frameCount).padStart(6, "0")}
        </div>
      )}

      {/* Inline keyframe styles */}
      <style>{CSS}</style>
    </div>
  );
}

// ─── Corner marks ─────────────────────────────────────────────────────────────

function CornerMarks({ active }: { active: boolean }) {
  const mark = (pos: React.CSSProperties): React.ReactNode => (
    <div
      style={{
        ...styles.cornerBase,
        ...pos,
        borderColor: active ? "rgba(232, 224, 208, 0.9)" : "rgba(232, 224, 208, 0.3)",
        transition: "border-color 0.6s ease",
      }}
    />
  );

  return (
    <>
      {mark({ top: -1, left: -1, borderTop: "1px solid", borderLeft: "1px solid" })}
      {mark({ top: -1, right: -1, borderTop: "1px solid", borderRight: "1px solid" })}
      {mark({ bottom: -1, left: -1, borderBottom: "1px solid", borderLeft: "1px solid" })}
      {mark({ bottom: -1, right: -1, borderBottom: "1px solid", borderRight: "1px solid" })}
    </>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function statusColor(state: CaptureState): string {
  switch (state) {
    case "detected":
    case "captured":
      return "#c8d8a8"; // soft sage green
    case "error":
      return "#d8a0a0"; // soft red
    case "loading":
    case "capturing":
      return "#d8c8a0"; // amber
    default:
      return "#666";
  }
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles: Record<string, React.CSSProperties> = {
  root: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: "24px",
    userSelect: "none",
    fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
  },
  label: {
    fontSize: "10px",
    letterSpacing: "0.25em",
    color: "rgba(245, 245, 240, 0.35)",
    fontFamily: "'JetBrains Mono', monospace",
  },
  frameWrapper: {
    position: "relative",
    width: "280px",
    height: "336px", // 5:6 ratio — taller oval for face
    padding: "12px",
  },
  oval: {
    position: "relative",
    width: "100%",
    height: "100%",
    borderRadius: "50%",
    overflow: "hidden",
    border: "1px solid rgba(232, 224, 208, 0.15)",
    transition: "border-color 0.6s ease, box-shadow 0.6s ease",
    backgroundColor: "#111",
  },
  ovalActive: {
    borderColor: "rgba(232, 224, 208, 0.5)",
    boxShadow: "0 0 40px rgba(232, 224, 208, 0.06)",
  },
  video: {
    position: "absolute",
    inset: 0,
    width: "100%",
    height: "100%",
    objectFit: "cover",
    transform: "scaleX(-1)", // mirror
    opacity: 0.92,
  },
  canvas: {
    position: "absolute",
    inset: 0,
    width: "100%",
    height: "100%",
  },
  scanLine: {
    position: "absolute",
    left: 0,
    right: 0,
    height: "1px",
    background:
      "linear-gradient(90deg, transparent, rgba(232, 224, 208, 0.6), transparent)",
    animation: "scanLine 2.4s ease-in-out infinite",
    pointerEvents: "none",
  },
  idleOverlay: {
    position: "absolute",
    inset: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "rgba(10, 10, 10, 0.7)",
    backdropFilter: "blur(2px)",
  },
  startBtn: {
    fontSize: "11px",
    letterSpacing: "0.2em",
    color: "rgba(232, 224, 208, 0.7)",
    border: "1px solid rgba(232, 224, 208, 0.25)",
    padding: "12px 28px",
    cursor: "pointer",
    transition: "color 0.2s, border-color 0.2s",
  },
  startBtnError: {
    color: "rgba(216, 160, 160, 0.8)",
    borderColor: "rgba(216, 160, 160, 0.3)",
  },
  capturedOverlay: {
    position: "absolute",
    inset: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "rgba(10, 10, 10, 0.5)",
    color: "rgba(200, 216, 168, 0.9)",
    animation: "fadeIn 0.4s ease",
  },
  loadingDots: {
    display: "flex",
    gap: "8px",
    alignItems: "center",
  },
  dot: {
    width: "4px",
    height: "4px",
    borderRadius: "50%",
    backgroundColor: "rgba(232, 224, 208, 0.5)",
    animation: "pulse 1.2s ease-in-out infinite",
    display: "inline-block",
  },
  cornerBase: {
    position: "absolute",
    width: "12px",
    height: "12px",
  },
  statusRow: {
    display: "flex",
    alignItems: "center",
    gap: "10px",
  },
  statusDot: {
    width: "5px",
    height: "5px",
    borderRadius: "50%",
    transition: "background-color 0.4s ease",
    flexShrink: 0,
  },
  statusText: {
    fontSize: "10px",
    letterSpacing: "0.2em",
    color: "rgba(245, 245, 240, 0.5)",
  },
  confidence: {
    fontSize: "10px",
    letterSpacing: "0.1em",
    color: "rgba(245, 245, 240, 0.2)",
    marginLeft: "4px",
  },
  frameCounter: {
    fontSize: "9px",
    letterSpacing: "0.15em",
    color: "rgba(245, 245, 240, 0.1)",
    fontVariantNumeric: "tabular-nums",
    marginTop: "-16px",
  },
};

// ─── Keyframes ────────────────────────────────────────────────────────────────

const CSS = `
  @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@300;400&display=swap');

  @keyframes scanLine {
    0%   { top: 10%; opacity: 0; }
    10%  { opacity: 1; }
    90%  { opacity: 1; }
    100% { top: 90%; opacity: 0; }
  }

  @keyframes pulse {
    0%, 100% { opacity: 0.2; transform: scale(0.8); }
    50%       { opacity: 0.8; transform: scale(1.2); }
  }

  @keyframes fadeIn {
    from { opacity: 0; }
    to   { opacity: 1; }
  }
`;