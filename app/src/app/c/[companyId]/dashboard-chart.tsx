"use client";

import { useState } from "react";
import { formatCents } from "@/lib/money";

export interface MonthPoint {
  month: string; // "Jan"
  label: string; // "January 2026"
  income: number;
  expenses: number;
}

const H = 200;
const PAD = { top: 12, right: 8, bottom: 28, left: 64 };

function niceMax(v: number) {
  if (v <= 0) return 100_00;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  return [1, 2, 2.5, 5, 10].map((m) => m * p).find((x) => x >= v)!;
}

/** Income vs expenses by month: grouped bars, one axis, legend, hover tooltip, table view. */
export function IncomeExpenseChart({ data }: { data: MonthPoint[] }) {
  const [hover, setHover] = useState<{ i: number; s: "income" | "expenses" } | null>(null);
  const [table, setTable] = useState(false);
  const max = niceMax(Math.max(...data.flatMap((d) => [d.income, d.expenses]), 0));
  const W = 560;
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const band = innerW / data.length;
  const barW = Math.min(18, (band - 14) / 2);
  const y = (v: number) => PAD.top + innerH - (Math.max(v, 0) / max) * innerH;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * max);
  const series = [
    { key: "income" as const, name: "Income", color: "var(--color-series-1)" },
    { key: "expenses" as const, name: "Expenses", color: "var(--color-series-2)" },
  ];

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-4">
        <ul className="flex gap-4 text-sm text-text-muted" aria-label="Legend">
          {series.map((s) => (
            <li key={s.key} className="flex items-center gap-1.5">
              <span className="inline-block size-2.5 rounded-[2px]" style={{ background: s.color }} aria-hidden />
              {s.name}
            </li>
          ))}
        </ul>
        <button type="button" className="text-sm text-accent hover:underline" onClick={() => setTable((t) => !t)} aria-pressed={table}>
          {table ? "Show chart" : "Show table"}
        </button>
      </div>
      {table ? (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs text-text-muted uppercase">
              <th className="py-1">Month</th>
              <th className="py-1 text-right">Income</th>
              <th className="py-1 text-right">Expenses</th>
              <th className="py-1 text-right">Net</th>
            </tr>
          </thead>
          <tbody>
            {data.map((d) => (
              <tr key={d.label} className="border-b border-border">
                <td className="py-1">{d.label}</td>
                <td className="num py-1">{formatCents(d.income)}</td>
                <td className="num py-1">{formatCents(d.expenses)}</td>
                <td className="num py-1">{formatCents(d.income - d.expenses)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="relative">
          <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Income and expenses by month. Use Show table for the numbers.">
            {ticks.map((t) => (
              <g key={t}>
                <line x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} stroke="var(--color-chart-grid)" strokeWidth={1} />
                <text x={PAD.left - 8} y={y(t)} dy="0.32em" textAnchor="end" className="fill-[var(--color-text-muted)] text-[11px]">
                  {formatCents(t).replace(".00", "")}
                </text>
              </g>
            ))}
            {data.map((d, i) => {
              const cx = PAD.left + band * i + band / 2;
              return (
                <g key={d.label}>
                  {series.map((s, k) => {
                    const v = d[s.key];
                    const x = cx - barW - 1 + k * (barW + 2); // 2px gap between the pair
                    const top = y(v);
                    const h = PAD.top + innerH - top;
                    const active = hover?.i === i && hover.s === s.key;
                    return (
                      <g key={s.key}>
                        {h > 0 && (
                          <path
                            d={`M${x},${top + Math.min(4, h)} q0,-${Math.min(4, h)} ${Math.min(4, h)},-${Math.min(4, h)} h${barW - 2 * Math.min(4, h)} q${Math.min(4, h)},0 ${Math.min(4, h)},${Math.min(4, h)} V${PAD.top + innerH} H${x} Z`}
                            fill={s.color}
                            opacity={hover && !active ? 0.45 : 1}
                          />
                        )}
                        {/* hit target bigger than the bar */}
                        <rect
                          x={x - 2}
                          y={PAD.top}
                          width={barW + 4}
                          height={innerH}
                          fill="transparent"
                          onMouseEnter={() => setHover({ i, s: s.key })}
                          onMouseLeave={() => setHover(null)}
                        />
                      </g>
                    );
                  })}
                  <text x={cx} y={H - 8} textAnchor="middle" className="fill-[var(--color-text-muted)] text-[11px]">
                    {d.month}
                  </text>
                </g>
              );
            })}
            <line x1={PAD.left} x2={W - PAD.right} y1={PAD.top + innerH} y2={PAD.top + innerH} stroke="var(--color-border)" />
          </svg>
          {hover && (
            <div
              role="status"
              className="pointer-events-none absolute top-0 rounded-md border border-border bg-bg px-3 py-2 text-sm shadow-pop"
              style={{ left: `${((PAD.left + band * hover.i + band / 2) / W) * 100}%`, transform: "translateX(-50%)" }}
            >
              <p className="font-semibold">{data[hover.i].label}</p>
              <p className="num text-left">
                {hover.s === "income" ? "Income" : "Expenses"}: {formatCents(data[hover.i][hover.s])}
              </p>
              <p className="num text-left text-text-muted">Net: {formatCents(data[hover.i].income - data[hover.i].expenses)}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
