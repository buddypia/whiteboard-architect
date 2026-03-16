"use client";

import { memo } from "react";
import { ConnectionState, SessionMode } from "@/lib/types";

interface SessionControlsProps {
  isSessionActive: boolean;
  isStartingSession?: boolean;
  connectionState?: ConnectionState;
  hasSnapshots?: boolean;
  viewMode?: "live" | "snapshot-review";
  sessionMode?: SessionMode;
  isGeneratingDiagram?: boolean;
  onToggleSession: () => void;
  onSnapshot: () => void;
  onNewSession?: () => void;
  onBackToLive?: () => void;
  onGenerateDiagram?: () => void;
  onSessionModeChange?: (mode: SessionMode) => void;
}

function Spinner() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" className="animate-spin" aria-hidden="true">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeDasharray="50 20" />
    </svg>
  );
}

export const SessionControls = memo(function SessionControls({
  isSessionActive,
  isStartingSession = false,
  connectionState = "disconnected",
  hasSnapshots = false,
  viewMode = "live",
  sessionMode = "live",
  isGeneratingDiagram = false,
  onToggleSession,
  onSnapshot,
  onNewSession,
  onBackToLive,
  onGenerateDiagram,
  onSessionModeChange,
}: SessionControlsProps) {
  const isConnecting = isStartingSession || (isSessionActive && connectionState === "connecting");
  const isReady = isSessionActive && connectionState === "connected";

  const buttonLabel = isConnecting
    ? "接続中..."
    : isSessionActive
      ? "セッション終了"
      : "セッション開始";

  return (
    <div
      className="flex items-center justify-center flex-wrap gap-2 sm:gap-3 px-3 sm:px-4 py-2.5 sm:py-3 glass border-t border-[var(--border-subtle)]"
      role="toolbar"
      aria-label="セッション操作"
    >
      {/* Mode toggle (visible before session starts) */}
      {!isSessionActive && onSessionModeChange && (
        <div className="inline-flex items-center rounded-xl border border-[var(--border)] overflow-hidden" role="radiogroup" aria-label="セッションモード">
          <button
            onClick={() => onSessionModeChange("live")}
            role="radio"
            aria-checked={sessionMode === "live"}
            className={`inline-flex items-center gap-1.5 px-3 sm:px-4 py-2 text-sm font-medium transition-all duration-200 min-h-[44px] ${
              sessionMode === "live"
                ? "bg-[var(--accent)]/15 text-[var(--accent)] border-r border-[var(--accent)]/30"
                : "text-[var(--foreground-subtle)] hover:bg-[var(--surface-hover)] border-r border-[var(--border)]"
            }`}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
              <circle cx="12" cy="13" r="4"/>
            </svg>
            Live
          </button>
          <button
            onClick={() => onSessionModeChange("snapshot")}
            role="radio"
            aria-checked={sessionMode === "snapshot"}
            className={`inline-flex items-center gap-1.5 px-3 sm:px-4 py-2 text-sm font-medium transition-all duration-200 min-h-[44px] ${
              sessionMode === "snapshot"
                ? "bg-[var(--info)]/15 text-[var(--info)]"
                : "text-[var(--foreground-subtle)] hover:bg-[var(--surface-hover)]"
            }`}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect width="18" height="18" x="3" y="3" rx="2" ry="2"/>
              <circle cx="9" cy="9" r="2"/>
              <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>
            </svg>
            Snapshot
          </button>
        </div>
      )}

      {/* Start / Stop button */}
      <button
        onClick={onToggleSession}
        disabled={isConnecting}
        className={`inline-flex items-center gap-2 px-4 sm:px-6 py-2.5 rounded-xl font-medium text-sm transition-all duration-200 min-h-[44px] ${
          isConnecting
            ? "bg-[var(--warning)]/15 text-[var(--warning)] border border-[var(--warning)]/30 cursor-wait"
            : isSessionActive
              ? "bg-[var(--destructive)]/15 hover:bg-[var(--destructive)]/25 text-[var(--destructive)] border border-[var(--destructive)]/30 hover:border-[var(--destructive)]/50"
              : "bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-[var(--on-accent)] shadow-md animate-gentle-pulse"
        }`}
        aria-label={buttonLabel}
      >
        {isConnecting ? (
          <Spinner />
        ) : isSessionActive ? (
          /* Stop icon */
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <rect x="6" y="6" width="12" height="12" rx="1" />
          </svg>
        ) : (
          /* Play icon */
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <polygon points="6,3 20,12 6,21" />
          </svg>
        )}
        {buttonLabel}
      </button>

      {/* Connection status pill (visible during active session) */}
      {isSessionActive && (
        <div
          className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-300 ${
            isReady
              ? "bg-[var(--accent)]/10 text-[var(--accent)] border border-[var(--accent)]/20"
              : "bg-[var(--warning)]/10 text-[var(--warning)] border border-[var(--warning)]/20"
          }`}
          role="status"
          aria-label={isReady ? "接続済み" : "接続中"}
        >
          <span
            className={`inline-block w-1.5 h-1.5 rounded-full ${
              isReady ? "bg-[var(--accent)]" : "bg-[var(--warning)] animate-dot-pulse"
            }`}
          />
          {isReady ? "接続済み" : "接続中..."}
        </div>
      )}

      {/* Snapshot button (hidden in review/snapshot mode) / Back to Live button */}
      {viewMode === "snapshot-review" ? (
        sessionMode === "live" && onBackToLive ? (
          <button
            onClick={onBackToLive}
            className="inline-flex items-center gap-2 px-3 sm:px-5 py-2.5 rounded-xl font-medium text-sm transition-all duration-200 border border-[var(--info)]/30 text-[var(--info)] hover:bg-[var(--info)]/10 min-h-[44px]"
            aria-label="ライブモードに戻る"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="m15 18-6-6 6-6"/>
            </svg>
            Live に戻る
          </button>
        ) : null
      ) : sessionMode === "live" ? (
        <button
          onClick={onSnapshot}
          disabled={!isReady}
          className={`inline-flex items-center gap-2 px-3 sm:px-5 py-2.5 rounded-xl font-medium text-sm transition-all duration-200 border min-h-[44px] ${
            isReady
              ? "border-[var(--border)] text-[var(--foreground-muted)] hover:bg-[var(--surface)] hover:text-[var(--foreground)] hover:border-[var(--foreground-subtle)]"
              : "border-[var(--border-subtle)] text-[var(--foreground-subtle)] cursor-not-allowed opacity-50"
          }`}
          aria-label="スナップショット保存"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
            <circle cx="12" cy="13" r="4"/>
          </svg>
          スナップショットを保存
        </button>
      ) : null}

      {/* Generate Diagram button (visible in both live and snapshot-review mode) */}
      {onGenerateDiagram && (
        <button
          onClick={onGenerateDiagram}
          disabled={!isReady || isGeneratingDiagram}
          className={`inline-flex items-center gap-2 px-3 sm:px-5 py-2.5 rounded-xl font-medium text-sm transition-all duration-200 border min-h-[44px] ${
            isReady && !isGeneratingDiagram
              ? "border-[var(--info)]/30 text-[var(--info)] hover:bg-[var(--info)]/10 hover:border-[var(--info)]/50"
              : "border-[var(--border-subtle)] text-[var(--foreground-subtle)] cursor-not-allowed opacity-50"
          }`}
          aria-label="ホワイトボードから図解を生成"
        >
          {isGeneratingDiagram ? (
            <Spinner />
          ) : (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect width="18" height="18" x="3" y="3" rx="2" />
              <path d="M3 9h18" />
              <path d="M9 21V9" />
            </svg>
          )}
          {isGeneratingDiagram ? "生成中..." : "図解生成"}
        </button>
      )}

      {/* New session button — shown when not active and snapshots exist */}
      {!isSessionActive && hasSnapshots && onNewSession && (
        <button
          onClick={onNewSession}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium transition-all duration-200 border border-[var(--border)] text-[var(--foreground-subtle)] hover:bg-[var(--surface)] hover:text-[var(--foreground)] min-h-[44px]"
          aria-label="新しいセッションを開始（スナップショットをクリア）"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 5v14M5 12h14" />
          </svg>
          新規セッション
        </button>
      )}
    </div>
  );
});
