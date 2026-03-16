"use client";

import { memo, useCallback, useEffect, useRef } from "react";
import ReactMarkdown from "react-markdown";
import { TranscriptEntry, ConnectionState } from "@/lib/types";
import { formatTime } from "@/lib/format";

interface TranscriptPanelProps {
  transcripts: TranscriptEntry[];
  activeAnnotationId?: string | null;
  isSessionActive?: boolean;
  connectionState?: ConnectionState;
  isAgentThinking?: boolean;
  viewMode?: "live" | "snapshot-review";
}

function Avatar({ role }: { role: "user" | "agent" | "thought" }) {
  if (role === "agent") {
    return (
      <div className="flex-shrink-0 w-7 h-7 rounded-lg bg-gradient-to-br from-[var(--accent)] to-[var(--brand-700)] flex items-center justify-center text-xs font-bold text-[var(--on-accent)] shadow-sm">
        A
      </div>
    );
  }
  return (
    <div className="flex-shrink-0 w-7 h-7 rounded-lg bg-[var(--surface-hover)] flex items-center justify-center text-xs font-bold text-[var(--foreground-muted)] border border-[var(--border-subtle)]">
      U
    </div>
  );
}

function ThinkingIndicator() {
  return (
    <div className="flex gap-2.5 flex-row animate-fade-in">
      <Avatar role="agent" />
      <div className="bg-[var(--surface)] border border-[var(--border-subtle)] rounded-xl rounded-tl-sm px-3.5 py-3">
        <div className="thinking-dots flex items-center gap-1" aria-label="Archie が考え中">
          <span className="w-1.5 h-1.5 rounded-full bg-[var(--foreground-muted)]" />
          <span className="w-1.5 h-1.5 rounded-full bg-[var(--foreground-muted)]" />
          <span className="w-1.5 h-1.5 rounded-full bg-[var(--foreground-muted)]" />
        </div>
      </div>
    </div>
  );
}

function EmptyState({
  isSessionActive,
  connectionState,
}: {
  isSessionActive: boolean;
  connectionState: ConnectionState;
}) {
  if (!isSessionActive) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 animate-fade-in">
        <div className="w-14 h-14 rounded-2xl bg-[var(--surface)] border border-[var(--border-subtle)] flex items-center justify-center">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-[var(--foreground-subtle)]" aria-hidden="true">
            <path d="M12 18.5a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13Z" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M12 8.5v4l2.5 1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </div>
        <p className="text-[var(--foreground-subtle)] text-sm text-center">
          セッションを開始して<br />会話を始めましょう
        </p>
      </div>
    );
  }

  if (connectionState === "connecting") {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 animate-fade-in">
        <div className="w-14 h-14 rounded-2xl bg-[var(--surface)] border border-[var(--warning)]/30 flex items-center justify-center">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" className="animate-spin text-[var(--warning)]" aria-hidden="true">
            <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeDasharray="50 20" />
          </svg>
        </div>
        <p className="text-[var(--warning)] text-sm text-center font-medium">
          AI に接続中...
        </p>
        <p className="text-[var(--foreground-subtle)] text-xs text-center">
          Gemini Live API へ接続しています
        </p>
      </div>
    );
  }

  // Connected but no messages yet
  return (
    <div className="flex flex-col items-center justify-center h-full gap-3 animate-fade-in">
      <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-[var(--accent)]/20 to-[var(--brand-700)]/20 border border-[var(--accent)]/30 flex items-center justify-center animate-breathing-glow-subtle">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-[var(--accent)]" aria-hidden="true">
          <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3Z" strokeLinecap="round" strokeLinejoin="round"/>
          <path d="M19 10v2a7 7 0 0 1-14 0v-2" strokeLinecap="round" strokeLinejoin="round"/>
          <line x1="12" x2="12" y1="19" y2="23" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </div>
      <p className="text-[var(--accent)] text-sm text-center font-medium">
        Archie が待機中
      </p>
      <p className="text-[var(--foreground-subtle)] text-xs text-center">
        ホワイトボードをカメラに向けて<br />話しかけてみてください
      </p>
    </div>
  );
}

