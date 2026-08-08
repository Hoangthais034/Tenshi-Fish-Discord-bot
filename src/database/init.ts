import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Columns added to tables after their initial CREATE TABLE. schema.sql's
// `CREATE TABLE IF NOT EXISTS` never retrofits these onto pre-existing databases,
// so every column added over time must also be listed here to reach old DBs.
const COLUMN_MIGRATIONS: { table: string; column: string; ddl: string }[] = [
  { table: 'tickets', column: 'closed_at', ddl: 'TEXT' },
  { table: 'tickets', column: 'snoozed_until', ddl: 'TEXT' },
  { table: 'tickets', column: 'title', ddl: 'TEXT' },
  { table: 'tickets', column: 'close_reason', ddl: 'TEXT' },
  { table: 'tickets', column: 'closed_by_staff_id', ddl: 'TEXT' },
  { table: 'tickets', column: 'is_nsfw', ddl: 'INTEGER NOT NULL DEFAULT 0' },
  { table: 'tickets', column: 'disabled', ddl: 'INTEGER NOT NULL DEFAULT 0' },
  { table: 'tickets', column: 'added_user_ids', ddl: "TEXT NOT NULL DEFAULT '[]'" },
  { table: 'tickets', column: 'subscriber_ids', ddl: "TEXT NOT NULL DEFAULT '[]'" },
  { table: 'tickets', column: 'webhook_id', ddl: 'TEXT' },
  { table: 'tickets', column: 'webhook_token', ddl: 'TEXT' },
  { table: 'tickets', column: 'parent_ticket_id', ddl: 'INTEGER' },
  { table: 'tickets', column: 'category', ddl: 'TEXT' },
  { table: 'tickets', column: 'guild_id', ddl: 'TEXT' },
  { table: 'message_logs', column: 'attachment_urls', ddl: "TEXT NOT NULL DEFAULT '[]'" },
  { table: 'message_logs', column: 'is_staff', ddl: 'INTEGER NOT NULL DEFAULT 0' },
  { table: 'message_logs', column: 'anonymous', ddl: 'INTEGER NOT NULL DEFAULT 0' },
  { table: 'guild_configs', column: 'disable_new_tickets', ddl: 'INTEGER NOT NULL DEFAULT 0' },
  { table: 'guild_configs', column: 'disable_all_tickets', ddl: 'INTEGER NOT NULL DEFAULT 0' },
  { table: 'guild_configs', column: 'disabled_user_ids', ddl: "TEXT NOT NULL DEFAULT '[]'" },
  { table: 'guild_configs', column: 'log_channel_id', ddl: 'TEXT' },
  { table: 'guild_configs', column: 'alert_role_id', ddl: 'TEXT' },
  { table: 'guild_configs', column: 'staff_role_ids', ddl: "TEXT NOT NULL DEFAULT '[]'" },
  { table: 'guild_configs', column: 'greeting_message', ddl: 'TEXT' },
  { table: 'guild_configs', column: 'greeting_enabled', ddl: 'INTEGER NOT NULL DEFAULT 0' },
  { table: 'guild_configs', column: 'categories', ddl: "TEXT NOT NULL DEFAULT '[]'" },
  { table: 'guild_configs', column: 'default_category_id', ddl: 'TEXT' },
];

function migrate(database: Database.Database): void {
  for (const { table, column, ddl } of COLUMN_MIGRATIONS) {
    const existingColumns = (database.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map(c => c.name);
    if (!existingColumns.includes(column)) {
      database.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
    }
  }

  database.exec('CREATE INDEX IF NOT EXISTS idx_tickets_guild_id ON tickets(guild_id)');

  const fallbackGuildId = (process.env.MODMAIL_GUILD_IDS || process.env.MODMAIL_GUILD_ID || '')
    .split(',')
    .map(id => id.trim())
    .filter(Boolean)[0];

  if (fallbackGuildId) {
    database.prepare('UPDATE tickets SET guild_id = ? WHERE guild_id IS NULL').run(fallbackGuildId);
  }
}

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
  migrate(db);

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
