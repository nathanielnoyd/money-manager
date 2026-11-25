"use client";

import { formatMoney, parseDecimalToMinor } from "@mm/core";
import { Goal, Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { useState, useTransition } from "react";
import { EmptyState } from "@/components/empty-state";
import { Money } from "@/components/money";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Checkbox, Field } from "@/components/ui/fields";
import { Input } from "@/components/ui/input";
import type { GoalsData } from "@/lib/goals";
import { cn } from "@/lib/utils";
import { deleteGoal, saveGoal } from "./actions";

type GoalRow = GoalsData["goals"][number];

export function GoalsView({ data, canEdit }: { data: GoalsData; canEdit: boolean }) {
  const [editing, setEditing] = useState<GoalRow | "new" | null>(null);
  return (
    <div className="flex flex-col gap-4">
      {canEdit && (
        <div className="flex justify-end">
          <Button onClick={() => setEditing("new")}>
            <Plus /> New goal
          </Button>
        </div>
      )}
      {data.goals.length === 0 ? (
        <EmptyState icon={Goal} title="No goals yet">
          An emergency fund, a trip, a down payment. Link the accounts you're saving in and progress
          updates with every sync.
        </EmptyState>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {data.goals.map((g) => (
            <Card key={g.id}>
              <CardContent className="flex flex-col gap-3 p-5">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h3 className="font-semibold">{g.name}</h3>
                    <p className="text-xs text-muted-foreground">
                      {g.linkedNames.length ? g.linkedNames.join(", ") : "Tracked manually"}
                      {g.targetDate &&
                        ` · by ${new Date(`${g.targetDate}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" })}`}
                    </p>
                  </div>
                  {canEdit && (
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Edit ${g.name}`}
                      onClick={() => setEditing(g)}
                    >
                      <Pencil />
                    </Button>
                  )}
                </div>
                <div className="flex items-baseline justify-between">
                  <Money value={g.current} className="text-2xl font-semibold tracking-tight" />
                  <span className="text-sm text-muted-foreground">
                    of {formatMoney(g.targetAmount)}
                  </span>
                </div>
                <div
                  className="h-2 overflow-hidden rounded-full bg-muted"
                  role="progressbar"
                  aria-label={`${g.name} progress`}
                  aria-valuenow={Math.round(g.progress * 100)}
                  aria-valuemin={0}
                  aria-valuemax={100}
                >
                  <div
                    className={cn(
                      "h-full rounded-full",
                      g.progress >= 1 ? "bg-positive" : "bg-primary",
                    )}
                    style={{ width: `${Math.max(2, g.progress * 100)}%` }}
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  {g.progress >= 1
                    ? "Goal reached 🎉"
                    : `${Math.round(g.progress * 100)}% · ${formatMoney(g.remaining)} to go${g.perMonth !== null ? ` · save ${formatMoney(g.perMonth)}/month to hit your date` : ""}`}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
      <Dialog open={editing !== null} onOpenChange={(o) => !o && setEditing(null)}>
        {editing !== null && (
          <GoalForm
            key={editing === "new" ? "new" : editing.id}
            goal={editing === "new" ? null : editing}
            accounts={data.accounts}
            onDone={() => setEditing(null)}
          />
        )}
      </Dialog>
    </div>
  );
}

function GoalForm({
  goal,
  accounts,
  onDone,
}: {
  goal: GoalRow | null;
  accounts: GoalsData["accounts"];
  onDone: () => void;
}) {
  const [name, setName] = useState(goal?.name ?? "");
  const [target, setTarget] = useState(goal ? (goal.targetAmount / 100).toFixed(2) : "");
  const [date, setDate] = useState(goal?.targetDate ?? "");
  const [linked, setLinked] = useState<string[]>(goal?.accountIds ?? []);
  const [manual, setManual] = useState(goal ? (goal.manualAmount / 100).toFixed(2) : "0");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  return (
    <DialogContent title={goal ? "Edit goal" : "New goal"}>
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          const targetAmount = parseDecimalToMinor(target);
          const manualAmount = parseDecimalToMinor(manual || "0");
          if (!targetAmount || targetAmount <= 0 || manualAmount === null)
            return setError("Enter valid amounts.");
          start(async () => {
            const r = await saveGoal({
              id: goal?.id,
              name,
              targetAmount,
              targetDate: date || null,
              accountIds: linked,
              manualAmount,
            });
            if (!r.ok) return setError(r.error);
            onDone();
          });
        }}
      >
        <Field label="Name" htmlFor="g-name">
          <Input
            id="g-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            maxLength={80}
            placeholder="Emergency fund"
          />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Target amount" htmlFor="g-target">
            <Input
              id="g-target"
              inputMode="decimal"
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              required
              className="tabular"
              placeholder="10,000"
            />
          </Field>
          <Field label="Target date (optional)" htmlFor="g-date">
            <Input id="g-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
        </div>
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-medium">Count these accounts toward the goal</legend>
          {accounts.map((a) => (
            <label key={a.id} className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={linked.includes(a.id)}
                onChange={(e) =>
                  setLinked(e.target.checked ? [...linked, a.id] : linked.filter((x) => x !== a.id))
                }
              />
              {a.name}
            </label>
          ))}
        </fieldset>
        {linked.length === 0 && (
          <Field
            label="Saved so far"
            htmlFor="g-manual"
            hint="With no linked accounts, update this yourself."
          >
            <Input
              id="g-manual"
              inputMode="decimal"
              value={manual}
              onChange={(e) => setManual(e.target.value)}
              className="tabular"
            />
          </Field>
        )}
        {error && (
          <p role="alert" className="text-sm text-negative">
            {error}
          </p>
        )}
        <div className="flex items-center gap-2 border-t pt-4">
          <Button type="submit" disabled={pending}>
            {pending && <Loader2 className="animate-spin" />} Save goal
          </Button>
          {goal && (
            <Button
              type="button"
              variant="ghost"
              className="ml-auto text-negative hover:bg-negative/10"
              disabled={pending}
              onClick={() =>
                window.confirm(`Delete “${goal.name}”?`) &&
                start(async () => {
                  await deleteGoal(goal.id);
                  onDone();
                })
              }
            >
              <Trash2 /> Delete
            </Button>
          )}
        </div>
      </form>
    </DialogContent>
  );
}
