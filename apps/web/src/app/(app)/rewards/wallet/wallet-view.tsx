"use client";

import type { getCardValues, getSignupBonusProgress, listPointsBalances } from "@mm/services";
import { useState } from "react";
import { Money } from "@/components/money";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Field, Select } from "@/components/ui/fields";
import { Input } from "@/components/ui/input";
import { saveCardCredits, savePointsBalance, saveSignupBonus } from "../actions";
import {
  type CatalogOption,
  type Out,
  type Run,
  UnlinkedRow,
  useRun,
  type Wallet,
  WalletRow,
} from "../components";
import { cents } from "../format";

type Values = Out<typeof getCardValues>;
type Bonuses = Out<typeof getSignupBonusProgress>;
type Balances = Out<typeof listPointsBalances>;

interface Props {
  canEdit: boolean;
  wallet: Wallet;
  values: Values;
  bonuses: Bonuses;
  balances: Balances;
  programs: { slug: string; name: string }[];
  catalog: CatalogOption[];
}

export function WalletView({
  canEdit,
  wallet,
  values,
  bonuses,
  balances,
  programs,
  catalog,
}: Props) {
  const { run, disabled, banner } = useRun(canEdit);
  const valueBy = new Map(values.cards.map((v) => [v.walletCardId, v]));
  const bonusBy = new Map(bonuses.bonuses.map((b) => [b.walletCardId, b]));
  return (
    <div className="flex flex-col gap-4">
      {banner}
      <Card>
        <CardHeader>
          <h2 className="font-semibold">Your cards</h2>
          <p className="text-sm text-muted-foreground">
            Link each credit card account to its card. "Adds" is what a card earns beyond what your
            other cards would have, over the last year
            {values.historyDays < 365 ? ` (scaled up from ${values.historyDays} days)` : ""}.
          </p>
        </CardHeader>
        <CardContent>
          <ul className="divide-y">
            {wallet.cards.map((c) => (
              <WalletRow
                key={c.walletCardId}
                card={c}
                catalog={catalog}
                disabled={disabled}
                run={run}
              >
                <CardValue
                  value={valueBy.get(c.walletCardId)}
                  bonus={bonusBy.get(c.walletCardId)}
                  accountId={c.accountId}
                  account={c.account}
                  disabled={disabled}
                  run={run}
                />
              </WalletRow>
            ))}
            {wallet.unlinkedCreditAccounts.map((a) => (
              <UnlinkedRow
                key={a.accountId}
                account={a}
                catalog={catalog}
                disabled={disabled}
                run={run}
              />
            ))}
          </ul>
        </CardContent>
      </Card>
      <PointsBalances balances={balances} programs={programs} disabled={disabled} run={run} />
    </div>
  );
}

function CardValue({
  value,
  bonus,
  accountId,
  account,
  disabled,
  run,
}: {
  value: Values["cards"][number] | undefined;
  bonus: Bonuses["bonuses"][number] | undefined;
  accountId: string;
  account: string;
  disabled: boolean;
  run: Run;
}) {
  if (!value) return null;
  return (
    <div className="flex flex-col gap-3 rounded-lg bg-muted/50 p-3 text-sm">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        <Stat label="Earned / yr" cents={cents(value.earnedPerYear)} />
        <Stat label="Adds / yr" cents={cents(value.addsPerYear)} />
        <label className="flex flex-col">
          <span className="text-xs text-muted-foreground">Credits you use / yr</span>
          <Input
            key={value.creditsUsedPerYear}
            type="number"
            min="0"
            step="1"
            aria-label={`Credits used per year for ${account}`}
            className="h-8 w-24"
            defaultValue={value.creditsUsedPerYear}
            disabled={disabled}
            onBlur={(e) => {
              const v = Number(e.target.value || 0);
              if (v !== value.creditsUsedPerYear)
                run(() => saveCardCredits({ accountId, creditsPerYear: v }));
            }}
          />
        </label>
        <Stat label="Annual fee" cents={-cents(value.annualFee)} />
        <div className="flex flex-col">
          <span className="text-xs text-muted-foreground">Net / yr</span>
          <span className="flex items-center gap-2">
            <Money value={cents(value.netPerYear)} signed colored className="font-semibold" />
            {value.verdict === "review" && <Badge tone="warning">review</Badge>}
            {value.verdict === "worth it" && <Badge tone="accent">worth it</Badge>}
          </span>
        </div>
        {value.nextFeeDate && (
          <div className="flex flex-col">
            <span className="text-xs text-muted-foreground">Next fee</span>
            <span>{value.nextFeeDate}</span>
          </div>
        )}
      </div>
      <BonusForm
        bonus={bonus}
        accountId={accountId}
        account={account}
        disabled={disabled}
        run={run}
      />
    </div>
  );
}

