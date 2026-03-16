"use client";

import { memo } from "react";
import { ConnectionState, AgentMood, AgentActivity } from "@/lib/types";

interface StatusBarProps {
  connectionState: ConnectionState;
  isAgentSpeaking: boolean;
  isUserSpeaking: boolean;
  sessionId: string | null;
  agentMood?: AgentMood;
  bargeInActive?: boolean;
  annotationCount?: number;
  analysisComponentCount?: number;
  agentActivity?: AgentActivity;
}

const connectionConfig: Record<
  ConnectionState,
  { color: string; label: string; ring?: string; shape: string; textColor: string }
> = {
  disconnected: { color: "bg-[var(--foreground-subtle)]", label: "未接続", shape: "rounded-sm", textColor: "text-[var(--foreground-subtle)]" },
  connecting: { color: "bg-[var(--warning)]", label: "接続中...", ring: "animate-dot-pulse", shape: "rounded-sm rotate-45", textColor: "text-[var(--warning)]" },
  connected: { color: "bg-[var(--accent)]", label: "接続済み", shape: "rounded-full", textColor: "text-[var(--accent)]" },
};

const moodConfig: Record<AgentMood, { emoji: string; label: string }> = {
  neutral: { emoji: "", label: "" },
  impressed: { emoji: "\u{1F44D}", label: "感心" },
  concerned: { emoji: "\u{1F914}", label: "懸念" },
  surprised: { emoji: "\u{1F62E}", label: "驚き" },
  thinking: { emoji: "\u{1F4AD}", label: "思考中" },
};

function AudioWave({ className }: { className?: string }) {
  return (
    <div className={`audio-wave ${className ?? ""}`} aria-hidden="true">
      <span /><span /><span /><span />
    </div>
  );
}

function buildStatusSummary(
  connectionState: ConnectionState,
  isAgentSpeaking: boolean,
  isUserSpeaking: boolean,
  bargeInActive: boolean,
  agentMood: AgentMood,
  annotationCount: number,
  agentActivity: AgentActivity,
) {
  const parts: string[] = [connectionConfig[connectionState].label];
  if (agentActivity === "analyzing" || agentActivity === "speaking") parts.push("レビュー中");
  if (isAgentSpeaking) parts.push("AI 発話中");
  if (isUserSpeaking) parts.push("聞き取り中");
  if (bargeInActive) parts.push("割り込み検出");
  if (annotationCount > 0) parts.push(`分析表示中 (${annotationCount}件)`);
  if (agentMood !== "neutral") parts.push(moodConfig[agentMood].label);
  return parts.join("、");
}

