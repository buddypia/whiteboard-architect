"use client";

import { memo, useEffect, useMemo, useRef } from "react";
import { ReviewNote, Snapshot } from "@/lib/types";
import { CATEGORIES, CATEGORY_LABEL_TEXT, SEVERITY_STYLE } from "@/lib/review-config";
import { downloadMarkdown } from "@/lib/markdown-export";
import { RadarChart } from "@/components/RadarChart";

interface SessionSummaryProps {
  notes: ReviewNote[];
  snapshots: Snapshot[];
  onDeleteSnapshot?: (id: string) => void;
  onClose: () => void;
}

// ---------- Score helpers ----------

const SEVERITY_SCORE: Record<string, number> = {
  critical: 1,
  warning: 3,
  info: 7,
  positive: 10,
};

function computeScores(notes: ReviewNote[]): Record<string, number> {
  const scores: Record<string, number> = {};
  for (const cat of CATEGORIES) {
    const catNotes = notes.filter((n) => n.category === cat);
    if (catNotes.length === 0) {
      scores[cat] = 5;
    } else {
      const sum = catNotes.reduce(
        (acc, n) => acc + (SEVERITY_SCORE[n.severity] ?? 5),
        0
      );
      scores[cat] = Math.round((sum / catNotes.length) * 10) / 10;
    }
  }
  return scores;
}

// ---------- Main component ----------

export const SessionSummary = memo(function SessionSummary({ notes, snapshots, onDeleteSnapshot, onClose }: SessionSummaryProps) {
  const scores = useMemo(() => computeScores(notes), [notes]);
  const dialogRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  // Focus trap + Escape key
  useEffect(() => {
    previousFocusRef.current = document.activeElement as HTMLElement | null;

    const dialog = dialogRef.current;
    if (!dialog) return;

    const focusableSelector =
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

    function getFocusableElements() {
      return Array.from(
        dialog!.querySelectorAll<HTMLElement>(focusableSelector)
      ).filter((el) => !el.hasAttribute("disabled"));
    }

    const focusables = getFocusableElements();
    if (focusables.length > 0) {
      focusables[0].focus();
    }

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }

      if (e.key === "Tab") {
        const elements = getFocusableElements();
        if (elements.length === 0) return;

        const first = elements[0];
        const last = elements[elements.length - 1];

        if (e.shiftKey) {
          if (document.activeElement === first) {
            e.preventDefault();
            last.focus();
          }
        } else {
          if (document.activeElement === last) {
            e.preventDefault();
            first.focus();
          }
        }
      }
    }

    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      previousFocusRef.current?.focus();
    };
  }, [onClose]);

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-label="セッションサマリー"
      className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--overlay)] backdrop-blur-sm animate-fade-in"
    >
      <article className="relative bg-[var(--surface)] border border-[var(--border)] rounded-2xl shadow-2xl w-[90vw] max-w-2xl max-h-[85vh] overflow-y-auto custom-scrollbar p-6">
        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute top-3 right-3 min-w-[44px] min-h-[44px] flex items-center justify-center text-[var(--foreground-subtle)] hover:text-[var(--foreground)] transition-colors rounded-lg hover:bg-[var(--surface-hover)]"
          aria-label="閉じる"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <line x1="18" x2="6" y1="6" y2="18" />
            <line x1="6" x2="18" y1="6" y2="18" />
          </svg>
        </button>

        <header>
          <h2 className="text-lg font-semibold mb-1">セッションサマリー</h2>
          <p className="text-xs text-[var(--foreground-muted)] mb-5">
            レビューノート {notes.length}件の分析結果
          </p>
        </header>

        {/* Radar chart */}
        <section aria-label="レーダーチャート">
          <RadarChart scores={scores} />

          {/* Score table */}
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 mt-4 mb-6">
            {CATEGORIES.map((cat) => (
              <div key={cat} className="text-center">
                <div className="text-lg font-bold text-[var(--accent)]">{scores[cat]}</div>
                <div className="text-xs text-[var(--foreground-muted)]">
                  {CATEGORY_LABEL_TEXT[cat]}
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Notes by category */}
        <section aria-label="カテゴリ別レビューノート" className="space-y-4 mb-6">
          {CATEGORIES.map((cat) => {
            const catNotes = notes.filter((n) => n.category === cat);
            if (catNotes.length === 0) return null;
            return (
              <div key={cat}>
                <h3 className="text-sm font-semibold text-[var(--foreground-muted)] mb-2">
                  {CATEGORY_LABEL_TEXT[cat]}
                </h3>
                <div className="space-y-2">
                  {catNotes.map((note) => {
                    const sev = SEVERITY_STYLE[note.severity] ?? SEVERITY_STYLE.info;
                    return (
                      <div
                        key={note.id}
                        className={`rounded-lg p-3 border border-[var(--border-subtle)] ${sev.bg}`}
                      >
                        <div className="flex items-center gap-2 mb-1">
                          <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${sev.color}`}>
                            {sev.label}
                          </span>
                        </div>
                        <p className="text-xs text-[var(--foreground)] leading-relaxed">
                          {note.finding}
                        </p>
                        {note.recommendation && (
                          <p className="text-xs text-[var(--foreground-muted)] mt-1.5 leading-relaxed">
                            推奨: {note.recommendation}
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </section>

        {/* Snapshot thumbnails */}
        {snapshots.length > 0 && (
          <section aria-label="スナップショット" className="mb-6">
            <h3 className="text-sm font-semibold text-[var(--foreground-muted)] mb-2">
              スナップショット
            </h3>
            <div className="flex gap-2 overflow-x-auto custom-scrollbar pb-2">
              {snapshots.map((snap) => (
                <div key={snap.id} className="relative group flex-shrink-0">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={snap.url || snap.dataUrl}
                    alt={snap.label || "スナップショット"}
                    className="h-20 w-auto rounded-lg border border-[var(--border-subtle)]"
                  />
                  {onDeleteSnapshot && (
                    <button
                      onClick={() => onDeleteSnapshot(snap.id)}
                      className="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/60 text-white/80 opacity-0 group-hover:opacity-100 flex items-center justify-center hover:bg-[var(--destructive)] hover:text-white transition-all"
                      aria-label="スナップショットを削除"
                      title="削除"
                    >
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <line x1="18" x2="6" y1="6" y2="18"/>
                        <line x1="6" x2="18" y1="6" y2="18"/>
                      </svg>
                    </button>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Actions */}
        <footer className="flex gap-3">
          <button
            onClick={() => downloadMarkdown(notes, scores)}
            className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-[var(--on-accent)] text-sm font-medium transition-colors min-h-[44px]"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" x2="12" y1="15" y2="3" />
            </svg>
            Markdownをダウンロード
          </button>
          <button
            onClick={onClose}
            className="px-4 py-2.5 rounded-lg border border-[var(--border)] text-sm text-[var(--foreground-muted)] hover:text-[var(--foreground)] hover:bg-[var(--surface-hover)] transition-colors min-h-[44px]"
          >
            閉じる
          </button>
        </footer>
      </article>
    </div>
  );
});
