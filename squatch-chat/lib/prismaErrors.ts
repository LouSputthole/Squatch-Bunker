/**
 * Prisma's known-request error code (e.g. "P2002" unique violation, "P2003"
 * foreign key, "P2025" record missing). Kept apart from lib/db so routes can
 * use it where tests mock the database module.
 */
export function prismaErrorCode(error: unknown): string | null {
  return typeof error === "object" && error !== null && "code" in error
    && typeof (error as { code: unknown }).code === "string"
    ? (error as { code: string }).code
    : null;
}
