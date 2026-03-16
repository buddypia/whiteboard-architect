"use client";

import { memo } from "react";
import { Snapshot, Annotation, SessionMode } from "@/lib/types";
import { formatTimeShort } from "@/lib/format";
import { AnnotationOverlay } from "@/components/AnnotationOverlay";

interface SnapshotReviewViewProps {
  snapshot: Snapshot;
  annotations?: Annotation[];
  activeAnnotationId?: string | null;
  sessionMode?: SessionMode;
  onClose: () => void;
}

export const SnapshotReviewView = memo(function SnapshotReviewView({
  snapshot,
  annotations = [],
  activeAnnotationId,
  sessionMode = "live",
  onClose,
}: SnapshotReviewViewProps) {
  const imageSrc = snapshot.url || snapshot.dataUrl;

  return (
    <div className="relative flex flex-col items-center gap-2 w-full max-w-2xl animate-snapshot-expand">
      <div className="relative w-full overflow-hidden rounded-xl aspect-[4/3] animate-review-glow">
        {/* Border frame */}
        <div className="absolute inset-0 rounded-xl border-2 border-[var(--info)]/40 z-10 pointer-events-none" />

        {/* Review mode badge */}
        <div className="absolute top-2 left-2 z-40 flex items-center gap-1.5 bg-[var(--info)]/15 backdrop-blur-sm border border-[var(--info)]/30 rounded-full px-2.5 py-1 text-xs font-medium text-[var(--info)]">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.3-4.3" />
          </svg>
          スナップショットレビュー
        </div>

        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={imageSrc}
          alt={snapshot.label || `${formatTimeShort(snapshot.timestamp)} のスナップショット`}
          className="w-full h-full object-cover bg-[var(--surface)]"
        />

        {/* Annotation overlay (shared component) */}
        <AnnotationOverlay
          annotations={annotations}
          activeAnnotationId={activeAnnotationId}
        />

        {/* Annotation count badge */}
        {annotations.length > 0 && (
          <div className="absolute top-2 right-2 z-40 flex items-center gap-1 bg-[var(--overlay-heavy)] backdrop-blur-sm rounded-full px-2 py-0.5 text-xs font-bold text-[var(--info)] border border-[var(--info)]/30">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
              <circle cx="12" cy="12" r="10" />
              <path d="M12 8v4l3 1.5" />
            </svg>
            {annotations.length}
          </div>
        )}
      </div>

      {/* Snapshot metadata + back to live */}
      <div className="flex items-center gap-2 text-xs text-[var(--foreground-subtle)]">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect width="18" height="18" x="3" y="3" rx="2" ry="2"/>
          <circle cx="9" cy="9" r="2"/>
          <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>
        </svg>
        <span className="tabular-nums">{formatTimeShort(snapshot.timestamp)}</span>
        {snapshot.label && (
          <span className="text-[var(--foreground-muted)] truncate max-w-[200px]">{snapshot.label}</span>
        )}
        <button
          onClick={onClose}
          className="ml-auto flex items-center gap-1.5 px-3 py-2.5 rounded-md text-[var(--foreground-subtle)] hover:text-[var(--foreground)] hover:bg-[var(--surface)] transition-colors min-h-[44px]"
          aria-label={sessionMode === "live" ? "ライブモードに戻る" : "画像選択に戻る"}
        >
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="m15 18-6-6 6-6"/>
          </svg>
          {sessionMode === "live" ? "Live に戻る" : "画像選択に戻る"}
        </button>
      </div>
    </div>
  );
});