export const StatusBar = memo(function StatusBar({
  connectionState,
  isAgentSpeaking,
  isUserSpeaking,
  sessionId,
  agentMood = "neutral",
  bargeInActive = false,
  annotationCount = 0,
  analysisComponentCount = 0,
  agentActivity = "idle",
}: StatusBarProps) {
  const conn = connectionConfig[connectionState];
  const mood = moodConfig[agentMood];
  const isReviewing = agentActivity === "analyzing" || agentActivity === "speaking";

  return (
    <header
      className="flex items-center justify-between px-3 sm:px-5 py-2 sm:py-2.5 glass border-b border-[var(--border-subtle)]"
      role="banner"
    >
      {/* Left: Branding + Status */}
      <div
        className="flex items-center gap-3 sm:gap-5"
        role="status"
        aria-label={buildStatusSummary(connectionState, isAgentSpeaking, isUserSpeaking, bargeInActive, agentMood, annotationCount, agentActivity)}
      >
        {/* App branding */}
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-[var(--accent)] to-[var(--brand-700)] flex items-center justify-center shadow-sm">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--on-accent)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
              <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
            </svg>
          </div>
          <h1 className="text-sm font-semibold tracking-tight text-[var(--foreground)]">
            Archie
          </h1>
        </div>

        {/* Connection indicator — shape + color differentiates state */}
        <div
          className={`flex items-center gap-2 px-2 py-0.5 rounded-md transition-colors duration-300 ${
            connectionState === "connecting" ? "bg-[var(--warning)]/10" : connectionState === "connected" ? "bg-[var(--accent)]/10" : ""
          }`}
          aria-hidden="true"
        >
          <span
            className={`inline-block w-2 h-2 ${conn.shape} ${conn.color} ${conn.ring ?? ""}`}
          />
          <span className={`text-xs font-medium ${conn.textColor}`}>
            {conn.label}
          </span>
        </div>

        {/* Reviewing indicator */}
        {isReviewing && (
          <div
            className="flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-[var(--accent-muted)] animate-fade-in"
            aria-hidden="true"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--brand-400)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="animate-dot-pulse" aria-hidden="true">
              <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
            <span className="text-xs font-semibold text-[var(--brand-400)]">
              レビュー中
            </span>
          </div>
        )}

        {/* Speaking indicators */}
        {isAgentSpeaking && (
          <div className="flex items-center gap-2" aria-hidden="true">
            <AudioWave className="text-[var(--info)]" />
            <span className="text-xs text-[var(--info)] font-medium hidden sm:inline">AI 発話中</span>
          </div>
        )}

        {isUserSpeaking && (
          <div className="flex items-center gap-2" aria-hidden="true">
            <AudioWave className="text-[var(--accent)]" />
            <span className="text-xs text-[var(--accent)] font-medium hidden sm:inline">聞き取り中</span>
          </div>
        )}

        {/* Barge-in indicator */}
        {bargeInActive && (
          <div className="flex items-center gap-1.5 animate-fade-in" aria-hidden="true">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-[var(--warning)]" aria-hidden="true">
              <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/>
            </svg>
            <span className="text-xs text-[var(--warning)] font-medium hidden sm:inline">割り込み検出</span>
          </div>
        )}

        {/* Annotation active indicator */}
        {annotationCount > 0 && (
          <div className="flex items-center gap-1.5 animate-fade-in" aria-hidden="true">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-[var(--info)]" aria-hidden="true">
              <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0Z"/>
              <circle cx="12" cy="10" r="3"/>
            </svg>
            <span className="text-xs text-[var(--info)] font-medium hidden sm:inline">分析表示中</span>
            <span className="text-xs text-[var(--info)]/70 font-medium sm:hidden">{annotationCount}</span>
            <span className="text-xs text-[var(--info)]/70 font-medium hidden sm:inline">({annotationCount})</span>
          </div>
        )}

        {/* Perception Layer: detected component count */}
        {analysisComponentCount > 0 && (
          <div className="flex items-center gap-1.5 animate-fade-in" aria-hidden="true">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-[var(--brand-400)]" aria-hidden="true">
              <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
              <line x1="8" x2="16" y1="21" y2="21" />
              <line x1="12" x2="12" y1="17" y2="21" />
            </svg>
            <span className="text-xs text-[var(--brand-400)] font-medium hidden sm:inline">
              {analysisComponentCount} 検出
            </span>
          </div>
        )}

        {/* Mood indicator */}
        {agentMood !== "neutral" && mood.emoji && (
          <div className="flex items-center gap-1.5 mood-bounce" aria-hidden="true">
            <span className="text-sm">{mood.emoji}</span>
            <span className="text-xs text-[var(--foreground-muted)] font-medium hidden sm:inline">{mood.label}</span>
          </div>
        )}
      </div>

      {/* Right: Session info */}
      <div className="flex items-center gap-2">
        {sessionId ? (
          <span className="text-xs text-[var(--foreground-subtle)] font-mono px-2 py-0.5 rounded-md bg-[var(--surface)] border border-[var(--border-subtle)]">
            {sessionId.slice(0, 8)}
          </span>
        ) : (
          <span className="text-xs text-[var(--foreground-subtle)]">
            セッションなし
          </span>
        )}
      </div>
    </header>
  );
});
