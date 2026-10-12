/**
 * Same-origin post-login destination from `?redirect=`; anything else falls back to /chat.
 * Resolves against the current origin and compares origins (prefix checks miss "/\t/evil.com"-style tricks).
 */
export function safeRedirectTarget(search: string, origin: string): string {
  const raw = new URLSearchParams(search).get("redirect");
  if (!raw || /[\u0000-\u001F\\]/.test(raw)) return "/chat";
  try {
    const url = new URL(raw, origin);
    if (url.origin !== origin) return "/chat";
    const target = url.pathname + url.search + url.hash;
    // Dot-segment normalization can turn "/.//evil.com" into a protocol-relative "//evil.com".
    return target.startsWith("//") ? "/chat" : target;
  } catch {
    return "/chat";
  }
}