function Stat({ label, cents: c }: { label: string; cents: number }) {
  return (
    <div className="flex flex-col">
      <span className="text-xs text-muted-foreground">{label}</span>
      <Money value={c} signed={c < 0} />
    </div>
  );
}

function BonusForm({
  bonus,
  accountId,
  account,
  disabled,
  run,
}: {
  bonus: Bonuses["bonuses"][number] | undefined;
  accountId: string;
  account: string;
  disabled: boolean;
  run: Run;
}) {
  const [points, setPoints] = useState(String(bonus?.points ?? ""));
  const [minSpend, setMinSpend] = useState(String(bonus?.minSpend ?? ""));
  const [deadline, setDeadline] = useState(bonus?.deadline ?? "");
  return (
    <details open={!!bonus}>
      <summary className="cursor-pointer text-xs text-muted-foreground">
        {bonus ? "Sign-up bonus" : "Working on a sign-up bonus?"}
      </summary>
      <form
        className="mt-2 flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          run(() =>
            saveSignupBonus({
              accountId,
              bonus: { points: Number(points), minSpend: Number(minSpend), deadline },
            }),
          );
        }}
      >
        <Field label="Bonus points" htmlFor={`bp-${accountId}`}>
          <Input
            id={`bp-${accountId}`}
            type="number"
            min="1"
            className="h-8 w-28"
            value={points}
            onChange={(e) => setPoints(e.target.value)}
            disabled={disabled}
          />
        </Field>
        <Field label="Spend ($)" htmlFor={`bs-${accountId}`}>
          <Input
            id={`bs-${accountId}`}
            type="number"
            min="1"
            className="h-8 w-28"
            value={minSpend}
            onChange={(e) => setMinSpend(e.target.value)}
            disabled={disabled}
          />
        </Field>
        <Field label="By" htmlFor={`bd-${accountId}`}>
          <Input
            id={`bd-${accountId}`}
            type="date"
            className="h-8 w-40"
            value={deadline}
            onChange={(e) => setDeadline(e.target.value)}
            disabled={disabled}
          />
        </Field>
        <Button
          size="sm"
          type="submit"
          aria-label={`Save sign-up bonus for ${account}`}
          disabled={disabled || !points || !minSpend || !deadline}
        >
          Save
        </Button>
        {bonus && (
          <Button
            size="sm"
            variant="ghost"
            type="button"
            disabled={disabled}
            onClick={() => run(() => saveSignupBonus({ accountId, bonus: null }))}
          >
            Stop tracking
          </Button>
        )}
      </form>
    </details>
  );
}

function PointsBalances({
  balances,
  programs,
  disabled,
  run,
}: {
  balances: Balances;
  programs: { slug: string; name: string }[];
  disabled: boolean;
  run: Run;
}) {
  const [program, setProgram] = useState(programs[0]?.slug ?? "");
  const [amount, setAmount] = useState("");
  return (
    <Card>
      <CardHeader>
        <h2 className="font-semibold">Points balances</h2>
        <p className="text-sm text-muted-foreground">
          Banks don't share points balances, so add them here (or ask your agent). Worth{" "}
          <Money value={cents(balances.total)} className="font-medium text-foreground" /> at your
          point values.
        </p>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {balances.balances.length > 0 && (
          <table className="w-full text-sm">
            <tbody className="divide-y">
              {balances.balances.map((b) => (
                <tr key={b.slug}>
                  <td className="py-2">
                    <div>{b.program}</div>
                    <div className="text-xs text-muted-foreground">as of {b.asOf}</div>
                  </td>
                  <td className="py-2 text-right tabular">{b.balance.toLocaleString()}</td>
                  <td className="py-2 text-right">
                    <Money value={cents(b.value)} />
                  </td>
                  <td className="py-2 text-right">
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={`Remove ${b.program} balance`}
                      disabled={disabled}
                      onClick={() =>
                        run(() => savePointsBalance({ program: b.slug, balance: null }))
                      }
                    >
                      Remove
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            run(() => savePointsBalance({ program, balance: Math.round(Number(amount)) }));
            setAmount("");
          }}
        >
          <Field label="Program" htmlFor="pb-program">
            <Select
              id="pb-program"
              value={program}
              onChange={(e) => setProgram(e.target.value)}
              disabled={disabled}
              className="h-9 w-56"
            >
              {programs.map((x) => (
                <option key={x.slug} value={x.slug}>
                  {x.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Balance" htmlFor="pb-amount">
            <Input
              id="pb-amount"
              type="number"
              min="0"
              step="1"
              className="h-9 w-36"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              disabled={disabled}
            />
          </Field>
          <Button type="submit" disabled={disabled || amount === ""}>
            Save balance
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
