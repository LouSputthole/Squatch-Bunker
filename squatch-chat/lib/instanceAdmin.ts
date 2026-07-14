/**
 * Instance-wide analytics expose cross-server metadata, so access is denied
 * unless the authenticated user's immutable ID is explicitly allowlisted.
 */
export function isInstanceAdmin(
  userId: string,
  rawAllowlist: string | undefined = process.env.INSTANCE_ADMIN_USER_IDS,
): boolean {
  if (!rawAllowlist) return false;
  const allowed = rawAllowlist
    .split(",")
    .map((id) => id.trim())
    .filter((id) => id.length > 0 && id !== "*");
  return allowed.includes(userId);
}
