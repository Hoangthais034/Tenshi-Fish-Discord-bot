import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = typeof __dirname !== 'undefined' ? __dirname : dirname(fileURLToPath(import.meta.url));

let db: Database.Database | null = null;

export function getDb(dbPath?: string): Database.Database {
  if (db) return db;

  const path = dbPath ?? process.env.DATA_PATH ?? join(__dirname, '..', '..', '.data', 'bot-data.db');

  db = new Database(path);

  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  const schema = readFileSync(join(__dirname, 'schema.sql'), 'utf-8');
  db.exec(schema);

  return db;
}

if (typeof import.meta !== 'undefined' && import.meta.url === `file://${process.argv[1]}`) {
  const d = getDb();
  console.log(`Database initialized at: ${d.name}`);
  d.close();
}
