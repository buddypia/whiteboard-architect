import { ReviewNote } from "@/lib/types";

export const SEVERITY_CONFIG: Record<
  ReviewNote["severity"],
  { color: string; bg: string; label: string }
> = {
  critical: { color: "text-[var(--destructive)]", bg: "bg-[var(--destructive)]/10 border-[var(--destructive)]/20", label: "重大" },
  warning: { color: "text-[var(--warning)]", bg: "bg-[var(--warning)]/10 border-[var(--warning)]/20", label: "警告" },
  info: { color: "text-[var(--info)]", bg: "bg-[var(--info)]/10 border-[var(--info)]/20", label: "情報" },
  positive: { color: "text-[var(--positive)]", bg: "bg-[var(--positive)]/10 border-[var(--positive)]/20", label: "良好" },
};

export const SEVERITY_STYLE: Record<
  string,
  { color: string; bg: string; label: string }
> = {
  critical: { color: "text-[var(--destructive)]", bg: "bg-[var(--destructive)]/10", label: "重大" },
  warning: { color: "text-[var(--warning)]", bg: "bg-[var(--warning)]/10", label: "警告" },
  info: { color: "text-[var(--info)]", bg: "bg-[var(--info)]/10", label: "情報" },
  positive: { color: "text-[var(--positive)]", bg: "bg-[var(--positive)]/10", label: "良好" },
};

export const CATEGORIES = [
  "security",
  "scalability",
  "reliability",
  "cost",
  "operations",
] as const;

export const CATEGORY_LABELS: Record<string, { label: string; icon: string }> = {
  security: { label: "セキュリティ", icon: "M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" },
  scalability: { label: "スケーラビリティ", icon: "M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" },
  reliability: { label: "信頼性", icon: "M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0 1 12 2.944a11.955 11.955 0 0 1 8.618 3.04A12.02 12.02 0 0 0 12 21 12.02 12.02 0 0 0 3.382 5.984" },
  cost: { label: "コスト", icon: "M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" },
  operations: { label: "運用", icon: "M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" },
};

export const CATEGORY_LABEL_TEXT: Record<string, string> = {
  security: "セキュリティ",
  scalability: "スケーラビリティ",
  reliability: "信頼性",
  cost: "コスト",
  operations: "運用",
};

export const SEVERITY_LABELS: Record<string, string> = {
  critical: "重大",
  warning: "警告",
  info: "情報",
  positive: "良好",
};
