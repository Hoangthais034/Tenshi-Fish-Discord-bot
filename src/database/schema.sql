CREATE TABLE IF NOT EXISTS tickets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  channel_id TEXT NOT NULL UNIQUE,
  user_id TEXT NOT NULL,
  user_name TEXT NOT NULL,
  open INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  closed_at TEXT,
  snoozed_until TEXT,
  title TEXT,
  close_reason TEXT,
  closed_by_staff_id TEXT,
  is_nsfw INTEGER NOT NULL DEFAULT 0,
  disabled INTEGER NOT NULL DEFAULT 0,
  added_user_ids TEXT NOT NULL DEFAULT '[]',
  subscriber_ids TEXT NOT NULL DEFAULT '[]',
  webhook_id TEXT,
  webhook_token TEXT,
  parent_ticket_id INTEGER,
  category TEXT,
  guild_id TEXT
);

CREATE TABLE IF NOT EXISTS blocks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  reason TEXT,
  blocked_at TEXT NOT NULL DEFAULT (datetime('now')),
  blocked_by_staff_id TEXT
);

CREATE TABLE IF NOT EXISTS whitelist (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  added_by_staff_id TEXT
);

CREATE TABLE IF NOT EXISTS message_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_channel_id TEXT NOT NULL,
  author_id TEXT NOT NULL,
  author_name TEXT NOT NULL,
  content TEXT NOT NULL,
  attachment_urls TEXT NOT NULL DEFAULT '[]',
  is_staff INTEGER NOT NULL DEFAULT 0,
  anonymous INTEGER NOT NULL DEFAULT 0,
  timestamp TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS snippets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT NOT NULL,
  name TEXT NOT NULL,
  content TEXT NOT NULL,
  UNIQUE(guild_id, name)
);

CREATE TABLE IF NOT EXISTS guild_configs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT NOT NULL UNIQUE,
  disable_new_tickets INTEGER NOT NULL DEFAULT 0,
  disable_all_tickets INTEGER NOT NULL DEFAULT 0,
  disabled_user_ids TEXT NOT NULL DEFAULT '[]',
  log_channel_id TEXT,
  alert_role_id TEXT,
  staff_role_ids TEXT NOT NULL DEFAULT '[]',
  greeting_message TEXT,
  greeting_enabled INTEGER NOT NULL DEFAULT 0,
  categories TEXT NOT NULL DEFAULT '[]',
  default_category_id TEXT
);

CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  ticket_channel_id TEXT NOT NULL,
  notify_on_reply INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS persistent_notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_channel_id TEXT NOT NULL UNIQUE,
  content TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_editor_id TEXT
);

CREATE TABLE IF NOT EXISTS honeypot_guilds (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT NOT NULL UNIQUE,
  trap_channels TEXT NOT NULL DEFAULT '[]',
  log_channel_id TEXT,
  action TEXT NOT NULL DEFAULT 'Kick',
  experiments INTEGER NOT NULL DEFAULT 0,
  dm_message TEXT,
  warning_message TEXT
);

CREATE INDEX IF NOT EXISTS idx_tickets_user_id ON tickets(user_id);
CREATE INDEX IF NOT EXISTS idx_tickets_channel_id ON tickets(channel_id);
CREATE INDEX IF NOT EXISTS idx_blocks_guild_user ON blocks(guild_id, user_id);
CREATE INDEX IF NOT EXISTS idx_message_logs_channel ON message_logs(ticket_channel_id);
CREATE INDEX IF NOT EXISTS idx_snippets_guild ON snippets(guild_id);
CREATE INDEX IF NOT EXISTS idx_notifications_channel ON notifications(ticket_channel_id);
