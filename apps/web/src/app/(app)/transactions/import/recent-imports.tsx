"use client";

import { Loader2, Undo2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { undoImport } from "./actions";

export interface RecentImport {
  id: string;
  fileName: string | null;
  account: string;
  /** Rows from this import that still exist. */
  remaining: number;
  createdAt: string;
}

const when = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

/** Past imports, each with a way to take its transactions back out. */
export function RecentImports({ imports, canEdit }: { imports: RecentImport[]; canEdit: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [confirming, setConfirming] = useState<string | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  if (imports.length === 0) return null;

  const remove = (id: string) =>
    start(async () => {
      const r = await undoImport(id);
      setConfirming(null);
      setMessage(
        r.ok
          ? {
              ok: true,
              text: `Removed ${r.data?.removed ?? 0} transaction${r.data?.removed === 1 ? "" : "s"}.`,
            }
          : { ok: false, text: r.error },
      );
      router.refresh();
    });

  return (
    <Card className="mt-6">
      <CardHeader>
        <h2 className="font-semibold">Recent imports</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Imported into the wrong account? Remove an import to take its transactions back out. The
          account and its balance stay as they are.
        </p>
      </CardHeader>
      <CardContent>
        <ul className="divide-y text-sm">
          {imports.map((i) => (
            <li key={i.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div>
                <div className="font-medium">{i.fileName ?? "Imported file"}</div>
                <div className="text-xs text-muted-foreground">
                  {when(i.createdAt)} · {i.account} · {i.remaining.toLocaleString()} transaction
                  {i.remaining === 1 ? "" : "s"}
                </div>
              </div>
              {canEdit &&
                (confirming === i.id ? (
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground">
                      Delete {i.remaining.toLocaleString()} transaction
                      {i.remaining === 1 ? "" : "s"}?
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      className="text-negative"
                      disabled={pending}
                      onClick={() => remove(i.id)}
                    >
                      {pending && <Loader2 className="animate-spin" />} Remove
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => setConfirming(null)}>
                      Keep
                    </Button>
                  </div>
                ) : (
                  <Button variant="outline" size="sm" onClick={() => setConfirming(i.id)}>
                    <Undo2 /> Remove this import
                  </Button>
                ))}
            </li>
          ))}
        </ul>
        {message && (
          <p
            role="status"
            className={`mt-3 text-sm ${message.ok ? "text-muted-foreground" : "text-negative"}`}
          >
            {message.text}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
