"use client";

import { memo, useEffect, useId, useRef, useState } from "react";
import { Annotation } from "@/lib/types";
import { getSeverityColor } from "@/lib/severity-colors";
import { useReducedMotion } from "@/hooks/useReducedMotion";

const SEVERITY_LIST = ["critical", "warning", "info", "positive"] as const;

/**
 * Estimate the rendered width of a label string in SVG coordinate units.
 * CJK / full-width characters count as ~1em; ASCII as ~0.6em.
 */
function estimateTextWidth(text: string, fontSize: number): number {
  let w = 0;
  for (const ch of text) {
    w += ch.charCodeAt(0) > 0xff ? fontSize : fontSize * 0.6;
  }
  return w;
}

interface AnnotationOverlayProps {
  annotations: Annotation[];
  activeAnnotationId?: string | null;
  mirrored?: boolean;
}

export const AnnotationOverlay = memo(function AnnotationOverlay({
  annotations,
  activeAnnotationId,
  mirrored = false,
}: AnnotationOverlayProps) {
  const prefersReducedMotion = useReducedMotion();
  const baseId = useId();
  const svgRef = useRef<SVGSVGElement>(null);
  const [size, setSize] = useState({ w: 400, h: 300 });

  // Track actual rendered size so the viewBox maps 1:1 to CSS pixels.
  // This eliminates shape distortion caused by non-uniform SVG scaling
  // (the old preserveAspectRatio="none" on a square viewBox in a 4:3 container
  // turned circles into ellipses).
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const observer = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      if (width > 0 && height > 0) {
        setSize({ w: width, h: height });
      }
    });
    observer.observe(svg);
    return () => observer.disconnect();
  }, []);

  // Base unit: 1% of the smaller dimension.
  // All shape sizes use multiples of u for consistent proportional rendering
  // regardless of container aspect ratio or pixel size.
  const u = Math.min(size.w, size.h) / 100;

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${size.w} ${size.h}`}
      preserveAspectRatio="xMidYMid meet"
      className="absolute inset-0 w-full h-full z-30 pointer-events-none"
      aria-hidden="true"
    >
      {annotations.length > 0 && (
        <>
          <defs>
            {SEVERITY_LIST.map((sev) => (
              <marker
                key={sev}
                id={`${baseId}-arrow-${sev}`}
                markerWidth="6"
                markerHeight="4"
                refX="5"
                refY="2"
                orient="auto"
              >
                <polygon points="0 0, 6 2, 0 4" fill={getSeverityColor(sev)} />
              </marker>
            ))}
          </defs>
          {annotations.map((ann) => {
            const cx = mirrored ? (1 - ann.x) * size.w : ann.x * size.w;
            const cy = ann.y * size.h;
            const color = getSeverityColor(ann.severity);
            const isSpotlit = activeAnnotationId === ann.id;

            // --- Label sizing ---
            const fontSize = 2.5 * u;
            const textW = estimateTextWidth(ann.label, fontSize);
            const padX = u;
            const labelBgW = textW + padX * 2;
            const labelBgH = fontSize * 1.4;

            // --- Label Y position (center of label, offset from annotation point) ---
            let labelY: number;
            if (ann.annotationType === "circle") {
              labelY = cy + 8 * u;
            } else if (ann.annotationType === "arrow") {
              labelY = cy + 5 * u;
            } else if (ann.annotationType === "rectangle") {
              const halfRh = ((ann.height || 0.1) * size.h) / 2;
              labelY = cy - halfRh - 2.5 * u;
            } else {
              labelY = cy - 4 * u;
            }

            return (
              <g key={ann.id} className="animate-annotation-in">
                {/* Spotlight effect for speech-linked annotations */}
                {isSpotlit && ann.isSpeechLinked && (
                  prefersReducedMotion ? (
                    <circle
                      cx={cx} cy={cy} r={10 * u}
                      fill="none" stroke={color} strokeWidth={0.5 * u}
                      opacity="0.4"
                    />
                  ) : (
                    <circle
                      cx={cx} cy={cy} r={10 * u}
                      fill="none" stroke={color} strokeWidth={0.3 * u}
                      opacity="0.4"
                    >
                      <animate attributeName="r" values={`${8 * u};${12 * u};${8 * u}`} dur="2s" repeatCount="indefinite" />
                      <animate attributeName="opacity" values="0.5;0.2;0.5" dur="2s" repeatCount="indefinite" />
                    </circle>
                  )
                )}

                {/* Shape: circle */}
                {ann.annotationType === "circle" && (
                  <>
                    {prefersReducedMotion ? (
                      <circle cx={cx} cy={cy} r={5 * u} fill="none" stroke={color} strokeWidth={0.5 * u} opacity="0.6" />
                    ) : (
                      <circle cx={cx} cy={cy} r={5 * u} fill="none" stroke={color} strokeWidth={0.5 * u} opacity="0.6">
                        <animate attributeName="r" values={`${4 * u};${6 * u};${4 * u}`} dur="1.5s" repeatCount="indefinite" />
                        <animate attributeName="opacity" values="0.7;0.3;0.7" dur="1.5s" repeatCount="indefinite" />
                      </circle>
                    )}
                    <circle cx={cx} cy={cy} r={3 * u} fill="none" stroke={color} strokeWidth={0.6 * u} />
                  </>
                )}

                {/* Shape: arrow */}
                {ann.annotationType === "arrow" && (
                  <line
                    x1={cx - 6 * u} y1={cy - 6 * u}
                    x2={cx} y2={cy}
                    stroke={color}
                    strokeWidth={0.6 * u}
                    markerEnd={`url(#${baseId}-arrow-${ann.severity})`}
                  />
                )}

                {/* Shape: label marker */}
                {ann.annotationType === "label" && (
                  <rect
                    x={cx - u} y={cy - 2 * u}
                    width={2 * u} height={0.5 * u}
                    rx={0.25 * u}
                    fill={color} opacity="0.3"
                  />
                )}

                {/* Shape: rectangle bounding box */}
                {ann.annotationType === "rectangle" && (() => {
                  const rw = (ann.width || 0.1) * size.w;
                  const rh = (ann.height || 0.1) * size.h;
                  return prefersReducedMotion ? (
                    <rect
                      x={cx - rw / 2} y={cy - rh / 2}
                      width={rw} height={rh}
                      fill="none" stroke={color}
                      strokeWidth={0.5 * u}
                      strokeDasharray={`${2 * u} ${u}`}
                      rx={0.5 * u}
                    />
                  ) : (
                    <rect
                      x={cx - rw / 2} y={cy - rh / 2}
                      width={rw} height={rh}
                      fill="none" stroke={color}
                      strokeWidth={0.5 * u}
                      strokeDasharray={`${2 * u} ${u}`}
                      rx={0.5 * u}
                    >
                      <animate
                        attributeName="stroke-dashoffset"
                        values={`0;${6 * u}`}
                        dur="1.5s"
                        repeatCount="indefinite"
                      />
                    </rect>
                  );
                })()}

                {/* Label background + text */}
                <rect
                  x={cx - labelBgW / 2}
                  y={labelY - labelBgH / 2}
                  width={labelBgW}
                  height={labelBgH}
                  rx={0.5 * u}
                  fill="var(--overlay-heavy)"
                />
                <text
                  x={cx}
                  y={labelY}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fontSize={fontSize}
                  fill={color}
                  fontWeight="700"
                >
                  {ann.label}
                </text>
              </g>
            );
          })}
        </>
      )}
    </svg>
  );
});
