import type * as React from "react";

/**
 * Tiny, safe markdown renderer for AI answers: paragraphs, bullet/numbered lists,
 * **bold**, `code` and pipe tables. Builds React elements (no innerHTML), so model
 * output can never inject markup.
 */
function inline(text: string, key: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let last = 0;
  let i = 0;
  for (const m of text.matchAll(re)) {
    if ((m.index ?? 0) > last) out.push(text.slice(last, m.index));
    const tok = m[0];
    out.push(
      tok.startsWith("**") ? (
        <strong key={`${key}-${i++}`}>{tok.slice(2, -2)}</strong>
      ) : (
        <code key={`${key}-${i++}`} className="rounded bg-muted px-1 font-mono text-[0.85em]">
          {tok.slice(1, -1)}
        </code>
      ),
    );
    last = (m.index ?? 0) + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function Markdown({ text }: { text: string }) {
  const lines = text.replace(/\r/g, "").split("\n");
  const blocks: React.ReactNode[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] as string;
    if (!line.trim()) {
      i++;
      continue;
    }
    if (/^\s*\|/.test(line)) {
      const rows: string[][] = [];
      while (i < lines.length && /^\s*\|/.test(lines[i] as string)) {
        const cells = (lines[i] as string)
          .trim()
          .replace(/^\||\|$/g, "")
          .split("|")
          .map((c) => c.trim());
        if (!cells.every((c) => /^:?-{2,}:?$/.test(c))) rows.push(cells);
        i++;
      }
      const [head, ...body] = rows;
      blocks.push(
        <div key={`t${i}`} className="overflow-x-auto">
          <table className="my-2 w-full text-sm">
            {head && (
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  {head.map((c, j) => (
                    <th key={j} className="py-1 pr-4 font-medium">
                      {inline(c, `h${i}${j}`)}
                    </th>
                  ))}
                </tr>
              </thead>
            )}
            <tbody className="divide-y">
              {body.map((r, ri) => (
                <tr key={ri}>
                  {r.map((c, j) => (
                    <td key={j} className="py-1 pr-4 tabular">
                      {inline(c, `c${i}${ri}${j}`)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }
    if (/^\s*([-*]|\d+\.)\s+/.test(line)) {
      const ordered = /^\s*\d+\./.test(line);
      const items: string[] = [];
      while (i < lines.length && /^\s*([-*]|\d+\.)\s+/.test(lines[i] as string))
        items.push((lines[i++] as string).replace(/^\s*([-*]|\d+\.)\s+/, ""));
      const List = ordered ? "ol" : "ul";
      blocks.push(
        <List
          key={`l${i}`}
          className={`my-2 space-y-1 pl-5 ${ordered ? "list-decimal" : "list-disc"}`}
        >
          {items.map((it, j) => (
            <li key={j}>{inline(it, `li${i}${j}`)}</li>
          ))}
        </List>,
      );
      continue;
    }
    const para: string[] = [];
    while (
      i < lines.length &&
      (lines[i] as string).trim() &&
      !/^\s*(\||[-*]\s|\d+\.\s)/.test(lines[i] as string)
    )
      para.push((lines[i++] as string).replace(/^#+\s*/, ""));
    blocks.push(
      <p key={`p${i}`} className="my-2">
        {inline(para.join(" "), `p${i}`)}
      </p>,
    );
  }
  return <div className="text-sm leading-relaxed">{blocks}</div>;
}
