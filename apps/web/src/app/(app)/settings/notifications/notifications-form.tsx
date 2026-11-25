"use client";

import { type NotifySettings, parseDecimalToMinor } from "@mm/core";
import { ExternalLink, Loader2, Send } from "lucide-react";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Checkbox, Field } from "@/components/ui/fields";
import { Input } from "@/components/ui/input";
import { actionWithStepUp } from "@/lib/step-up";
import { saveNotifications, sendTestNotification } from "./actions";

const money = (m?: number) => (m ? (m / 100).toFixed(0) : "");

export function NotificationsForm({
  settings,
  hasToken,
  canEdit,
}: {
  settings: NotifySettings;
  hasToken: boolean;
  canEdit: boolean;
}) {
  const [url, setUrl] = useState(settings.ntfyUrl ?? "");
  const [token, setToken] = useState(hasToken ? "__keep__" : "");
  const [large, setLarge] = useState(money(settings.largeTransaction));
  const [low, setLow] = useState(money(settings.lowBalance));
  const [price, setPrice] = useState(settings.priceIncreases ?? false);
  const [sync, setSync] = useState(settings.syncProblems ?? false);
  const [budget, setBudget] = useState(settings.budgetOverspend ?? false);
  const [rewards, setRewards] = useState(settings.rewardReminders ?? false);
  const [amounts, setAmounts] = useState(settings.includeAmounts !== false);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const disabled = !canEdit || pending;

  const save = () =>
    start(async () => {
      setStatus(null);
      const r = await actionWithStepUp(() =>
        saveNotifications({
          ntfyUrl: url.trim(),
          ntfyToken: token === "__keep__" ? null : token.trim(),
          largeTransaction: large ? parseDecimalToMinor(large) : null,
          lowBalance: low ? parseDecimalToMinor(low) : null,
          priceIncreases: price,
          syncProblems: sync,
          budgetOverspend: budget,
          rewardReminders: rewards,
          includeAmounts: amounts,
        }),
      );
      setStatus(r.ok ? { ok: true, text: "Saved." } : { ok: false, text: r.error });
    });

  return (
    <div className="flex flex-col gap-4">
      {!canEdit && (
        <p className="text-sm text-muted-foreground">
          Only the household owner can change notifications.
        </p>
      )}
      <Card>
        <CardHeader>
          <h2 className="font-semibold">Delivery</h2>
          <p className="text-sm text-muted-foreground">
            <a
              href="https://ntfy.sh"
              target="_blank"
              rel="noreferrer noopener"
              className="inline-flex items-center gap-0.5 text-primary hover:underline"
            >
              ntfy <ExternalLink className="size-3" />
            </a>{" "}
            is a free, open-source push service with iOS and Android apps. Use a long, random topic
            name. Anyone who knows it can read the messages, so self-host ntfy or add an access
            token for real privacy.
          </p>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Topic URL"
            htmlFor="n-url"
            hint="e.g. https://ntfy.sh/mm-7f3k9q2x or your own server"
          >
            <Input
              id="n-url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              disabled={disabled}
              placeholder="https://ntfy.sh/your-secret-topic"
            />
          </Field>
          <Field
            label="Access token (optional)"
            htmlFor="n-token"
            hint={
              hasToken ? "A token is saved. Clear the field to remove it." : "For protected topics"
            }
          >
            <Input
              id="n-token"
              type="password"
              value={token === "__keep__" ? "••••••••" : token}
              onFocus={() => token === "__keep__" && setToken("")}
              onChange={(e) => setToken(e.target.value)}
              disabled={disabled}
              autoComplete="off"
            />
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <h2 className="font-semibold">Alert me when…</h2>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="A transaction is at least ($)"
              htmlFor="n-large"
              hint="Leave empty to turn off"
            >
              <Input
                id="n-large"
                inputMode="decimal"
                value={large}
                onChange={(e) => setLarge(e.target.value)}
                disabled={disabled}
                placeholder="500"
                className="tabular"
              />
            </Field>
            <Field
              label="A cash account drops below ($)"
              htmlFor="n-low"
              hint="Checking and savings; once a day at most"
            >
              <Input
                id="n-low"
                inputMode="decimal"
                value={low}
                onChange={(e) => setLow(e.target.value)}
                disabled={disabled}
                placeholder="1,000"
                className="tabular"
              />
            </Field>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={price}
              onChange={(e) => setPrice(e.target.checked)}
              disabled={disabled}
            />{" "}
            A subscription raises its price
          </label>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={budget}
              onChange={(e) => setBudget(e.target.checked)}
              disabled={disabled}
            />{" "}
            A budget category goes over
          </label>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={rewards}
              onChange={(e) => setRewards(e.target.checked)}
              disabled={disabled}
            />{" "}
            Card rewards: activate bonus categories, caps reached, sign-up bonus deadlines, annual
            fees
          </label>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={sync}
              onChange={(e) => setSync(e.target.checked)}
              disabled={disabled}
            />{" "}
            A bank connection needs attention
          </label>
          <label className="flex items-start gap-2 border-t pt-4 text-sm">
            <Checkbox
              checked={amounts}
              onChange={(e) => setAmounts(e.target.checked)}
              disabled={disabled}
              className="mt-0.5"
            />
            <span>
              Include amounts and balances in messages
              <span className="block text-xs text-muted-foreground">
                Turn off if your topic isn't private. Alerts will just say what happened.
              </span>
            </span>
          </label>
        </CardContent>
      </Card>

      {status && (
        <p
          role="status"
          className={status.ok ? "text-sm text-muted-foreground" : "text-sm text-negative"}
        >
          {status.text}
        </p>
      )}
      {canEdit && (
        <div className="flex gap-2">
          <Button onClick={save} disabled={pending}>
            {pending && <Loader2 className="animate-spin" />} Save
          </Button>
          <Button
            variant="outline"
            disabled={pending || !settings.ntfyUrl}
            onClick={() =>
              start(async () => {
                const r = await sendTestNotification();
                setStatus(
                  r.ok
                    ? { ok: true, text: "Test sent. Check your device." }
                    : { ok: false, text: r.error },
                );
              })
            }
          >
            <Send /> Send test
          </Button>
        </div>
      )}
    </div>
  );
}
