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
