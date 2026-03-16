"use client";

import { memo } from "react";
import { CATEGORIES, CATEGORY_LABEL_TEXT } from "@/lib/review-config";

interface RadarChartProps {
  scores: Record<string, number>;
}

export const RadarChart = memo(function RadarChart({ scores }: RadarChartProps) {
  const cx = 50;
  const cy = 50;
  const r = 38;
  const levels = 5;

  const points = CATEGORIES.map((_, i) => {
    const angle = (Math.PI * 2 * i) / CATEGORIES.length - Math.PI / 2;
    return { cos: Math.cos(angle), sin: Math.sin(angle) };
  });

  const gridRings = Array.from({ length: levels }, (_, i) => {
    const frac = (i + 1) / levels;
    const d = points
      .map(
        (p, j) =>
          `${j === 0 ? "M" : "L"} ${cx + p.cos * r * frac} ${cy + p.sin * r * frac}`
      )
      .join(" ");
    return d + " Z";
  });

  const dataPoly = points
    .map((p, i) => {
      const val = (scores[CATEGORIES[i]] ?? 5) / 10;
      return `${i === 0 ? "M" : "L"} ${cx + p.cos * r * val} ${cy + p.sin * r * val}`;
    })
    .join(" ") + " Z";

  return (
    <svg viewBox="0 0 100 100" className="w-full max-w-[260px] mx-auto" aria-hidden="true">
      {gridRings.map((d, i) => (
        <path
          key={i}
          d={d}
          fill="none"
          stroke="var(--border)"
          strokeWidth="0.3"
        />
      ))}
      {points.map((p, i) => (
        <line
          key={i}
          x1={cx}
          y1={cy}
          x2={cx + p.cos * r}
          y2={cy + p.sin * r}
          stroke="var(--border)"
          strokeWidth="0.2"
        />
      ))}
      <path d={dataPoly} fill="var(--accent-muted)" stroke="var(--accent)" strokeWidth="0.8" />
      {points.map((p, i) => {
        const val = (scores[CATEGORIES[i]] ?? 5) / 10;
        return (
          <circle
            key={i}
            cx={cx + p.cos * r * val}
            cy={cy + p.sin * r * val}
            r="1.5"
            fill="var(--accent)"
          />
        );
      })}
      {points.map((p, i) => {
        const lx = cx + p.cos * (r + 8);
        const ly = cy + p.sin * (r + 8);
        return (
          <text
            key={i}
            x={lx}
            y={ly}
            textAnchor="middle"
            dominantBaseline="central"
            fontSize="3.5"
            fill="var(--foreground-muted)"
          >
            {CATEGORY_LABEL_TEXT[CATEGORIES[i]]}
          </text>
        );
      })}
    </svg>
  );
});
