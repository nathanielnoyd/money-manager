import { createServer, type Server } from "node:http";

/**
 * A stand-in for the Anthropic Messages API so E2E tests exercise the real SDK and app
 * code paths without a key or network. It answers by request shape:
 * - categorization (structured output) → a category for every transaction
 * - digest (structured output) → a fixed digest
 * - Ask with tools → first calls spending_by_category, then answers from its result
 */
export const FAKE_ANTHROPIC_PORT = 3199;

type Block = { type: string; content?: unknown; text?: string };
interface Body {
  system?: string;
  tools?: { name: string }[];
  messages: { role: string; content: string | Block[] }[];
}

function toolResultText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map((c: Block) => c.text ?? "").join("");
  return "";
}

function reply(body: Body) {
  const base = {
    id: "msg_fake",
    type: "message",
    role: "assistant",
    model: "claude-opus-5-5",
    stop_sequence: null,
    usage: { input_tokens: 1234, output_tokens: 56 },
  };
  const text = (t: string) => ({
    ...base,
    stop_reason: "end_turn",
    content: [{ type: "text", text: t }],
  });
  const system = String(body.system ?? "");
  const first = body.messages[0]?.content;
  const userText = typeof first === "string" ? first : "";

  if (system.includes("categorize personal bank transactions")) {
    const payload = JSON.parse(userText.split("\n\n")[1] ?? "{}");
    const pick = (d: string) =>
      /coffee|roast/i.test(d) ? "Coffee" : /market|grocer/i.test(d) ? "Groceries" : null;
    const results = payload.transactions.map((t: { ref: number; description: string }) => {
      const category = pick(t.description);
      return { ref: t.ref, category, confidence: category ? "high" : "low" };
    });
    return text(JSON.stringify({ results }));
  }
  if (system.includes("weekly money digest")) {
    return text(
      JSON.stringify({
        title: "A steady week",
        summary: "You spent close to your usual week.",
        highlights: ["Groceries led spending", "Nothing unusual came up"],
      }),
    );
  }
  // The SDK's tool runner doesn't resend `tools` on follow-up turns, so key on the tool result.
  const last = body.messages[body.messages.length - 1];
  const result = Array.isArray(last?.content)
    ? last.content.find((b) => b.type === "tool_result")
    : undefined;
  if (result || body.tools?.some((t) => t.name === "spending_by_category")) {
    if (!result) {
      const today = new Date().toISOString().slice(0, 10);
      const start = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
      return {
        ...base,
        stop_reason: "tool_use",
        content: [
          {
            type: "tool_use",
            id: "toolu_fake",
            name: "spending_by_category",
            input: { start, end: today },
          },
        ],
      };
    }
    const data = JSON.parse(toolResultText(result.content));
    const top = data.categories?.[0];
    return text(
      top
        ? `Your biggest category was **${top.category}** at $${top.spent.toFixed(2)}.`
        : "No spending found.",
    );
  }
  return text("ok");
}

export function startFakeAnthropic(): Promise<Server> {
  const server = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => {
      raw += c;
    });
    req.on("end", () => {
      if (req.method !== "POST" || !req.url?.startsWith("/v1/messages")) {
        res.writeHead(404).end();
        return;
      }
      const parsed = JSON.parse(raw) as Body;
      if (process.env.FAKE_ANTHROPIC_DEBUG)
        console.log(
          "[fake-anthropic]",
          JSON.stringify({
            tools: parsed.tools?.map((t) => t.name),
            last: parsed.messages.at(-1),
          }).slice(0, 600),
        );
      const out = reply(parsed);
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(out));
    });
  });
  return new Promise((resolve) =>
    server.listen(FAKE_ANTHROPIC_PORT, "127.0.0.1", () => resolve(server)),
  );
}
