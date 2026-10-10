import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';

const require = createRequire(import.meta.url);

export function resolveSessionTitleFromDb(
  sessionID: string,
): string | undefined {
  if (!sessionID) return undefined;

  try {
    const dbPath = join(
      homedir(),
      '.local',
      'share',
      'opencode',
      'opencode.db',
    );
    if (!existsSync(dbPath)) return undefined;

    // 1. Try bun:sqlite
    try {
      const { Database } = require('bun:sqlite');
      const db = new Database(dbPath, { readonly: true });
      const row = db
        .query(
          'SELECT title, slug, directory FROM session_v2 WHERE id = ? LIMIT 1',
        )
        .get(sessionID) as
        | { title?: string; slug?: string; directory?: string }
        | undefined;
      db.close();

      if (row) {
        if (row.title?.trim() && !row.title.startsWith('ses_')) {
          return row.title.trim();
        }
        if (row.slug?.trim()) {
          return row.slug.trim();
        }
        if (row.directory?.trim()) {
          return `${basename(row.directory.trim())} job`;
        }
      }
    } catch {}

    // 2. Try node:sqlite
    try {
      const { DatabaseSync } = require('node:sqlite');
      const db = new DatabaseSync(dbPath, { readOnly: true });
      const stmt = db.prepare(
        'SELECT title, slug, directory FROM session_v2 WHERE id = ? LIMIT 1',
      );
      const row = stmt.get(sessionID) as
        | { title?: string; slug?: string; directory?: string }
        | undefined;
      db.close();

      if (row) {
        if (row.title?.trim() && !row.title.startsWith('ses_')) {
          return row.title.trim();
        }
        if (row.slug?.trim()) {
          return row.slug.trim();
        }
        if (row.directory?.trim()) {
          return `${basename(row.directory.trim())} job`;
        }
      }
    } catch {}
  } catch {}

  return undefined;
}
