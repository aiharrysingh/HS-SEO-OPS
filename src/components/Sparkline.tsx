/**
 * Row-level trend. Deliberately unlabelled and unhoverable — it signals shape
 * only, and every value it draws is also in the table row beside it, so it
 * never gates a number behind a mark too small to read.
 */
export function Sparkline({
  values,
  width = 72,
  height = 22,
  title,
}: {
  values: number[];
  width?: number;
  height?: number;
  title?: string;
}) {
  if (values.length < 2) {
    return <div style={{ width, height }} aria-hidden="true" />;
  }

  const max = Math.max(...values, 1);
  const pad = 2;
  const w = width - pad * 2;
  const h = height - pad * 2;
  const x = (i: number) => pad + (i / (values.length - 1)) * w;
  const y = (v: number) => pad + h - (v / max) * h;

  const line = values.map((v, i) => `${x(i)},${y(v)}`).join(" ");
  const lastX = x(values.length - 1);
  const lastY = y(values[values.length - 1]);

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={title ?? "Trend"}
      className="overflow-visible"
    >
      <polyline
        points={line}
        fill="none"
        stroke="var(--series-1-quiet)"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Current period in the accent, per the stat-tile contract. */}
      <circle
        cx={lastX}
        cy={lastY}
        r={2.5}
        fill="var(--series-1)"
        stroke="var(--surface)"
        strokeWidth={1.5}
      />
    </svg>
  );
}
