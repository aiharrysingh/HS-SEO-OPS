"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { formatDateShort, formatDate } from "@/lib/dates";
import { compact, full } from "@/lib/format";

export type SeriesPoint = { date: string; value: number };

/**
 * One measure, one axis. If you need clicks and impressions together, render
 * two of these — a second y-scale on the same plot invents a correlation the
 * data doesn't contain.
 *
 * Ships with a crosshair + tooltip (and keyboard equivalents) because an
 * SVG chart in a browser is interactive by default; the tooltip enhances the
 * table beneath it rather than being the only way to read a value.
 */
export function TimeSeriesChart({
  points,
  color = "var(--series-1)",
  wash = "var(--wash-1)",
  label,
  height = 200,
  valueLabel = "clicks",
}: {
  points: SeriesPoint[];
  color?: string;
  wash?: string;
  label: string;
  height?: number;
  valueLabel?: string;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(720);
  const [active, setActive] = useState<number | null>(null);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const w = entry.contentRect.width;
      if (w > 0) setWidth(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Left gutter fits the widest y tick; bottom band fits the x labels, so the
  // axis is inside the box rather than clipped by it.
  const M = { top: 12, right: 12, bottom: 26, left: 44 };
  const plotW = Math.max(10, width - M.left - M.right);
  const plotH = Math.max(10, height - M.top - M.bottom);

  const { ticks, max } = useMemo(() => niceScale(points.map((p) => p.value)), [points]);

  const x = useCallback(
    (i: number) =>
      M.left + (points.length <= 1 ? plotW / 2 : (i / (points.length - 1)) * plotW),
    [points.length, plotW, M.left],
  );
  const y = useCallback(
    (v: number) => M.top + plotH - (max === 0 ? 0 : (v / max) * plotH),
    [plotH, max, M.top],
  );

  const linePath = useMemo(
    () => points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i)},${y(p.value)}`).join(" "),
    [points, x, y],
  );
  const areaPath = useMemo(
    () =>
      points.length
        ? `${linePath} L${x(points.length - 1)},${M.top + plotH} L${x(0)},${M.top + plotH} Z`
        : "",
    [linePath, points.length, x, plotH, M.top],
  );

  const nearest = useCallback(
    (clientX: number) => {
      const rect = wrapRef.current?.getBoundingClientRect();
      if (!rect || points.length === 0) return null;
      const px = clientX - rect.left;
      const ratio = (px - M.left) / plotW;
      return Math.max(
        0,
        Math.min(points.length - 1, Math.round(ratio * (points.length - 1))),
      );
    },
    [points.length, plotW, M.left],
  );

  const onKey = (e: React.KeyboardEvent) => {
    if (points.length === 0) return;
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      e.preventDefault();
      setActive((a) => {
        const next = (a ?? 0) + (e.key === "ArrowRight" ? 1 : -1);
        return Math.max(0, Math.min(points.length - 1, next));
      });
    } else if (e.key === "Escape") {
      setActive(null);
    }
  };

  if (points.length === 0) {
    return (
      <div
        className="flex items-center justify-center rounded-lg border border-dashed border-hairline text-sm text-ink-muted"
        style={{ height }}
      >
        No data in this window
      </div>
    );
  }

  const point = active === null ? null : points[active];
  // Flip the tooltip to the left of the crosshair near the right edge.
  const tipLeft = active === null ? 0 : x(active);
  const flip = tipLeft > width - 150;

  return (
    <div
      ref={wrapRef}
      className="relative w-full outline-none"
      tabIndex={0}
      role="application"
      aria-label={`${label}. Use arrow keys to step through days.`}
      onKeyDown={onKey}
      onPointerMove={(e) => setActive(nearest(e.clientX))}
      onPointerLeave={() => setActive(null)}
      onFocus={() => setActive((a) => a ?? points.length - 1)}
      onBlur={() => setActive(null)}
    >
      <svg width={width} height={height} role="img" aria-label={label}>
        {/* Gridlines: solid hairlines one step off the surface, never dashed. */}
        {ticks.map((t) => (
          <g key={t}>
            <line
              x1={M.left}
              x2={M.left + plotW}
              y1={y(t)}
              y2={y(t)}
              stroke="var(--grid)"
              strokeWidth={1}
              shapeRendering="crispEdges"
            />
            <text
              x={M.left - 8}
              y={y(t)}
              textAnchor="end"
              dominantBaseline="middle"
              className="tnum"
              fontSize={11}
              fill="var(--ink-muted)"
            >
              {compact(t)}
            </text>
          </g>
        ))}

        <path d={areaPath} fill={wash} />
        <path
          d={linePath}
          fill="none"
          stroke={color}
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
        />

        <line
          x1={M.left}
          x2={M.left + plotW}
          y1={M.top + plotH}
          y2={M.top + plotH}
          stroke="var(--axis)"
          strokeWidth={1}
          shapeRendering="crispEdges"
        />

        {xTickIndexes(points.length).map((i) => (
          <text
            key={i}
            x={x(i)}
            y={height - 8}
            textAnchor={i === 0 ? "start" : i === points.length - 1 ? "end" : "middle"}
            fontSize={11}
            fill="var(--ink-muted)"
          >
            {formatDateShort(points[i].date)}
          </text>
        ))}

        {active !== null && point && (
          <g pointerEvents="none">
            <line
              x1={x(active)}
              x2={x(active)}
              y1={M.top}
              y2={M.top + plotH}
              stroke="var(--axis)"
              strokeWidth={1}
            />
            {/* 2px surface ring keeps the dot legible over the line. */}
            <circle
              cx={x(active)}
              cy={y(point.value)}
              r={4}
              fill={color}
              stroke="var(--surface)"
              strokeWidth={2}
            />
          </g>
        )}
      </svg>

      {active !== null && point && (
        <div
          className="pointer-events-none absolute z-10 rounded-md border border-hairline bg-raised px-2.5 py-1.5 text-xs shadow-sm"
          style={{
            left: flip ? tipLeft - 12 : tipLeft + 12,
            top: 4,
            transform: flip ? "translateX(-100%)" : undefined,
          }}
          role="status"
        >
          <div className="text-ink-muted">{formatDate(point.date)}</div>
          <div className="tnum font-semibold text-ink">
            {full(point.value)}{" "}
            <span className="font-normal text-ink-secondary">{valueLabel}</span>
          </div>
        </div>
      )}
    </div>
  );
}

/** Round y-axis ticks to clean numbers so the axis carries the unlabelled values. */
function niceScale(values: number[]): { ticks: number[]; max: number } {
  const peak = Math.max(...values, 0);
  if (peak === 0) return { ticks: [0], max: 1 };
  const rough = peak / 4;
  const mag = Math.pow(10, Math.floor(Math.log10(rough)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= rough) ?? mag * 10;
  const max = Math.ceil(peak / step) * step;
  const ticks: number[] = [];
  for (let t = 0; t <= max + 1e-9; t += step) ticks.push(Math.round(t * 100) / 100);
  return { ticks, max };
}

/** First, last, and a few evenly spaced dates — never every day. */
function xTickIndexes(n: number): number[] {
  if (n <= 1) return [0];
  const want = Math.min(5, n);
  const out = new Set<number>();
  for (let i = 0; i < want; i++) out.add(Math.round((i / (want - 1)) * (n - 1)));
  return [...out].sort((a, b) => a - b);
}
