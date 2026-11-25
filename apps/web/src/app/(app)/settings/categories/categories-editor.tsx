"use client";

import { Eye, EyeOff, Loader2, Plus, Trash2 } from "lucide-react";
import { useState, useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Select } from "@/components/ui/fields";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  createCategory,
  createGroup,
  deleteCategory,
  deleteGroup,
  renameCategory,
  renameGroup,
  setCategoryHidden,
} from "./actions";

interface Group {
  id: string;
  name: string;
  kind: "income" | "expense" | "transfer";
  categories: { id: string; name: string; hidden: boolean; count: number }[];
}

type Result = { ok: boolean; error?: string };

export function CategoriesEditor({ groups }: { groups: Group[] }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const run = (fn: () => Promise<Result>) =>
    start(async () => {
      setError(null);
      const r = await fn();
      if (!r.ok) setError(r.error ?? "Something went wrong.");
    });

  return (
    <div className="flex flex-col gap-4">
      {error && (
        <div
          role="alert"
          className="rounded-xl border border-negative/30 bg-negative/10 p-3 text-sm text-negative"
        >
          {error}
        </div>
      )}
      {groups.map((g) => (
        <Card key={g.id}>
          <CardHeader className="flex-row items-center gap-3">
            <InlineName
              value={g.name}
              onSave={(name) => run(() => renameGroup(g.id, name))}
              className="text-base font-semibold"
            />
            <Badge>{g.kind}</Badge>
            {g.categories.length === 0 && (
              <Button
                variant="ghost"
                size="icon"
                className="ml-auto"
                aria-label={`Delete group ${g.name}`}
                onClick={() => run(() => deleteGroup(g.id))}
              >
                <Trash2 />
              </Button>
            )}
          </CardHeader>
          <CardContent>
            <ul className="divide-y">
              {g.categories.map((c) => (
                <li
                  key={c.id}
                  className={cn("flex items-center gap-3 py-2", c.hidden && "opacity-50")}
                >
                  <InlineName
                    value={c.name}
                    onSave={(name) => run(() => renameCategory(c.id, name))}
                    className="text-sm"
                  />
                  <span className="ml-auto text-xs text-muted-foreground tabular">
                    {c.count.toLocaleString()} txns
                  </span>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={c.hidden ? `Show ${c.name}` : `Hide ${c.name}`}
                    onClick={() => run(() => setCategoryHidden(c.id, !c.hidden))}
                  >
                    {c.hidden ? <Eye /> : <EyeOff />}
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Delete ${c.name}`}
                    onClick={() =>
                      window.confirm(
                        c.count > 0
                          ? `Delete “${c.name}”? ${c.count} transactions will become uncategorized.`
                          : `Delete “${c.name}”?`,
                      ) && run(() => deleteCategory(c.id))
                    }
                  >
                    <Trash2 />
                  </Button>
                </li>
              ))}
            </ul>
            <AddRow
              placeholder="New category"
              onAdd={(name) => run(() => createCategory(g.id, name))}
            />
          </CardContent>
        </Card>
      ))}
      <NewGroup onAdd={(name, kind) => run(() => createGroup(name, kind))} />
      {pending && <Loader2 className="size-4 animate-spin self-center text-muted-foreground" />}
    </div>
  );
}

function InlineName({
  value,
  onSave,
  className,
}: {
  value: string;
  onSave: (v: string) => void;
  className?: string;
}) {
  const [v, setV] = useState(value);
  return (
    <input
      aria-label="Name"
      value={v}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => v.trim() && v.trim() !== value && onSave(v.trim())}
      onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
      maxLength={60}
      className={cn(
        "min-w-0 rounded-md border border-transparent bg-transparent px-1.5 py-0.5 hover:border-border focus:border-primary",
        className,
      )}
    />
  );
}

function AddRow({ placeholder, onAdd }: { placeholder: string; onAdd: (name: string) => void }) {
  const [name, setName] = useState("");
  return (
    <form
      className="mt-2 flex gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (name.trim()) onAdd(name.trim());
        setName("");
      }}
    >
      <Input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder={placeholder}
        className="h-8"
        maxLength={60}
      />
      <Button size="sm" variant="outline" type="submit" disabled={!name.trim()}>
        <Plus /> Add
      </Button>
    </form>
  );
}

function NewGroup({ onAdd }: { onAdd: (name: string, kind: Group["kind"]) => void }) {
  const [name, setName] = useState("");
  const [kind, setKind] = useState<Group["kind"]>("expense");
  return (
    <Card>
      <CardContent className="p-5">
        <form
          className="flex flex-wrap gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim()) onAdd(name.trim(), kind);
            setName("");
          }}
        >
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="New group"
            className="max-w-xs"
            maxLength={60}
          />
          <Select
            value={kind}
            onChange={(e) => setKind(e.target.value as Group["kind"])}
            className="w-auto"
            aria-label="Group type"
          >
            <option value="expense">Expense</option>
            <option value="income">Income</option>
            <option value="transfer">Transfer</option>
          </Select>
          <Button type="submit" variant="outline" disabled={!name.trim()}>
            <Plus /> Add group
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
