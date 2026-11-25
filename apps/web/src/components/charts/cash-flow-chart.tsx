"use client";

import { formatMoney, monthLabel } from "@mm/core";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

/** Monthly income vs. expenses: two series on one axis, legend + hover tooltip. */
export function CashFlowChart({
  data,
}: {
  data: { month: string; income: number; expense: number }[];
}) {
  return (
    <div className="flex flex-col gap-2">
      {/* HTML legend, in the same order as the bars; text uses text tokens, swatches carry identity. */}
      <ul className="flex justify-end gap-4 text-xs text-muted-foreground">
        <li className="flex items-center gap-1.5">
          <span className="size-2 rounded-full bg-chart-1" aria-hidden /> Income
        </li>
        <li className="flex items-center gap-1.5">
          <span className="size-2 rounded-full bg-chart-2" aria-hidden /> Expenses
        </li>
      </ul>
      <div className="h-72 w-full" role="img" aria-label="Monthly income and expenses">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={data}
            barGap={2}
            barCategoryGap="22%"
            margin={{ top: 8, right: 4, bottom: 0, left: 4 }}
          >
            <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="0" />
            <XAxis
              dataKey="month"
              tickLine={false}
              axisLine={false}
              tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
              tickFormatter={(m: string) => monthLabel(m, "short").split(" ")[0] ?? m}
            />
            <YAxis
              tickLine={false}
              axisLine={false}
              width={56}
              tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
              tickFormatter={(v: number) => formatMoney(v, "USD", { compact: true })}
            />
            <Tooltip
              cursor={{ fill: "var(--muted)", opacity: 0.5 }}
              contentStyle={{
                background: "var(--card)",
                border: "1px solid var(--border)",
                borderRadius: 10,
                fontSize: 12,
                color: "var(--foreground)",
              }}
              labelStyle={{ color: "var(--foreground)", fontWeight: 600 }}
              itemStyle={{ color: "var(--foreground)" }}
              labelFormatter={(m) => monthLabel(String(m))}
              formatter={(v, name) => [
                formatMoney(Number(v)),
                name === "income" ? "Income" : "Expenses",
              ]}
            />
            <Bar
              dataKey="income"
              fill="var(--chart-1)"
              radius={[4, 4, 0, 0]}
              maxBarSize={28}
              isAnimationActive={false}
            />
            <Bar
              dataKey="expense"
              fill="var(--chart-2)"
              radius={[4, 4, 0, 0]}
              maxBarSize={28}
              isAnimationActive={false}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
