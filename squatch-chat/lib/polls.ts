export const MIN_POLL_OPTIONS = 2;
export const MAX_POLL_OPTIONS = 10;
export const MAX_POLL_QUESTION_LENGTH = 300;
export const MAX_POLL_OPTION_LENGTH = 120;

export interface PollDraft {
  question: string;
  options: string[];
  allowMultiple: boolean;
  closesAt: Date | null;
}

export function parsePollDraft(input: unknown): PollDraft | null {
  if (!input || typeof input !== "object") return null;
  const value = input as Record<string, unknown>;
  const question = typeof value.question === "string" ? value.question.trim() : "";
  const options = Array.isArray(value.options)
    ? value.options.map((option) => typeof option === "string" ? option.trim() : "")
    : [];

  if (!question || question.length > MAX_POLL_QUESTION_LENGTH) return null;
  if (options.length < MIN_POLL_OPTIONS || options.length > MAX_POLL_OPTIONS) return null;
  if (options.some((option) => !option || option.length > MAX_POLL_OPTION_LENGTH)) return null;
  if (new Set(options.map((option) => option.toLocaleLowerCase())).size !== options.length) return null;

  let closesAt: Date | null = null;
  if (value.closesAt !== undefined && value.closesAt !== null && value.closesAt !== "") {
    if (typeof value.closesAt !== "string") return null;
    closesAt = new Date(value.closesAt);
    if (Number.isNaN(closesAt.getTime()) || closesAt.getTime() <= Date.now()) return null;
  }

  return {
    question,
    options,
    allowMultiple: value.allowMultiple === true,
    closesAt,
  };
}

export function isPollClosed(poll: { closesAt: Date | string | null; closedAt: Date | string | null }, now = new Date()) {
  if (poll.closedAt) return true;
  return poll.closesAt ? new Date(poll.closesAt).getTime() <= now.getTime() : false;
}
