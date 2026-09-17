import { displayName } from "@/lib/utils";

export const MAX_JOURNAL_NOTE_LENGTH = 500;

export function normalizeJournalNote(value: unknown): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") return null;
  const note = value.trim();
  if (!note || note.length > MAX_JOURNAL_NOTE_LENGTH) return null;
  return note;
}

export function journalSnapshot(message: {
  content: string;
  attachmentUrl: string | null;
  attachmentName: string | null;
}) {
  return {
    content: message.content,
    attachmentUrl: message.attachmentUrl,
    attachmentName: message.attachmentName,
  };
}

/** Markdown export of a member's own journal (already-authorized entries). */
export function journalMarkdown(
  entries: ReadonlyArray<{
    content: string;
    note?: string | null;
    attachmentName?: string | null;
    createdAt: string;
    sourceMessage?: { author: { username: string } } | null;
  }>,
): string {
  const sections = entries.map((entry) => {
    const author = entry.sourceMessage && displayName(entry.sourceMessage.author.username);
    return [
      `## ${new Date(entry.createdAt).toISOString().slice(0, 16).replace("T", " ")} UTC${author ? ` · ${author}` : ""}`,
      entry.note ? `_${entry.note}_` : null,
      entry.content ? entry.content.replace(/^/gm, "> ") : null,
      entry.attachmentName ? `Attachment: ${entry.attachmentName}` : null,
    ].filter(Boolean).join("\n\n");
  });
  return `# Camp Journal\n\n${sections.join("\n\n")}\n`;
}
