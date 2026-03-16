"use client";

import { memo, useCallback, useState } from "react";

interface DiagramPanelProps {
  diagramUrl: string | null;
  diagramDescription: string | null;
  errorMessage: string | null;
  isGenerating: boolean;
  onClose: () => void;
}

export const DiagramPanel = memo(function DiagramPanel({
  diagramUrl,
  diagramDescription,
  errorMessage,
  isGenerating,
  onClose,
}: DiagramPanelProps) {
  const [expanded, setExpanded] = useState(false);

  const isVisible = diagramUrl || errorMessage || isGenerating;

  const handleDownload = useCallback(async () => {
    if (!diagramUrl) return;
    try {
      const res = await fetch(diagramUrl);
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = blobUrl;
      const ext = diagramUrl.endsWith(".svg") ? "svg" : "png";
      a.download = `whiteboard-diagram-${Date.now()}.${ext}`;
      a.click();
      URL.revokeObjectURL(blobUrl);
    } catch {
      window.open(diagramUrl, "_blank");
    }
  }, [diagramUrl]);

  const handleClose = useCallback(() => {
    setExpanded(false);
    onClose();
  }, [onClose]);

  if (!isVisible) return null;

  // --- Expanded view: overlay within the camera area ---
  if (expanded) {
    return (
      <div
        className="absolute inset-0 z-50 flex items-center justify-center bg-[var(--overlay-heavy)] backdrop-blur-sm rounded-xl diagram-expand-in"
        onClick={(e) => {
          if (e.target === e.currentTarget) setExpanded(false);
        }}
      >
        <div className="relative bg-[var(--surface)] border border-[var(--border)] rounded-xl shadow-2xl w-[calc(100%-1.5rem)] max-h-[calc(100%-1.5rem)] flex flex-col overflow-hidden diagram-expand-in">
          {/* Header */}
          <header className="flex items-center gap-2 px-4 py-3 border-b border-[var(--border-subtle)] shrink-0">
            <div className="flex-shrink-0 w-6 h-6 rounded-md bg-[var(--accent-muted)] flex items-center justify-center">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <rect width="18" height="18" x="3" y="3" rx="2" />
                <path d="M3 9h18" />
                <path d="M9 21V9" />
              </svg>
            </div>
            <h2 className="text-sm font-semibold text-[var(--foreground)] flex-1 min-w-0">
              図解プレビュー
            </h2>
            <button
              onClick={() => setExpanded(false)}
              className="text-[var(--foreground-subtle)] hover:text-[var(--foreground)] transition-colors w-8 h-8 flex items-center justify-center rounded-md hover:bg-[var(--surface-hover)]"
              aria-label="縮小"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <polyline points="4 14 10 14 10 20" />
                <polyline points="20 10 14 10 14 4" />
                <line x1="14" x2="21" y1="10" y2="3" />
                <line x1="3" x2="10" y1="21" y2="14" />
              </svg>
            </button>
            <button
              onClick={handleClose}
              className="text-[var(--foreground-subtle)] hover:text-[var(--foreground)] transition-colors w-8 h-8 flex items-center justify-center rounded-md hover:bg-[var(--surface-hover)]"
              aria-label="閉じる"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <line x1="18" x2="6" y1="6" y2="18" />
                <line x1="6" x2="18" y1="6" y2="18" />
              </svg>
            </button>
          </header>

          {/* Content */}
          <div className="flex-1 overflow-auto p-4">
            {diagramUrl && (
              <div className="flex flex-col gap-2">
                <div className="rounded-lg overflow-hidden border border-[var(--border)] bg-[var(--diagram-bg)]">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={diagramUrl}
                    alt={diagramDescription || "生成されたアーキテクチャ図解"}
                    className="w-full h-auto"
                  />
                </div>
                {diagramDescription && (
                  <p className="text-xs text-[var(--foreground-muted)] px-1 break-words">
                    {diagramDescription}
                  </p>
                )}
              </div>
            )}
          </div>

          {/* Footer */}
          {diagramUrl && (
            <footer className="flex gap-2 justify-end px-4 py-2.5 border-t border-[var(--border-subtle)] shrink-0">
              <button
                onClick={handleClose}
                className="px-3 py-1.5 text-xs rounded-[var(--radius-md)] bg-[var(--surface-hover)] text-[var(--foreground)] hover:bg-[var(--surface-active)] transition-colors"
              >
                閉じる
              </button>
              <button
                onClick={handleDownload}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-[var(--radius-md)] bg-[var(--accent)] text-[var(--on-accent)] hover:bg-[var(--accent-hover)] transition-colors"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="7 10 12 15 17 10" />
                  <line x1="12" x2="12" y1="15" y2="3" />
                </svg>
                ダウンロード
              </button>
            </footer>
          )}
        </div>
      </div>
    );
  }

  // --- Collapsed PiP thumbnail ---
  return (
    <div className="absolute bottom-3 right-3 z-50 diagram-pip-in">
      {/* Generating state */}
      {isGenerating && !diagramUrl && !errorMessage && (
        <div className="w-36 h-24 rounded-lg bg-[var(--surface)] border border-[var(--accent)]/30 shadow-lg flex flex-col items-center justify-center gap-2 backdrop-blur-sm">
          <div className="flex gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent)] animate-dot-pulse" style={{ animationDelay: "0ms" }} />
            <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent)] animate-dot-pulse" style={{ animationDelay: "150ms" }} />
            <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent)] animate-dot-pulse" style={{ animationDelay: "300ms" }} />
          </div>
          <span className="text-[10px] text-[var(--foreground-muted)]">図解を生成中...</span>
        </div>
      )}

      {/* Error state */}
      {errorMessage && !diagramUrl && (
        <button
          onClick={handleClose}
          className="w-36 h-24 rounded-lg bg-[var(--surface)] border border-[var(--destructive)]/30 shadow-lg flex flex-col items-center justify-center gap-1.5 backdrop-blur-sm hover:border-[var(--destructive)]/50 transition-colors cursor-pointer"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--destructive)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" x2="12" y1="8" y2="12" />
            <line x1="12" x2="12.01" y1="16" y2="16" />
          </svg>
          <span className="text-[10px] text-[var(--destructive)] px-2 text-center line-clamp-2">
            生成エラー
          </span>
          <span className="text-[9px] text-[var(--foreground-subtle)]">タップで閉じる</span>
        </button>
      )}

      {/* Diagram thumbnail */}
      {diagramUrl && (
        <button
          onClick={() => setExpanded(true)}
          className="group relative w-40 rounded-lg overflow-hidden border border-[var(--border)] shadow-lg hover:shadow-xl hover:border-[var(--accent)]/50 transition-all duration-200 cursor-pointer bg-[var(--diagram-bg)]"
          aria-label="図解を拡大表示"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={diagramUrl}
            alt={diagramDescription || "生成されたアーキテクチャ図解"}
            className="w-full h-auto"
          />
          {/* Hover overlay with expand icon */}
          <div className="absolute inset-0 bg-[var(--overlay)]/0 group-hover:bg-[var(--overlay)] transition-colors duration-200 flex items-center justify-center">
            <div className="opacity-0 group-hover:opacity-100 transition-opacity duration-200 w-8 h-8 rounded-full bg-[var(--surface)]/90 flex items-center justify-center shadow-md">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--foreground)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <polyline points="15 3 21 3 21 9" />
                <polyline points="9 21 3 21 3 15" />
                <line x1="21" x2="14" y1="3" y2="10" />
                <line x1="3" x2="10" y1="21" y2="14" />
              </svg>
            </div>
          </div>
          {/* Close button */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              handleClose();
            }}
            className="absolute top-1 right-1 w-5 h-5 rounded-full bg-[var(--overlay)] hover:bg-[var(--overlay-heavy)] flex items-center justify-center transition-colors opacity-0 group-hover:opacity-100"
            aria-label="図解を閉じる"
          >
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="var(--foreground)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <line x1="18" x2="6" y1="6" y2="18" />
              <line x1="6" x2="18" y1="6" y2="18" />
            </svg>
          </button>
          {/* Label bar */}
          <div className="absolute bottom-0 inset-x-0 bg-[var(--surface)]/90 backdrop-blur-sm px-2 py-1 border-t border-[var(--border-subtle)]">
            <span className="text-[10px] text-[var(--foreground-muted)] font-medium">図解</span>
          </div>
        </button>
      )}
    </div>
  );
});
