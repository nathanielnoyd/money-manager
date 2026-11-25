"use client";

import { formatMoney } from "@mm/core";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

const SERIES = [
  { key: "net", label: "Net worth", color: "var(--chart-1)", width: 2.5 },
  { key: "assets", label: "Assets", color: "var(--chart-2)", width: 2 },
  // chart-1/2/3 pass the dataviz validator on all pairs (CVD ΔE ≥ 8) in both themes; 1/2/4 did not.
  { key: "liabilities", label: "Liabilities", color: "var(--chart-3)", width: 2 },
] as const;

/** Net worth with its two components on one axis. HTML legend in series order; hover tooltip. */
export function NetWorthBreakdownChart({
  data,
}: {
  data: { date: string; assets: number; liabilities: number }[];
}) {
  const points = data
    .filter((_, i) => i % 7 === 0 || i === data.length - 1)
    .map((d) => ({ ...d, net: d.assets - d.liabilities }));
  const ticks = points
    .filter((p, i) => i === 0 || p.date.slice(0, 7) !== points[i - 1]?.date.slice(0, 7))
    .map((p) => p.date);
  const day = (d: string, opts: Intl.DateTimeFormatOptions) =>
    new Date(`${d}T00:00:00Z`).toLocaleDateString("en-US", { ...opts, timeZone: "UTC" });

  return (
    <div className="flex flex-col gap-2">
      <ul className="flex flex-wrap justify-end gap-4 text-xs text-muted-foreground">
        {SERIES.map((s) => (
          <li key={s.key} className="flex items-center gap-1.5">
            <span className="h-0.5 w-3 rounded-full" style={{ background: s.color }} aria-hidden />{" "}
            {s.label}
          </li>
        ))}
      </ul>
      <div
        className="h-64 w-full"
        role="img"
        aria-label="Net worth, assets and liabilities over time"
      >
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: 4 }}>
            <CartesianGrid vertical={false} stroke="var(--border)" />
            <XAxis
              dataKey="date"
              ticks={ticks}
              tickLine={false}
              axisLine={false}
              tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
              tickFormatter={(d: string) => day(d, { month: "short" })}
            />
            <YAxis
              tickLine={false}
              axisLine={false}
              width={60}
              tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
              tickFormatter={(v: number) => formatMoney(v, "USD", { compact: true })}
            />
            <Tooltip
              contentStyle={{
                background: "var(--card)",
                border: "1px solid var(--border)",
                borderRadius: 10,
                fontSize: 12,
                color: "var(--foreground)",
              }}
              itemStyle={{ color: "var(--foreground)" }}
              labelFormatter={(d) =>
                day(String(d), { month: "short", day: "numeric", year: "numeric" })
              }
              formatter={(v, name) => [
                formatMoney(Number(v)),
                SERIES.find((s) => s.key === name)?.label ?? String(name),
              ]}
            />
            {SERIES.map((s) => (
              <Line
                key={s.key}
                dataKey={s.key}
                stroke={s.color}
                strokeWidth={s.width}
                dot={false}
                activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--card)" }}
                isAnimationActive={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
