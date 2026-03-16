"use client";

import { memo, useEffect, useRef, useState } from "react";
import { WhiteboardAnalysisMessage } from "@/lib/types";

interface WhiteboardAnalysisPanelProps {
  analysis: WhiteboardAnalysisMessage | null;
}

const COMPONENT_TYPE_LABELS: Record<string, string> = {
  service: "Service",
  database: "Database",
  queue: "Queue",
  storage: "Storage",
  client: "Client",
  load_balancer: "LB",
  cache: "Cache",
  api_gateway: "API GW",
  network: "Network",
  other: "Other",
};

const COMPONENT_TYPE_COLORS: Record<string, string> = {
  service: "bg-[var(--accent)]/15 text-[var(--accent)] border-[var(--accent)]/25",
  database: "bg-[var(--info)]/15 text-[var(--info)] border-[var(--info)]/25",
  queue: "bg-[var(--warning)]/15 text-[var(--warning)] border-[var(--warning)]/25",
  storage: "bg-purple-500/15 text-purple-400 border-purple-500/25",
  client: "bg-cyan-500/15 text-cyan-400 border-cyan-500/25",
  load_balancer: "bg-orange-500/15 text-orange-400 border-orange-500/25",
  cache: "bg-rose-500/15 text-rose-400 border-rose-500/25",
  api_gateway: "bg-indigo-500/15 text-indigo-400 border-indigo-500/25",
  network: "bg-[var(--surface-hover)] text-[var(--foreground-subtle)] border-[var(--border)]",
  other: "bg-[var(--surface-hover)] text-[var(--foreground-muted)] border-[var(--border)]",
};

const ISSUE_SEVERITY_STYLES: Record<string, { color: string; bg: string; label: string }> = {
  critical: { color: "text-[var(--destructive)]", bg: "bg-[var(--destructive)]/10 border-[var(--destructive)]/20", label: "Critical" },
  warning: { color: "text-[var(--warning)]", bg: "bg-[var(--warning)]/10 border-[var(--warning)]/20", label: "Warning" },
  info: { color: "text-[var(--info)]", bg: "bg-[var(--info)]/10 border-[var(--info)]/20", label: "Info" },
};

const ISSUE_CATEGORY_LABELS: Record<string, string> = {
  security: "Security",
  scalability: "Scalability",
  reliability: "Reliability",
  cost: "Cost",
  operations: "Operations",
};

