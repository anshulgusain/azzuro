import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { PROPERTIES, bookingUrl } from '../shared/properties.js';
import { MIGRATIONS } from './schema.js';

export type Db = DatabaseSync;

export const DEFAULT_DB_PATH = resolve(process.env.REVIEWS_DB ?? 'data/azzurro.db');

export function openDb(path: string = DEFAULT_DB_PATH): Db {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  migrate(db);
  syncProperties(db);
  return db;
}

function migrate(db: Db): void {
  db.exec('CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)');
  const row = db.prepare('SELECT MAX(version) AS v FROM schema_version').get() as { v: number | null };
  const current = row.v ?? 0;
  for (let i = current; i < MIGRATIONS.length; i++) {
    transaction(db, () => {
      db.exec(MIGRATIONS[i]);
      db.prepare('INSERT INTO schema_version (version) VALUES (?)').run(i + 1);
    });
  }
}

/** Keeps the properties table in line with src/shared/properties.ts. */
function syncProperties(db: Db): void {
  const upsert = db.prepare(`
    INSERT INTO properties (id, name, page_name, booking_url) VALUES (?, ?, ?, ?)
    ON CONFLICT (id) DO UPDATE SET name = excluded.name, page_name = excluded.page_name, booking_url = excluded.booking_url
  `);
  for (const p of PROPERTIES) upsert.run(p.id, p.name, p.pageName, bookingUrl(p).replace('.en-gb.html', '.html'));
}

export function transaction<T>(db: Db, fn: () => T): T {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}
