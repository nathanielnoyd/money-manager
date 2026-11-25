import { formatMoney } from "@mm/core";
import { cn } from "@/lib/utils";

/** Consistent money rendering: tabular figures, optional sign colouring. */
export function Money({
  value,
  currency = "USD",
  signed = false,
  colored = false,
  className,
}: {
  value: number;
  currency?: string;
  signed?: boolean;
  colored?: boolean;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "tabular",
        colored && value > 0 && "text-positive",
        colored && value < 0 && "text-foreground",
        className,
      )}
    >
      {formatMoney(value, currency, { signed })}
    </span>
  );
}