export const WhiteboardAnalysisPanel = memo(function WhiteboardAnalysisPanel({
  analysis,
}: WhiteboardAnalysisPanelProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const hadContentRef = useRef(false);

  useEffect(() => {
    if (!hadContentRef.current && analysis?.has_meaningful_content) {
      hadContentRef.current = true;
      setIsExpanded(true);
    }
  }, [analysis]);

  if (!analysis || !analysis.has_meaningful_content) return null;

  const { components, connections, issues, summary, change_summary } = analysis;
  const totalFindings = components.length + connections.length + issues.length;

  return (
    <section
      className="border-t border-[var(--border-subtle)] flex flex-col animate-fade-in"
      aria-label="Whiteboard Analysis"
    >
      {/* Header */}
      <button
        onClick={() => setIsExpanded((prev) => !prev)}
        className="flex items-center gap-2 px-4 py-2.5 w-full text-left hover:bg-[var(--surface-hover)] transition-colors shrink-0"
        aria-expanded={isExpanded}
        aria-controls="analysis-panel-content"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-[var(--foreground-subtle)]" aria-hidden="true">
          <circle cx="11" cy="11" r="8" />
          <path d="m21 21-4.3-4.3" />
        </svg>
        <h3 className="text-xs font-semibold text-[var(--foreground-muted)] uppercase tracking-wider">
          Analysis
        </h3>
        <span className="text-xs font-medium px-1.5 py-0.5 rounded-full bg-[var(--accent)]/10 text-[var(--accent)] border border-[var(--accent)]/20 tabular-nums">
          {totalFindings}
        </span>
        {issues.length > 0 && (
          <span className={`text-xs font-medium px-1.5 py-0.5 rounded-full tabular-nums ${
            issues.some((i) => i.severity === "critical")
              ? "bg-[var(--destructive)]/10 text-[var(--destructive)] border border-[var(--destructive)]/20"
              : "bg-[var(--warning)]/10 text-[var(--warning)] border border-[var(--warning)]/20"
          }`}>
            {issues.length} issue{issues.length !== 1 ? "s" : ""}
          </span>
        )}
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

      {/* Content */}
      {isExpanded && (
        <div
          id="analysis-panel-content"
          ref={scrollRef}
          className="px-3 pb-3 overflow-y-auto custom-scrollbar space-y-3 max-h-72 animate-slide-up"
        >
          {/* Summary */}
          {summary && (
            <p className="text-xs text-[var(--foreground-muted)] leading-relaxed">
              {summary}
            </p>
          )}

          {/* Change summary */}
          {change_summary && (
            <div className="flex items-start gap-2 text-xs">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-[var(--accent)] mt-0.5 flex-shrink-0" aria-hidden="true">
                <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" />
                <polyline points="17 6 23 6 23 12" />
              </svg>
              <span className="text-[var(--accent)]">{change_summary}</span>
            </div>
          )}

          {/* Issues */}
          {issues.length > 0 && (
            <div className="space-y-1.5">
              <h4 className="text-[10px] font-semibold text-[var(--foreground-subtle)] uppercase tracking-widest">
                Issues
              </h4>
              {issues.map((issue, i) => {
                const sev = ISSUE_SEVERITY_STYLES[issue.severity] ?? ISSUE_SEVERITY_STYLES.info;
                return (
                  <div
                    key={`issue-${i}`}
                    className={`rounded-lg p-2.5 border text-xs ${sev.bg}`}
                  >
                    <div className="flex items-center gap-1.5 mb-1">
                      <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${sev.color} bg-current/5`}>
                        {sev.label}
                      </span>
                      <span className="text-[10px] text-[var(--foreground-subtle)]">
                        {ISSUE_CATEGORY_LABELS[issue.category] ?? issue.category}
                      </span>
                    </div>
                    <p className="text-[var(--foreground)] leading-relaxed break-words">
                      {issue.description}
                    </p>
                    {issue.affected_components.length > 0 && (
                      <p className="text-[var(--foreground-subtle)] mt-1 text-[10px]">
                        {issue.affected_components.join(", ")}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Components */}
          {components.length > 0 && (
            <div>
              <h4 className="text-[10px] font-semibold text-[var(--foreground-subtle)] uppercase tracking-widest mb-1.5">
                Components
              </h4>
              <div className="flex flex-wrap gap-1.5">
                {components.map((comp, i) => {
                  const typeColor = COMPONENT_TYPE_COLORS[comp.component_type] ?? COMPONENT_TYPE_COLORS.other;
                  return (
                    <span
                      key={`comp-${i}`}
                      className={`inline-flex items-center gap-1 px-2 py-1 rounded-md border text-[10px] font-medium ${typeColor}`}
                    >
                      <span className="opacity-70">
                        {COMPONENT_TYPE_LABELS[comp.component_type] ?? comp.component_type}
                      </span>
                      <span className="font-semibold">{comp.name}</span>
                    </span>
                  );
                })}
              </div>
            </div>
          )}

          {/* Connections */}
          {connections.length > 0 && (
            <div>
              <h4 className="text-[10px] font-semibold text-[var(--foreground-subtle)] uppercase tracking-widest mb-1.5">
                Connections
              </h4>
              <div className="space-y-1">
                {connections.map((conn, i) => (
                  <div
                    key={`conn-${i}`}
                    className="flex items-center gap-1.5 text-[10px] text-[var(--foreground-muted)]"
                  >
                    <span className="text-[var(--foreground)]">{conn.source}</span>
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0 text-[var(--foreground-subtle)]" aria-hidden="true">
                      {conn.connection_type === "bidirectional" ? (
                        <>
                          <path d="M7 17l-5-5 5-5" />
                          <path d="M17 7l5 5-5 5" />
                          <line x1="2" x2="22" y1="12" y2="12" />
                        </>
                      ) : conn.connection_type === "dashed" ? (
                        <>
                          <line x1="5" x2="19" y1="12" y2="12" strokeDasharray="2 2" />
                          <polyline points="15 8 19 12 15 16" />
                        </>
                      ) : (
                        <>
                          <line x1="5" x2="19" y1="12" y2="12" />
                          <polyline points="15 8 19 12 15 16" />
                        </>
                      )}
                    </svg>
                    <span className="text-[var(--foreground)]">{conn.target}</span>
                    {conn.label && (
                      <span className="text-[var(--foreground-subtle)] truncate">({conn.label})</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
});
