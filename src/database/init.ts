import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

let db: Database.Database | null = null;

function getSchemaPath(): string {
  try {
    return join(dirname(fileURLToPath(import.meta.url)), 'schema.sql');
  } catch {
    return join(process.cwd(), 'dist', 'schema.sql');
  }
}

function getDbPath(dbPath?: string): string {
  if (dbPath) return dbPath;
  if (process.env.DATA_PATH) return process.env.DATA_PATH;
  try {
    return join(dirname(fileURLToPath(import.meta.url)), '..', '..', '.data', 'bot-data.db');
  } catch {
    return join(process.cwd(), '.data', 'bot-data.db');
  }
}

export function getDb(dbPath?: string): Database.Database {
  if (db) return db;

  const path = getDbPath(dbPath);
  db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  const schema = readFileSync(getSchemaPath(), 'utf-8');
  db.exec(schema);

  return db;
}

function isMain(): boolean {
  try {
    if (typeof import.meta !== 'undefined' && import.meta.url) {
      return import.meta.url === `file://${process.argv[1]}`;
    }
  } catch {}
  return false;
}

if (isMain()) {
  const d = getDb();
  console.log(`Database initialized at: ${d.name}`);
  d.close();
}
