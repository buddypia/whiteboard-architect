"use client";

import { memo, RefObject, useState } from "react";
import { Annotation, AgentActivity } from "@/lib/types";
import { getSeverityColor } from "@/lib/severity-colors";
import { AnnotationOverlay } from "@/components/AnnotationOverlay";

interface CameraPreviewProps {
  videoRef: RefObject<HTMLVideoElement | null>;
  isActive: boolean;
  annotations?: Annotation[];
  activeAnnotationId?: string | null;
  bargeInActive?: boolean;
  agentActivity?: AgentActivity;
}

const activityConfig: Record<AgentActivity, { label: string; icon: "scan" | "mic" | "wave" | null; color: string }> = {
  idle: { label: "", icon: null, color: "" },
  listening: { label: "聞き取り中", icon: "mic", color: "var(--accent)" },
  analyzing: { label: "レビュー中", icon: "scan", color: "var(--brand-400)" },
  speaking: { label: "レビュー中", icon: "wave", color: "var(--info)" },
};

function ActivityBadge({ activity, isActive }: { activity: AgentActivity; isActive: boolean }) {
  if (!isActive || activity === "idle") return null;
  const cfg = activityConfig[activity];

  return (
    <div
      className="absolute bottom-3 left-3 z-40 animate-activity-badge-in pointer-events-none"
      role="status"
      aria-label={cfg.label}
    >
      <div
        className="inline-flex items-center gap-2 rounded-lg px-3 py-1.5 border backdrop-blur-sm bg-[var(--overlay)] border-[var(--border)]"
      >
        {cfg.icon === "scan" && (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={cfg.color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="animate-dot-pulse" aria-hidden="true">
            <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
            <circle cx="12" cy="12" r="3" />
          </svg>
        )}
        {cfg.icon === "mic" && (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={cfg.color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
            <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
          </svg>
        )}
        {cfg.icon === "wave" && (
          <div className="audio-wave" style={{ color: cfg.color }} aria-hidden="true">
            <span /><span /><span /><span />
          </div>
        )}
        <span className="text-xs font-semibold" style={{ color: cfg.color }}>
          {cfg.label}
        </span>
      </div>
    </div>
  );
}

export const CameraPreview = memo(function CameraPreview({
  videoRef,
  isActive,
  annotations = [],
  activeAnnotationId,
  bargeInActive = false,
  agentActivity = "idle",
}: CameraPreviewProps) {
  const [mirrored, setMirrored] = useState(false);
  const isReviewing = agentActivity === "analyzing" || agentActivity === "speaking";
  const activity = activityConfig[agentActivity];

  return (
    <div className="relative flex flex-col items-center gap-2 w-full max-w-2xl">
      <div
        className={`relative w-full overflow-hidden rounded-xl aspect-[4/3] transition-shadow duration-500 ${
          isActive
            ? isReviewing
              ? ""
              : "animate-breathing-glow"
            : "shadow-sm"
        }`}
      >
        {/* Border frame — uses review-border-pulse (defined in globals.css) when reviewing */}
        <div
          className={`absolute inset-0 rounded-xl border-2 transition-colors duration-500 z-10 pointer-events-none ${
            bargeInActive
              ? "border-[var(--warning)]/80"
              : isReviewing
                ? "border-[var(--brand-400)] review-border-pulse"
                : isActive
                  ? "border-[var(--accent)]/40"
                  : "border-[var(--border)]"
          }`}
        />

        {/* Review scan line (defined in globals.css) — visible when Archie is reviewing */}
        {isReviewing && <div className="review-scan-line" />}

        {/* Barge-in flash overlay */}
        {bargeInActive && (
          <div className="absolute inset-0 z-40 pointer-events-none barge-in-flash rounded-xl" />
        )}

        {/* Scanning corners (active only) */}
        {isActive && (
          <>
            <div className="scan-corners z-20" />
            <div className="scan-corner-bl absolute inset-0 pointer-events-none z-20" />
            <div className="scan-corner-br absolute inset-0 pointer-events-none z-20" />
          </>
        )}

        {/* Video element */}
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className={`w-full h-full object-cover bg-[var(--surface)] transition-transform duration-300 ${
            mirrored ? "scale-x-[-1]" : ""
          }`}
          aria-label="カメラプレビュー"
        />

        {/* Annotation overlay (shared component) */}
        <AnnotationOverlay
          annotations={annotations}
          activeAnnotationId={activeAnnotationId}
          mirrored={mirrored}
        />

        {/* Annotation activity panel */}
        {annotations.length > 0 && (
          <div className="absolute top-2 left-2 right-2 z-40 animate-slide-down-in pointer-events-none">
            <div className="inline-flex flex-col gap-1.5 bg-[var(--overlay-heavy)] backdrop-blur-sm rounded-lg px-3 py-2 border border-[var(--accent)]/30 max-w-[90%]">
              {/* Header */}
              <div className="flex items-center gap-1.5">
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full rounded-full bg-[var(--accent)] opacity-75 animate-dot-pulse" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-[var(--accent)]" />
                </span>
                <span className="text-xs font-semibold text-[var(--accent)]">
                  分析表示中
                </span>
                <span className="text-xs text-[var(--foreground-subtle)] ml-1">
                  {annotations.length}件
                </span>
              </div>
              {/* Annotation labels */}
              <div className="flex flex-wrap gap-1">
                {annotations.map((ann) => {
                  const severityColor = getSeverityColor(ann.severity);
                  return (
                    <span
                      key={ann.id}
                      className="inline-flex items-center gap-1 text-[10px] font-medium rounded-md px-1.5 py-0.5"
                      style={{
                        color: severityColor,
                        backgroundColor: `color-mix(in srgb, ${severityColor} 15%, transparent)`,
                        border: `1px solid color-mix(in srgb, ${severityColor} 30%, transparent)`,
                      }}
                    >
                      {ann.annotationType === "rectangle" && (
                        <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2"/></svg>
                      )}
                      {ann.annotationType === "circle" && (
                        <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true"><circle cx="12" cy="12" r="10"/></svg>
                      )}
                      {ann.annotationType === "arrow" && (
                        <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
                      )}
                      {ann.label}
                    </span>
                  );
                })}
              </div>
              {/* Expiry progress bar */}
              <div className="w-full h-0.5 rounded-full bg-[var(--border)] overflow-hidden">
                <div
                  className="h-full rounded-full bg-[var(--accent)]/60 annotation-expire-bar"
                  style={{
                    "--expire-duration": "30s",
                  } as React.CSSProperties}
                />
              </div>
            </div>
          </div>
        )}

        <ActivityBadge activity={agentActivity} isActive={isActive} />

        {/* Inactive overlay */}
        {!isActive && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-[var(--background)]/90 gap-3">
            <div className="w-12 h-12 rounded-full border-2 border-[var(--border)] flex items-center justify-center">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-[var(--foreground-subtle)]" aria-hidden="true">
                <path d="m15.5 10-5 3V7l5 3Z" strokeLinecap="round" strokeLinejoin="round"/>
                <rect width="20" height="14" x="2" y="5" rx="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
            <span className="text-[var(--foreground-subtle)] text-xs">
              カメラ停止中
            </span>
          </div>
        )}
      </div>

      {/* Mirror toggle — 44px touch target */}
      <button
        onClick={() => setMirrored(!mirrored)}
        className="flex items-center gap-1.5 text-xs text-[var(--foreground-subtle)] hover:text-[var(--foreground-muted)] transition-colors px-3 py-2.5 rounded-md hover:bg-[var(--surface)] min-h-[44px]"
        aria-label={mirrored ? "カメラ反転解除" : "カメラ左右反転"}
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/>
        </svg>
        {mirrored ? "反転解除" : "左右反転"}
      </button>
    </div>
  );
});
