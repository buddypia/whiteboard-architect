"use client";

import { memo, useEffect, useRef, useState } from "react";
import { ReviewNote } from "@/lib/types";
import { SEVERITY_CONFIG, CATEGORY_LABELS } from "@/lib/review-config";

interface ReviewNotesPanelProps {
  notes: ReviewNote[];
}

export const ReviewNotesPanel = memo(function ReviewNotesPanel({ notes }: ReviewNotesPanelProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const prevNotesCountRef = useRef(notes.length);

  useEffect(() => {
    // Auto-expand when first note arrives
    if (prevNotesCountRef.current === 0 && notes.length > 0) {
      setIsExpanded(true);
    }
    // Auto-scroll to bottom when new notes are added
    if (notes.length > prevNotesCountRef.current && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
    prevNotesCountRef.current = notes.length;
  }, [notes.length]);

  if (notes.length === 0) return null;

  return (
    <section
      className={`border-t border-[var(--border-subtle)] flex flex-col animate-fade-in${isExpanded ? " flex-1 min-h-0" : ""}`}
      aria-label="レビューノート"
    >
      {/* Header */}
      <button
        onClick={() => setIsExpanded((prev) => !prev)}
        className="flex items-center gap-2 px-4 py-2.5 w-full text-left hover:bg-[var(--surface-hover)] transition-colors shrink-0"
        aria-expanded={isExpanded}
        aria-controls="review-notes-list"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-[var(--foreground-subtle)]" aria-hidden="true">
          <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/>
          <polyline points="14 2 14 8 20 8"/>
          <line x1="16" x2="8" y1="13" y2="13"/>
          <line x1="16" x2="8" y1="17" y2="17"/>
        </svg>
        <h3 className="text-xs font-semibold text-[var(--foreground-muted)] uppercase tracking-wider">
          レビューノート
        </h3>
        <span className="text-xs font-medium px-1.5 py-0.5 rounded-full bg-[var(--accent)]/10 text-[var(--accent)] border border-[var(--accent)]/20 tabular-nums">
          {notes.length}
        </span>
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`ml-auto text-[var(--foreground-subtle)] transition-transform duration-200 ${isExpanded ? "rotate-180" : ""}`}
          aria-hidden="true"
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {/* Notes list */}
      <div
        id="review-notes-list"
        ref={scrollRef}
        className={`px-3 pb-3 overflow-y-auto custom-scrollbar space-y-2 ${isExpanded ? "flex-1 min-h-0" : "max-h-56"}`}
      >
        {notes.map((note) => {
          const sev = SEVERITY_CONFIG[note.severity] ?? SEVERITY_CONFIG.info;
          const cat = CATEGORY_LABELS[note.category];

          return (
            <div
              key={note.id}
              className={`rounded-lg p-3 border text-sm animate-slide-up ${sev.bg}`}
            >
              <div className="flex items-center gap-2 mb-1.5">
                {/* Category icon */}
                {cat && (
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={sev.color} aria-hidden="true">
                    <path d={cat.icon} />
                  </svg>
                )}
                <span className={`text-xs font-medium ${sev.color}`}>
                  {cat?.label ?? note.category}
                </span>
                <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${sev.color} bg-current/5`}>
                  {sev.label}
                </span>
              </div>
              <p className="text-[var(--foreground)] text-xs leading-relaxed break-words">
                {note.finding}
              </p>
              {note.recommendation && (
                <p className="text-[var(--foreground-muted)] text-xs mt-1.5 leading-relaxed">
                  推奨: {note.recommendation}
                </p>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
});
