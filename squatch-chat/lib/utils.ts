/**
 * Strip the #discriminator suffix from usernames for display.
 * "alice#a1b2c3d4" -> "alice"
 * "bob" -> "bob"
 */
export function displayName(username: string): string {
  const hashIdx = username.lastIndexOf("#");
  if (hashIdx > 0) return username.slice(0, hashIdx);
  return username;
}

/**
 * Truncate a display name if it's too long.
 */
export function truncateName(username: string, maxChars = 18): string {
  const name = displayName(username);
  return name.length > maxChars ? `${name.slice(0, maxChars)}...` : name;
}

/**
 * Get initials for avatar circle (2 chars max).
 */
export function initials(username: string): string {
  return displayName(username).slice(0, 2).toUpperCase();
}
