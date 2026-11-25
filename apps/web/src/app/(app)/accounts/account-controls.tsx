"use client";

import { ACCOUNT_TYPES, type AccountType, isLiability, parseDecimalToMinor } from "@mm/core";
import { Loader2, Pencil, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Checkbox, Field, Select } from "@/components/ui/fields";
import { Input } from "@/components/ui/input";
import { passkeyErrorMessage } from "@/lib/client-api";
import { actionWithStepUp } from "@/lib/step-up";
import { createManualAccount, deleteAccount, updateAccount, updateManualBalance } from "./actions";

const TYPE_LABEL: Record<AccountType, string> = {
  depository: "Cash (checking, savings)",
  credit: "Credit card",
  loan: "Loan or mortgage",
  investment: "Investment",
  property: "Property (home, car…)",
  other: "Other",
};

export interface EditableAccount {
  id: string;
  name: string;
  type: AccountType;
  includeInNetWorth: boolean;
  hidden: boolean;
  manual: boolean;
  currentBalance: number;
}

export function EditAccountButton({ account }: { account: EditableAccount }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(account.name);
  const [type, setType] = useState(account.type);
  const [inNetWorth, setInNetWorth] = useState(account.includeInNetWorth);
  const [hidden, setHidden] = useState(account.hidden);
  const [balance, setBalance] = useState((account.currentBalance / 100).toFixed(2));
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const save = () =>
    start(async () => {
      setError(null);
      const r = await updateAccount(account.id, {
        name,
        type,
        includeInNetWorth: inNetWorth,
        hidden,
      });
      if (!r.ok) return setError(r.error);
      if (account.manual) {
        const minor = parseDecimalToMinor(balance);
        if (minor === null) return setError("Enter a valid balance.");
        if (minor !== account.currentBalance) {
          const b = await updateManualBalance(account.id, minor);
          if (!b.ok) return setError(b.error);
        }
      }
      setOpen(false);
      router.refresh();
    });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={`Edit ${account.name}`}>
          <Pencil />
        </Button>
      </DialogTrigger>
      <DialogContent title="Edit account">
        <div className="flex flex-col gap-4">
          <Field label="Name" htmlFor="a-name">
            <Input
              id="a-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={80}
            />
          </Field>
          <Field
            label="Type"
            htmlFor="a-type"
            hint={
              !account.manual
                ? "Changing between asset and liability flips how the bank's balance is read on the next sync."
                : undefined
            }
          >
            <Select
              id="a-type"
              value={type}
              onChange={(e) => setType(e.target.value as AccountType)}
            >
              {ACCOUNT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {TYPE_LABEL[t]}
                </option>
              ))}
            </Select>
          </Field>
          {account.manual && (
            <Field label={isLiability(type) ? "Amount owed" : "Current value"} htmlFor="a-bal">
              <Input
                id="a-bal"
                inputMode="decimal"
                value={balance}
                onChange={(e) => setBalance(e.target.value)}
                className="tabular"
              />
            </Field>
          )}
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={inNetWorth} onChange={(e) => setInNetWorth(e.target.checked)} />{" "}
            Include in net worth
          </label>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={hidden} onChange={(e) => setHidden(e.target.checked)} /> Hide from
            dashboard
          </label>
          {error && (
            <p role="alert" className="text-sm text-negative">
              {error}
            </p>
          )}
          <div className="flex items-center gap-2 border-t pt-4">
            <Button onClick={save} disabled={pending}>
              {pending && <Loader2 className="animate-spin" />} Save
            </Button>
            <Button
              variant="ghost"
              className="ml-auto text-negative hover:bg-negative/10"
              disabled={pending}
              onClick={() =>
                window.confirm(
                  `Permanently delete “${account.name}” and all of its transactions? This can't be undone.`,
                ) &&
                start(async () => {
                  try {
                    const r = await actionWithStepUp(() => deleteAccount(account.id));
                    if (!r.ok) return setError(r.error ?? "Couldn't delete.");
                    setOpen(false);
                    router.refresh();
                  } catch (e) {
                    setError(passkeyErrorMessage(e));
                  }
                })
              }
            >
              Delete account
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function AddManualAccountButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [type, setType] = useState<AccountType>("property");
  const [balance, setBalance] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <Plus /> Add manual account
        </Button>
      </DialogTrigger>
      <DialogContent
        title="Add a manual account"
        description="For things no bank reports: your home, a car, cash, a loan to family."
      >
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            const minor = parseDecimalToMinor(balance || "0");
            if (minor === null) return setError("Enter a valid amount.");
            start(async () => {
              const r = await createManualAccount({ name, type, balance: minor });
              if (!r.ok) return setError(r.error);
              setOpen(false);
              setName("");
              setBalance("");
              router.refresh();
            });
          }}
        >
          <Field label="Name" htmlFor="m-name">
            <Input
              id="m-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              maxLength={80}
              placeholder="e.g. Home"
            />
          </Field>
          <Field label="Type" htmlFor="m-type">
            <Select
              id="m-type"
              value={type}
              onChange={(e) => setType(e.target.value as AccountType)}
            >
              {ACCOUNT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {TYPE_LABEL[t]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={isLiability(type) ? "Amount owed" : "Current value"} htmlFor="m-bal">
            <Input
              id="m-bal"
              inputMode="decimal"
              value={balance}
              onChange={(e) => setBalance(e.target.value)}
              placeholder="0.00"
              className="tabular"
            />
          </Field>
          {error && (
            <p role="alert" className="text-sm text-negative">
              {error}
            </p>
          )}
          <Button type="submit" disabled={pending || !name.trim()}>
            {pending && <Loader2 className="animate-spin" />} Add account
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
