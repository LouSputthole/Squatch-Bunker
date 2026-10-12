/**
 * The small Markdown subset the Terms and Privacy Policy are written in:
 * `#`-`###` headings, paragraphs, `> ` quotes, `- ` and `1. ` lists, pipe
 * tables, and inline **bold**, `code`, [links](url), <https://autolinks>, and
 * bare email addresses. Run it on fillLegalPlaceholders() output (lib/legal.ts),
 * which has already dropped the owner-note comments.
 */

export type Inline =
  | { type: "text"; text: string }
  | { type: "strong"; children: Inline[] }
  | { type: "code"; text: string }
  | { type: "link"; href: string; children: Inline[] };

export type Block =
  | { type: "heading"; level: number; text: string; id: string }
  | { type: "paragraph"; text: string }
  | { type: "quote"; text: string }
  | { type: "list"; ordered: boolean; items: string[] }
  | { type: "table"; header: string[]; rows: string[][] };

const INLINE = /\*\*(.+?)\*\*|`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\)|<(https?:\/\/[^>\s]+)>|([\w.+-]+@[\w-]+(?:\.[\w-]+)+)/g;

export function parseInline(text: string): Inline[] {
  const nodes: Inline[] = [];
  let last = 0;
  for (const match of text.matchAll(INLINE)) {
    if (match.index > last) nodes.push({ type: "text", text: text.slice(last, match.index) });
    const [whole, strong, code, linkText, href, autolink, email] = match;
    if (strong !== undefined) nodes.push({ type: "strong", children: parseInline(strong) });
    else if (code !== undefined) nodes.push({ type: "code", text: code });
    else if (linkText !== undefined) nodes.push({ type: "link", href, children: parseInline(linkText) });
    else if (autolink !== undefined) nodes.push({ type: "link", href: autolink, children: [{ type: "text", text: autolink }] });
    else nodes.push({ type: "link", href: `mailto:${email}`, children: [{ type: "text", text: email }] });
    last = match.index + whole.length;
  }
  if (last < text.length) nodes.push({ type: "text", text: text.slice(last) });
  return nodes;
}

export function headingId(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function tableCells(row: string): string[] {
  return row.replace(/^\||\|$/g, "").split("|").map((cell) => cell.trim());
}

const BLOCK_START = /^(#{1,3} |> |- |\d+\. |\|)/;

export function parseLegalMarkdown(markdown: string): Block[] {
  const lines = markdown.split(/\r?\n/).map((line) => line.trim());
  const blocks: Block[] = [];
  let i = 0;
  // Consecutive lines matching `prefix` form one block.
  const run = (prefix: RegExp) => {
    const taken: string[] = [];
    while (i < lines.length && prefix.test(lines[i])) taken.push(lines[i++]);
    return taken;
  };

  while (i < lines.length) {
    const line = lines[i];
    const heading = /^(#{1,3}) (.+)$/.exec(line);
    if (!line) {
      i += 1;
    } else if (heading) {
      blocks.push({ type: "heading", level: heading[1].length, text: heading[2], id: headingId(heading[2]) });
      i += 1;
    } else if (line.startsWith("> ")) {
      blocks.push({ type: "quote", text: run(/^> /).map((l) => l.slice(2)).join(" ") });
    } else if (line.startsWith("|")) {
      const [header, , ...rows] = run(/^\|/).map(tableCells);
      blocks.push({ type: "table", header, rows });
    } else if (line.startsWith("- ")) {
      blocks.push({ type: "list", ordered: false, items: run(/^- /).map((l) => l.slice(2)) });
    } else if (/^\d+\. /.test(line)) {
      blocks.push({ type: "list", ordered: true, items: run(/^\d+\. /).map((l) => l.replace(/^\d+\. /, "")) });
    } else {
      const text: string[] = [];
      while (i < lines.length && lines[i] && !BLOCK_START.test(lines[i])) text.push(lines[i++]);
      blocks.push({ type: "paragraph", text: text.join(" ") });
    }
  }
  return blocks;
}
