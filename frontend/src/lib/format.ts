/**
 * Shared date/time formatting utilities using Intl.DateTimeFormat.
 */

const timeWithSeconds = new Intl.DateTimeFormat("ja-JP", {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

const timeWithoutSeconds = new Intl.DateTimeFormat("ja-JP", {
  hour: "2-digit",
  minute: "2-digit",
});

export function formatTime(timestamp: number, options?: { seconds?: boolean }): string {
  const formatter = options?.seconds !== false ? timeWithSeconds : timeWithoutSeconds;
  return formatter.format(new Date(timestamp));
}

export function formatTimeShort(timestamp: number): string {
  return timeWithoutSeconds.format(new Date(timestamp));
}
