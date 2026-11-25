"use client";

import { ArrowUp, Loader2, Sparkles } from "lucide-react";
import { useEffect, useRef, useState, useTransition } from "react";
import { Markdown } from "@/components/markdown";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { ask } from "./actions";

interface Turn {
  role: "user" | "assistant";
  content: string;
  sources?: string[];
  error?: boolean;
}

const SUGGESTIONS = [
  "How much did we spend on dining last month?",
  "What are our biggest subscriptions?",
  "Which budget categories are over this month?",
  "How has our net worth changed this year?",
  "What were our largest purchases in the last 30 days?",
];

export function AskChat() {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [question, setQuestion] = useState("");
  const [pending, start] = useTransition();
  const end = useRef<HTMLDivElement>(null);

  // Block body on purpose: scrollIntoView() returns a Promise in current Chromium, and an
  // effect must return a cleanup function or nothing. `turns.length`/`pending` re-run it.
  const count = turns.length;
  useEffect(() => {
    if (count || pending) end.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [count, pending]);

  const send = (q: string) => {
    const text = q.trim();
    if (!text || pending) return;
    const history = turns.filter((t) => !t.error).map(({ role, content }) => ({ role, content }));
    setTurns((t) => [...t, { role: "user", content: text }]);
    setQuestion("");
    start(async () => {
      const r = await ask({ question: text, history });
      setTurns((t) => [
        ...t,
        r.ok
          ? { role: "assistant", content: r.data?.answer ?? "", sources: r.data?.sources }
          : { role: "assistant", content: r.error, error: true },
      ]);
    });
  };

  return (
    <div className="flex flex-col gap-4">
      {turns.length === 0 && (
        <Card>
          <CardContent className="flex flex-col gap-3 p-6">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Sparkles className="size-4 text-primary" /> Claude looks things up with read-only
              tools: it sees totals and the few transactions it asks for, never your whole history
              or account numbers.
            </div>
            <div className="flex flex-wrap gap-2">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => send(s)}
                  className="rounded-full border bg-card px-3 py-1.5 text-sm hover:bg-muted"
                >
                  {s}
                </button>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <div className="flex flex-col gap-3" aria-live="polite">
        {turns.map((t, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: append-only conversation
          <div key={i} className={cn("flex", t.role === "user" ? "justify-end" : "justify-start")}>
            <div
              className={cn(
                "max-w-[85%] rounded-2xl px-4 py-2.5",
                t.role === "user"
                  ? "bg-primary text-primary-foreground"
                  : t.error
                    ? "border border-negative/30 bg-negative/10 text-negative"
                    : "border bg-card",
              )}
              data-testid={t.role === "assistant" && !t.error ? "answer" : undefined}
            >
              {t.role === "assistant" && !t.error ? (
                <Markdown text={t.content} />
              ) : (
                <p className="text-sm">{t.content}</p>
              )}
              {t.sources && t.sources.length > 0 && (
                <p className="mt-1 border-t pt-1.5 text-xs text-muted-foreground">
                  Looked at: {t.sources.join(" · ")}
                </p>
              )}
            </div>
          </div>
        ))}
        {pending && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Looking through your data…
          </div>
        )}
        <div ref={end} />
      </div>

      <form
        className="sticky bottom-4 flex items-end gap-2 rounded-2xl border bg-card p-2 shadow-lg"
        onSubmit={(e) => {
          e.preventDefault();
          send(question);
        }}
      >
        <textarea
          aria-label="Your question"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send(question);
            }
          }}
          rows={1}
          maxLength={1000}
          placeholder="Ask about spending, budgets, bills, net worth…"
          className="max-h-40 min-h-10 flex-1 resize-none bg-transparent px-2 py-2 text-sm outline-none"
        />
        <Button
          type="submit"
          size="icon"
          disabled={pending || question.trim().length < 2}
          aria-label="Ask"
        >
          {pending ? <Loader2 className="animate-spin" /> : <ArrowUp />}
        </Button>
      </form>
    </div>
  );
}
