"use client";

import {
  ACCOUNT_TYPES,
  type AccountType,
  type CsvMapping,
  csvToTransactions,
  type DateFormat,
  formatMoney,
  guessCsvMapping,
  type ImportResult,
  ofxToTransactions,
  parseCsv,
  parseDecimalToMinor,
} from "@mm/core";
import { FileUp, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox, Field, Select } from "@/components/ui/fields";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { importTransactions } from "./actions";

interface AccountOption {
  id: string;
  name: string;
  type: AccountType;
  mask: string | null;
  connected: boolean;
}

const MAX_BYTES = 5 * 1024 * 1024;

type Loaded =
  | { kind: "csv"; name: string; rows: string[][]; mapping: CsvMapping }
  | { kind: "ofx"; name: string; result: ReturnType<typeof ofxToTransactions> };

export function ImportWizard({ accounts }: { accounts: AccountOption[] }) {
  const router = useRouter();
  const [file, setFile] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [target, setTarget] = useState<string>(accounts[0]?.id ?? "new");
  const [newName, setNewName] = useState("");
  const [newType, setNewType] = useState<AccountType>("depository");
  const [pending, start] = useTransition();
  const [done, setDone] = useState<{ added: number; skipped: number } | null>(null);

  async function onFile(f: File) {
    setError(null);
    setDone(null);
    if (f.size > MAX_BYTES)
      return setError("That file is larger than 5 MB. Export a shorter date range.");
    const text = await f.text();
    if (/<OFX>/i.test(text) || /\.(ofx|qfx|qbo)$/i.test(f.name)) {
      const result = ofxToTransactions(text);
      if (result.transactions.length === 0)
        return setError("No transactions found in that OFX file.");
      setFile({ kind: "ofx", name: f.name, result });
      const mask = result.statement.accountId?.slice(-4);
      const match = accounts.find((a) => a.mask && a.mask === mask);
      if (match) setTarget(match.id);
      else {
        setTarget("new");
        setNewName(f.name.replace(/\.[^.]+$/, ""));
        setNewType(result.statement.accountType ?? "depository");
      }
    } else {
      const rows = parseCsv(text);
      if (rows.length < 2) return setError("That CSV looks empty.");
      setFile({ kind: "csv", name: f.name, rows, mapping: guessCsvMapping(rows) });
      if (accounts.length === 0) {
        setTarget("new");
        setNewName(f.name.replace(/\.[^.]+$/, ""));
      }
    }
  }

  const parsed: ImportResult | null = useMemo(() => {
    if (!file) return null;
    return file.kind === "csv" ? csvToTransactions(file.rows, file.mapping) : file.result;
  }, [file]);

  function submit() {
    if (!parsed || !file) return;
    start(async () => {
      setError(null);
      const balance =
        file.kind === "ofx" && file.result.statement.ledgerBalance
          ? {
              amount: parseDecimalToMinor(file.result.statement.ledgerBalance) ?? 0,
              date: file.result.statement.balanceDate ?? new Date().toISOString().slice(0, 10),
            }
          : undefined;
      const r = await importTransactions({
        target:
          target === "new"
            ? { newAccount: { name: newName || "Imported account", type: newType } }
            : { accountId: target },
        transactions: parsed.transactions.map(
          ({ providerTransactionId, date, amount, description }) => ({
            providerTransactionId,
            date,
            amount,
            description,
          }),
        ),
        fileName: file.name.slice(0, 200),
        balance,
      });
      if (!r.ok) return setError(r.error);
      setDone({ added: r.data?.added ?? 0, skipped: r.data?.skipped ?? 0 });
      router.refresh();
    });
  }

  if (done) {
    return (
      <Card>
        <CardContent className="flex flex-col items-start gap-3 p-6">
          <h2 className="text-lg font-semibold">Import complete</h2>
          <p className="text-sm text-muted-foreground">
            Added {done.added} transaction{done.added === 1 ? "" : "s"}
            {done.skipped > 0 && `; skipped ${done.skipped} already in your history`}.
          </p>
          <div className="flex gap-2">
            <Button onClick={() => router.push("/transactions?reviewed=no")}>
              Review transactions
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                setFile(null);
                setDone(null);
              }}
            >
              Import another file
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardContent className="p-6">
          <label
            htmlFor="import-file"
            className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-6 py-10 text-center hover:bg-muted/50"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const f = e.dataTransfer.files[0];
              if (f) void onFile(f);
            }}
          >
            <FileUp className="size-6 text-primary" />
            <span className="text-sm font-medium">
              {file ? file.name : "Choose or drop a file"}
            </span>
            <span className="text-xs text-muted-foreground">CSV, OFX, QFX or QBO, up to 5 MB</span>
          </label>
          <input
            id="import-file"
            type="file"
            accept=".csv,.ofx,.qfx,.qbo,text/csv"
            className="sr-only"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void onFile(f);
            }}
          />
          {error && (
            <p role="alert" className="mt-3 text-sm text-negative">
              {error}
            </p>
          )}
        </CardContent>
      </Card>

      {file?.kind === "csv" && (
        <MappingEditor
          rows={file.rows}
          mapping={file.mapping}
          onChange={(mapping) => setFile({ ...file, mapping })}
        />
      )}

      {parsed && (
        <Card>
          <CardContent className="flex flex-col gap-4 p-6">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="font-semibold">Preview</h2>
              <span className="text-sm text-muted-foreground">
                {parsed.transactions.length} transactions
                {parsed.errors.length > 0 && (
                  <span className="text-negative"> · {parsed.errors.length} rows skipped</span>
                )}
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="py-2 pr-4 font-medium">Date</th>
                    <th className="py-2 pr-4 font-medium">Description</th>
                    <th className="py-2 text-right font-medium">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {parsed.transactions.slice(0, 8).map((t) => (
                    <tr key={t.providerTransactionId}>
                      <td className="py-2 pr-4 tabular whitespace-nowrap">{t.date}</td>
                      <td className="max-w-xs truncate py-2 pr-4">{t.description}</td>
                      <td
                        className={cn("py-2 text-right tabular", t.amount > 0 && "text-positive")}
                      >
                        {formatMoney(t.amount, "USD", { signed: true })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {parsed.errors.length > 0 && (
              <details className="text-xs text-muted-foreground">
                <summary className="cursor-pointer">Show skipped rows</summary>
                <ul className="mt-2 space-y-0.5">
                  {parsed.errors.slice(0, 20).map((e) => (
                    <li key={e.row}>
                      Row {e.row}: {e.message}
                    </li>
                  ))}
                </ul>
              </details>
            )}

            <div className="grid gap-4 border-t pt-4 sm:grid-cols-2">
              <Field label="Import into" htmlFor="target">
                <Select id="target" value={target} onChange={(e) => setTarget(e.target.value)}>
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                      {a.mask ? ` ··${a.mask}` : ""}
                      {a.connected ? " (synced)" : ""}
                    </option>
                  ))}
                  <option value="new">+ New account…</option>
                </Select>
              </Field>
              {target === "new" && (
                <>
                  <Field label="Account name" htmlFor="new-name">
                    <Input
                      id="new-name"
                      value={newName}
                      onChange={(e) => setNewName(e.target.value)}
                      maxLength={80}
                    />
                  </Field>
                  <Field label="Account type" htmlFor="new-type">
                    <Select
                      id="new-type"
                      value={newType}
                      onChange={(e) => setNewType(e.target.value as AccountType)}
                    >
                      {ACCOUNT_TYPES.map((t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                    </Select>
                  </Field>
                </>
              )}
            </div>
            {accounts.find((a) => a.id === target)?.connected && (
              <p className="text-xs text-muted-foreground">
                This account syncs automatically. Rows matching an already-synced transaction (same
                date and amount) are skipped.
              </p>
            )}
            <div>
              <Button onClick={submit} disabled={pending || parsed.transactions.length === 0}>
                {pending && <Loader2 className="animate-spin" />} Import{" "}
                {parsed.transactions.length} transactions
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function MappingEditor({
  rows,
  mapping,
  onChange,
}: {
  rows: string[][];
  mapping: CsvMapping;
  onChange: (m: CsvMapping) => void;
}) {
  const header = rows[0] ?? [];
  const cols = header.map((h, i) => ({
    i,
    label: mapping.hasHeader
      ? h || `Column ${i + 1}`
      : `Column ${i + 1} (${(h ?? "").slice(0, 16)})`,
  }));
  const split = mapping.amountColumn === undefined;
  const colSelect = (
    id: string,
    value: number | undefined,
    set: (v: number | undefined) => void,
    optional = false,
  ) => (
    <Select
      id={id}
      value={value ?? ""}
      onChange={(e) => set(e.target.value === "" ? undefined : Number(e.target.value))}
    >
      {optional && <option value="">None</option>}
      {cols.map((c) => (
        <option key={c.i} value={c.i}>
          {c.label}
        </option>
      ))}
    </Select>
  );

  return (
    <Card>
      <CardContent className="flex flex-col gap-4 p-6">
        <h2 className="font-semibold">Columns</h2>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Date" htmlFor="m-date">
            {colSelect("m-date", mapping.dateColumn, (v) =>
              onChange({ ...mapping, dateColumn: v ?? 0 }),
            )}
          </Field>
          <Field label="Date format" htmlFor="m-fmt">
            <Select
              id="m-fmt"
              value={mapping.dateFormat}
              onChange={(e) => onChange({ ...mapping, dateFormat: e.target.value as DateFormat })}
            >
              <option value="MDY">Month/Day/Year</option>
              <option value="DMY">Day/Month/Year</option>
              <option value="YMD">Year-Month-Day</option>
            </Select>
          </Field>
          <Field label="Description" htmlFor="m-desc">
            {colSelect("m-desc", mapping.descriptionColumn, (v) =>
              onChange({ ...mapping, descriptionColumn: v ?? 0 }),
            )}
          </Field>
          <Field label="Amounts" htmlFor="m-mode">
            <Select
              id="m-mode"
              value={split ? "split" : "single"}
              onChange={(e) =>
                onChange(
                  e.target.value === "split"
                    ? {
                        ...mapping,
                        amountColumn: undefined,
                        debitColumn: mapping.debitColumn ?? 2,
                        creditColumn: mapping.creditColumn ?? 3,
                      }
                    : {
                        ...mapping,
                        amountColumn: mapping.amountColumn ?? 2,
                        debitColumn: undefined,
                        creditColumn: undefined,
                      },
                )
              }
            >
              <option value="single">One signed amount column</option>
              <option value="split">Separate debit and credit columns</option>
            </Select>
          </Field>
          {split ? (
            <>
              <Field label="Money out (debit)" htmlFor="m-debit">
                {colSelect(
                  "m-debit",
                  mapping.debitColumn,
                  (v) => onChange({ ...mapping, debitColumn: v }),
                  true,
                )}
              </Field>
              <Field label="Money in (credit)" htmlFor="m-credit">
                {colSelect(
                  "m-credit",
                  mapping.creditColumn,
                  (v) => onChange({ ...mapping, creditColumn: v }),
                  true,
                )}
              </Field>
            </>
          ) : (
            <Field label="Amount" htmlFor="m-amount">
              {colSelect("m-amount", mapping.amountColumn, (v) =>
                onChange({ ...mapping, amountColumn: v ?? 0 }),
              )}
            </Field>
          )}
        </div>
        <div className="flex flex-wrap gap-6 text-sm">
          <label className="flex items-center gap-2">
            <Checkbox
              checked={mapping.hasHeader}
              onChange={(e) => onChange({ ...mapping, hasHeader: e.target.checked })}
            />{" "}
            First row is a header
          </label>
          <label className="flex items-center gap-2">
            <Checkbox
              checked={mapping.invert}
              onChange={(e) => onChange({ ...mapping, invert: e.target.checked })}
            />{" "}
            Flip signs (purchases show as positive)
          </label>
        </div>
      </CardContent>
    </Card>
  );
}
