import Image from "next/image";
import Link from "next/link";
import { Fragment, type ReactNode } from "react";
import { fillLegalPlaceholders, legalPlaceholdersRemaining } from "@/lib/legal";
import { parseInline, parseLegalMarkdown, type Block, type Inline } from "@/lib/legalMarkdown";

const REPO_URL = "https://github.com/LouSputthole/Squatch-Bunker";
const linkClass =
  "text-[var(--accent)] underline underline-offset-2 hover:text-[var(--text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]";

function inline(text: string): ReactNode {
  return renderInline(parseInline(text));
}

function renderInline(nodes: Inline[]): ReactNode {
  return nodes.map((node, i) => {
    switch (node.type) {
      case "text":
        return node.text;
      case "strong":
        return <strong key={i} className="font-semibold text-[var(--text)]">{renderInline(node.children)}</strong>;
      case "code":
        return <code key={i} className="rounded bg-[var(--panel-2)] px-1 py-0.5 font-mono text-[0.9em]">{node.text}</code>;
      case "link":
        return <a key={i} href={node.href} className={linkClass}>{renderInline(node.children)}</a>;
    }
  });
}

function renderBlock(block: Block): ReactNode {
  switch (block.type) {
    case "heading":
      if (block.level === 1) return null; // the page header shows the title
      return block.level === 2 ? (
        <h2 id={block.id} className="mt-10 mb-3 scroll-mt-6 text-xl font-semibold text-[var(--text)]">{inline(block.text)}</h2>
      ) : (
        <h3 id={block.id} className="mt-6 mb-2 scroll-mt-6 text-lg font-semibold text-[var(--text)]">{inline(block.text)}</h3>
      );
    case "paragraph":
      return <p className="my-3 leading-relaxed">{inline(block.text)}</p>;
    case "quote":
      return (
        <blockquote className="my-3 rounded-r-lg border-l-4 border-[var(--accent)] bg-[var(--panel)] px-4 py-2 text-sm">
          {inline(block.text)}
        </blockquote>
      );
    case "list": {
      const List = block.ordered ? "ol" : "ul";
      return (
        <List className={`my-3 space-y-1.5 pl-6 leading-relaxed ${block.ordered ? "list-decimal" : "list-disc"}`}>
          {block.items.map((item, j) => <li key={j}>{inline(item)}</li>)}
        </List>
      );
    }
    case "table":
      return (
        <div className="my-4 overflow-x-auto rounded-lg border border-[var(--accent-2)]/40">
          <table className="w-full border-collapse text-left text-sm">
            <thead className="bg-[var(--panel-2)] text-[var(--text)]">
              <tr>{block.header.map((cell, j) => <th key={j} scope="col" className="px-3 py-2 font-semibold">{inline(cell)}</th>)}</tr>
            </thead>
            <tbody>
              {block.rows.map((row, r) => (
                <tr key={r} className="border-t border-[var(--accent-2)]/30 align-top">
                  {row.map((cell, j) => <td key={j} className="px-3 py-2">{inline(cell)}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
  }
}

type Heading = Extract<Block, { type: "heading" }>;

/** A Terms/Privacy page: title, effective date, contents, and the document. */
export default function LegalDocument({ markdown }: { markdown: string }) {
  const blocks = parseLegalMarkdown(fillLegalPlaceholders(markdown));
  const headings = blocks.filter((block): block is Heading => block.type === "heading");
  const title = headings.find((heading) => heading.level === 1);
  const sections = headings.filter((heading) => heading.level === 2);
  const unfilled = legalPlaceholdersRemaining().length;

  return (
    <div className="min-h-screen flex flex-col bg-[var(--bg)] text-[var(--text)]">
      <header className="mx-auto w-[calc(100%_-_2rem)] max-w-3xl pt-6">
        <Link href="/" className="inline-flex items-center gap-2 font-semibold hover:text-[var(--accent)]">
          <Image src="/Campfire-Icon.png" alt="" width={32} height={32} className="h-8 w-8" />
          Campfire
        </Link>
      </header>
      <main className="mx-auto w-[calc(100%_-_2rem)] max-w-3xl flex-1 py-8 break-words">
        {unfilled > 0 && (
          <p role="note" className="mb-6 rounded-lg border border-[var(--danger)] bg-[var(--danger)]/15 p-3 text-sm">
            <strong>Draft.</strong> {unfilled} {unfilled === 1 ? "detail is" : "details are"} still in [brackets]
            until the operator fills {unfilled === 1 ? "it" : "them"} in.
          </p>
        )}
        <article>
          {title && <h1 className="text-3xl font-bold">{inline(title.text)}</h1>}
          {blocks.map((block, i) => (
            <Fragment key={i}>
              {block === sections[0] && (
                <nav aria-label="Contents" className="my-6 rounded-2xl border border-[var(--accent-2)]/40 bg-[var(--panel)] p-5">
                  <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">Contents</h2>
                  <ol className="space-y-1 text-sm">
                    {sections.map((section) => (
                      <li key={section.id}>
                        <a href={`#${section.id}`} className={linkClass}>{section.text}</a>
                      </li>
                    ))}
                  </ol>
                </nav>
              )}
              {renderBlock(block)}
            </Fragment>
          ))}
        </article>
      </main>
      <footer aria-label="Legal and source" className="px-4 pb-6 text-center text-xs text-[var(--muted)]">
        <Link href="/terms" className={linkClass}>Terms of Service</Link> |{" "}
        <Link href="/privacy" className={linkClass}>Privacy Policy</Link> |{" "}
        <a href={REPO_URL} className={linkClass}>Source (AGPL-3.0-only)</a>
      </footer>
    </div>
  );
}
