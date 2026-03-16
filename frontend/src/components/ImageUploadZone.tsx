"use client";

import { memo, useRef, useCallback, useState } from "react";

interface ImageUploadZoneProps {
  onUpload: (file: File) => void;
  isSessionActive: boolean;
}

const ACCEPTED_IMAGE_TYPES = "image/jpeg,image/png,image/webp";

export const ImageUploadZone = memo(function ImageUploadZone({
  onUpload,
  isSessionActive,
}: ImageUploadZoneProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragOver, setIsDragOver] = useState(false);

  const handleFile = useCallback(
    (file: File) => {
      if (
        file.type === "image/jpeg" ||
        file.type === "image/png" ||
        file.type === "image/webp"
      ) {
        onUpload(file);
      }
    },
    [onUpload],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragOver(false);
      const file = e.dataTransfer.files[0];
      if (file) handleFile(file);
    },
    [handleFile],
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
  }, []);

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) handleFile(file);
      e.target.value = "";
    },
    [handleFile],
  );

  return (
    <div
      className={`relative flex flex-col items-center justify-center gap-4 w-full max-w-2xl aspect-[4/3] rounded-xl border-2 border-dashed transition-all duration-200 ${
        isDragOver
          ? "border-[var(--accent)] bg-[var(--accent)]/10 scale-[1.01]"
          : "border-[var(--border)] bg-[var(--surface)] hover:border-[var(--accent)]/50 hover:bg-[var(--surface-hover)]"
      }`}
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
    >
      <input
        ref={fileInputRef}
        type="file"
        accept={ACCEPTED_IMAGE_TYPES}
        onChange={handleFileChange}
        className="hidden"
        aria-label="画像をアップロード"
      />

      <div className="flex flex-col items-center gap-3 text-center px-6">
        <div className="w-16 h-16 rounded-2xl bg-[var(--accent)]/10 flex items-center justify-center">
          <svg
            width="28"
            height="28"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="text-[var(--accent)]"
            aria-hidden="true"
          >
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="17 8 12 3 7 8" />
            <line x1="12" x2="12" y1="3" y2="15" />
          </svg>
        </div>

        <div>
          <p className="text-sm font-medium text-[var(--foreground)]">
            {isSessionActive
              ? "ホワイトボードの画像をアップロード"
              : "セッション開始後に画像をアップロードできます"}
          </p>
          <p className="text-xs text-[var(--foreground-muted)] mt-1">
            ドラッグ&ドロップ、またはクリックして選択（JPEG / PNG / WebP）
          </p>
        </div>

        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={!isSessionActive}
          className={`inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 ${
            isSessionActive
              ? "bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-[var(--on-accent)] shadow-md"
              : "bg-[var(--surface-hover)] text-[var(--foreground-subtle)] cursor-not-allowed"
          }`}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <rect width="18" height="18" x="3" y="3" rx="2" ry="2" />
            <circle cx="9" cy="9" r="2" />
            <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
          </svg>
          画像を選択
        </button>
      </div>
    </div>
  );
});