export const TranscriptPanel = memo(function TranscriptPanel({
  transcripts,
  activeAnnotationId,
  isSessionActive = false,
  connectionState = "disconnected",
  isAgentThinking = false,
  viewMode = "live",
}: TranscriptPanelProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const isNearBottomRef = useRef(true);

  const checkNearBottom = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    isNearBottomRef.current =
      el.scrollHeight - el.scrollTop - el.clientHeight < 100;
  }, []);

  useEffect(() => {
    if (scrollRef.current && isNearBottomRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [transcripts, isAgentThinking]);

  return (
    <section className="flex flex-col flex-1 min-h-0" aria-label="会話トランスクリプト">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-[var(--border-subtle)]">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-[var(--foreground-subtle)]" aria-hidden="true">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
        </svg>
        <h2 className="text-xs font-semibold text-[var(--foreground-muted)] uppercase tracking-wider">
          会話
        </h2>
        {isSessionActive && connectionState === "connected" && (
          viewMode === "snapshot-review" ? (
            <span className="inline-flex items-center gap-1 text-xs text-[var(--info)] ml-1">
              <span className="w-1 h-1 rounded-full bg-[var(--info)]" />
              REVIEW
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 text-xs text-[var(--accent)] ml-1">
              <span className="w-1 h-1 rounded-full bg-[var(--accent)]" />
              LIVE
            </span>
          )
        )}
        {transcripts.length > 0 && (
          <span className="text-xs text-[var(--foreground-subtle)] ml-auto tabular-nums">
            {transcripts.length}
          </span>
        )}
      </div>

      {/* Messages */}
      <div
        ref={scrollRef}
        onScroll={checkNearBottom}
        className="flex-1 overflow-y-auto p-4 space-y-4 custom-scrollbar"
        role="log"
        aria-live="polite"
        aria-label="会話ログ"
      >
        {transcripts.length === 0 && (
          <EmptyState isSessionActive={isSessionActive} connectionState={connectionState} />
        )}

        {transcripts.filter((e) => e.role !== "thought").map((entry) => (
            <div
              key={entry.id}
              className={`flex gap-2.5 animate-slide-up ${
                entry.role === "user" ? "flex-row-reverse" : "flex-row"
              }`}
            >
              <Avatar role={entry.role} />
              <div
                className={`min-w-0 rounded-xl relative max-w-[85%] px-3.5 py-2.5 ${
                  entry.role === "user"
                    ? "bg-[var(--accent)]/90 text-[var(--on-accent)] rounded-tr-sm"
                    : "bg-[var(--surface)] text-[var(--foreground)] border border-[var(--border-subtle)] rounded-tl-sm"
                }`}
              >
                {/* Pin icon for speech-linked annotation */}
                {entry.role === "agent" && activeAnnotationId && (
                  <div className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-[var(--warning)] flex items-center justify-center animate-fade-in z-10" title="ホワイトボード参照中">
                    <svg width="8" height="8" viewBox="0 0 24 24" fill="var(--on-accent)" aria-hidden="true">
                      <path d="M16 12V4h1V2H7v2h1v8l-2 2v2h5.2v6h1.6v-6H18v-2l-2-2z"/>
                    </svg>
                  </div>
                )}

                <div className="text-sm leading-relaxed break-words transcript-markdown" style={{ overflowWrap: "anywhere" }}>
                  <ReactMarkdown>{entry.translation || entry.text}</ReactMarkdown>
                </div>
                <p
                  className={`text-[10px] mt-1.5 tabular-nums text-right ${
                    entry.role === "user"
                      ? "text-[var(--on-accent)]/70"
                      : "text-[var(--foreground-subtle)]"
                  }`}
                >
                  {formatTime(entry.timestamp)}
                </p>
              </div>
            </div>
          ))}

        {/* Agent thinking indicator */}
        {isAgentThinking && <ThinkingIndicator />}
      </div>
    </section>
  );
});
