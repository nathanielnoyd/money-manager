"use client";

import { formatMoney } from "@mm/core";
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export function NetWorthChart({
  data,
  label = "Net worth",
}: {
  data: { date: string; value: number }[];
  label?: string;
}) {
  // Weekly sampling keeps the line calm and the DOM light.
  const points = data.filter((_, i) => i % 7 === 0 || i === data.length - 1);
  // One tick per month: the first sampled point in each calendar month.
  const ticks = points
    .filter((p, i) => i === 0 || p.date.slice(0, 7) !== points[i - 1]?.date.slice(0, 7))
    .map((p) => p.date);
  return (
    <div className="h-56 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={points} margin={{ top: 8, right: 0, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id="nw" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.28} />
              <stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <XAxis
            dataKey="date"
            tickLine={false}
            axisLine={false}
            ticks={ticks}
            interval="preserveStartEnd"
            minTickGap={24}
            tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
            tickFormatter={(d: string) =>
              new Date(`${d}T00:00:00Z`).toLocaleDateString("en-US", {
                month: "short",
                timeZone: "UTC",
              })
            }
          />
          <YAxis hide domain={["dataMin", "dataMax"]} />
          <Tooltip
            cursor={{ stroke: "var(--border)" }}
            contentStyle={{
              background: "var(--card)",
              border: "1px solid var(--border)",
              borderRadius: 10,
              fontSize: 12,
            }}
            labelFormatter={(d) =>
              new Date(`${String(d)}T00:00:00Z`).toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
                year: "numeric",
                timeZone: "UTC",
              })
            }
            formatter={(v) => [formatMoney(Number(v)), label]}
          />
          <Area
            type="monotone"
            dataKey="value"
            stroke="var(--chart-1)"
            strokeWidth={2}
            fill="url(#nw)"
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
