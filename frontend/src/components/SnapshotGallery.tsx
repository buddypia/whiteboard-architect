"use client";

import { memo, useRef, useState } from "react";
import { Snapshot } from "@/lib/types";
import { formatTimeShort } from "@/lib/format";

interface SnapshotGalleryProps {
  snapshots: Snapshot[];
  onDelete?: (id: string) => void;
  onSelect?: (snapshot: Snapshot) => void;
  onUpload?: (file: File) => void;
  selectedId?: string | null;
}

const ACCEPTED_IMAGE_TYPES = "image/jpeg,image/png,image/webp";

export const SnapshotGallery = memo(function SnapshotGallery({ snapshots, onDelete, onSelect, onUpload, selectedId }: SnapshotGalleryProps) {
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Show the gallery if there are snapshots OR if upload is available
  if (snapshots.length === 0 && !onUpload) return null;

  const handleDelete = (id: string) => {
    if (confirmId !== id) {
      setConfirmId(id);
      return;
    }
    setDeletingId(id);
    setConfirmId(null);
    onDelete?.(id);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && onUpload) {
      onUpload(file);
    }
    // Reset so the same file can be re-selected
    e.target.value = "";
  };

  return (
    <section
      className="px-3 sm:px-4 py-2 sm:py-3 glass border-t border-[var(--border-subtle)]"
      aria-label="スナップショットギャラリー"
    >
      <div className="flex items-center gap-2 mb-2">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-[var(--foreground-subtle)]" aria-hidden="true">
          <rect width="18" height="18" x="3" y="3" rx="2" ry="2"/>
          <circle cx="9" cy="9" r="2"/>
          <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>
        </svg>
        <h3 className="text-xs font-semibold text-[var(--foreground-subtle)] uppercase tracking-wider">
          スナップショット
        </h3>
        {snapshots.length > 0 && (
          <span className="text-xs text-[var(--foreground-subtle)] tabular-nums">
            {snapshots.length}
          </span>
        )}
      </div>

      <div className="flex gap-2.5 overflow-x-auto pb-1 custom-scrollbar">
        {/* Upload button */}
        {onUpload && (
          <div className="flex-shrink-0">
            <input
              ref={fileInputRef}
              type="file"
              accept={ACCEPTED_IMAGE_TYPES}
              onChange={handleFileChange}
              className="hidden"
              aria-label="画像をアップロード"
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              className="w-28 h-20 rounded-lg border-2 border-dashed border-[var(--border)] hover:border-[var(--accent)]/50 bg-[var(--surface)] hover:bg-[var(--surface-hover)] transition-all duration-200 flex flex-col items-center justify-center gap-1 group cursor-pointer"
              aria-label="画像をアップロード"
              title="画像をアップロード"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-[var(--foreground-subtle)] group-hover:text-[var(--accent)] transition-colors" aria-hidden="true">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="17 8 12 3 7 8" />
                <line x1="12" x2="12" y1="3" y2="15" />
              </svg>
              <span className="text-[10px] text-[var(--foreground-subtle)] group-hover:text-[var(--accent)] transition-colors">
                アップロード
              </span>
            </button>
          </div>
        )}

        {snapshots.map((snap) => (
          <div key={snap.id} className="flex-shrink-0 group animate-slide-up relative">
            <div
              onClick={() => onSelect?.(snap)}
              role={onSelect ? "button" : undefined}
              tabIndex={onSelect ? 0 : undefined}
              onKeyDown={onSelect ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelect(snap); } } : undefined}
              className={`w-28 h-20 rounded-lg overflow-hidden border transition-all duration-200 relative ${
                selectedId === snap.id
                  ? "border-[var(--info)] ring-2 ring-[var(--info)]/30 shadow-lg scale-105"
                  : "border-[var(--border)] group-hover:border-[var(--accent)]/40 group-hover:shadow-md"
              } ${onSelect ? "cursor-pointer" : ""}`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={snap.url || snap.dataUrl}
                alt={snap.label || `${formatTimeShort(snap.timestamp)} のスナップショット`}
                className={`w-full h-full object-cover transition-transform duration-300 group-hover:scale-105 ${deletingId === snap.id ? "opacity-30" : ""}`}
                loading="lazy"
                width={112}
                height={80}
              />

              {/* Upload origin badge */}
              {snap.origin === "upload" && (
                <div className="absolute bottom-1 left-1 bg-[var(--overlay-heavy)] backdrop-blur-sm rounded px-1 py-0.5">
                  <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-[var(--accent)]" aria-hidden="true">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <polyline points="17 8 12 3 7 8" />
                    <line x1="12" x2="12" y1="3" y2="15" />
                  </svg>
                </div>
              )}

              {onDelete && deletingId !== snap.id && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDelete(snap.id);
                  }}
                  onBlur={() => {
                    if (confirmId === snap.id) {
                      setTimeout(() => setConfirmId(null), 150);
                    }
                  }}
                  className={`absolute top-1 right-1 w-5 h-5 rounded-full flex items-center justify-center transition-all duration-200 ${
                    confirmId === snap.id
                      ? "bg-[var(--destructive)] text-white opacity-100 scale-110"
                      : "bg-black/60 text-white/80 opacity-0 group-hover:opacity-100 hover:bg-[var(--destructive)] hover:text-white"
                  }`}
                  aria-label={confirmId === snap.id ? "削除を確定" : "スナップショットを削除"}
                  title={confirmId === snap.id ? "もう一度クリックで削除" : "削除"}
                >
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <line x1="18" x2="6" y1="6" y2="18"/>
                    <line x1="6" x2="18" y1="6" y2="18"/>
                  </svg>
                </button>
              )}
            </div>
            <p className="text-xs text-[var(--foreground-subtle)] mt-1 text-center tabular-nums">
              {formatTimeShort(snap.timestamp)}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
});
