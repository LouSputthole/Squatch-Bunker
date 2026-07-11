/**
 * Campfire desktop — SQLite migration runner.
 *
 * The bundled app ships no Prisma CLI, so migrations are applied directly with
 * better-sqlite3. Each migration is a `<dir>/migration.sql` file; applied
 * migrations are recorded by directory name in `_campfire_migrations` so the
 * same code path handles both fresh installs and future updates.
 *
 * The SQL files are SQLite-flavoured (generated via `prisma migrate diff` with
 * the sqlite provider) — NOT the Postgres migrations under squatch-chat/prisma.
 */
import Database from "better-sqlite3";
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";

export function runMigrations(dbPath: string, migrationsDir: string): void {
  if (!existsSync(migrationsDir)) {
    console.log(`[Campfire] No migrations dir at ${migrationsDir} — skipping.`);
    return;
  }

  const db = new Database(dbPath);
  try {
    db.pragma("journal_mode = WAL");
    db.exec(
      `CREATE TABLE IF NOT EXISTS "_campfire_migrations" (
         "name" TEXT PRIMARY KEY,
         "applied_at" TEXT NOT NULL DEFAULT (datetime('now'))
       );`,
    );

    const applied = new Set(
      (db.prepare('SELECT name FROM "_campfire_migrations"').all() as { name: string }[]).map(
        (r) => r.name,
      ),
    );

    const dirs = readdirSync(migrationsDir)
      .filter((d) => {
        try {
          return statSync(join(migrationsDir, d)).isDirectory();
        } catch {
          return false;
        }
      })
      .sort();

    const record = db.prepare('INSERT INTO "_campfire_migrations" (name) VALUES (?)');

    for (const name of dirs) {
      if (applied.has(name)) continue;
      const sqlPath = join(migrationsDir, name, "migration.sql");
      if (!existsSync(sqlPath)) {
        // A packaging bug dropped the SQL but kept the folder. Running with a
        // knowingly-incomplete schema surfaces later as opaque 503s — refuse
        // to start instead (main.js turns this into a visible error dialog).
        throw new Error(`Migration ${name} has no migration.sql — bundle is incomplete`);
      }
      const sql = readFileSync(sqlPath, "utf8");
      // Each migration is applied atomically: either the whole SQL file lands and
      // the migration is recorded, or nothing is (transaction rolls back on throw).
      const apply = db.transaction(() => {
        db.exec(sql);
        record.run(name);
      });
      apply();
      console.log(`[Campfire] Applied migration: ${name}`);
    }
  } finally {
    db.close();
  }
}
