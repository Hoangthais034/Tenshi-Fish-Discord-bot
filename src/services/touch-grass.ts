import { injectable } from 'tsyringe';
import Database from 'better-sqlite3';
import { getDb } from '../database/init.js';
import type {
  TouchGrassEventRow,
  TouchGrassNotifyLevel,
  TouchGrassStatus,
  TouchGrassVoteValue,
} from '../database/types.js';

type Db = Database.Database;
export type ReminderKey = '24h' | '1h' | '15m';

const ID_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const DATE_INPUT_RE = /^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})$/;

const REMINDER_COLUMNS: Record<ReminderKey, string> = {
  '24h': 'reminder_24h',
  '1h': 'reminder_1h',
  '15m': 'reminder_15m',
};

const REMINDER_SENT_COLUMNS: Record<ReminderKey, string> = {
  '24h': 'reminder_24h_sent',
  '1h': 'reminder_1h_sent',
  '15m': 'reminder_15m_sent',
};

export interface DateTimeComponents {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

export const DEFAULT_EVENT_TIMEZONE = 'Asia/Ho_Chi_Minh';

/** Parses the modal's free-text date field ("DD/MM/YYYY HH:mm") into calendar components, rejecting malformed or non-calendar values (e.g. 31/02). Timezone-agnostic — apply a zone with zonedComponentsToUtc. */
export function parseEventDateInput(input: string): DateTimeComponents | null {
  const match = DATE_INPUT_RE.exec(input.trim());
  if (!match) return null;

  const [, dd, mm, yyyy, hh, min] = match;
  const day = Number(dd);
  const month = Number(mm);
  const year = Number(yyyy);
  const hour = Number(hh);
  const minute = Number(min);
  const check = new Date(year, month - 1, day, hour, minute, 0, 0);

  const roundTrips = check.getFullYear() === year
    && check.getMonth() === month - 1
    && check.getDate() === day
    && check.getHours() === hour
    && check.getMinutes() === minute;

  return roundTrips ? { year, month, day, hour, minute } : null;
}

/**
 * Converts wall-clock components in `timeZone` to the real UTC instant they represent.
 * Standard two-guess trick: treat the components as if they were already UTC, see what
 * that instant looks like when formatted in `timeZone`, and use the resulting offset to
 * correct the guess. Accurate outside the exact hour of a DST transition.
 */
export function zonedComponentsToUtc(components: DateTimeComponents, timeZone: string): Date {
  const { year, month, day, hour, minute } = components;
  const utcGuess = Date.UTC(year, month - 1, day, hour, minute, 0);

  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  }).formatToParts(new Date(utcGuess));

  const map: Record<string, string> = {};
  for (const part of parts) if (part.type !== 'literal') map[part.type] = part.value;
  const hourValue = Number(map.hour) === 24 ? 0 : Number(map.hour);

  const asUtcOfLocalRepresentation = Date.UTC(Number(map.year), Number(map.month) - 1, Number(map.day), hourValue, Number(map.minute), Number(map.second));
  const offset = asUtcOfLocalRepresentation - utcGuess;
  return new Date(utcGuess - offset);
}

function formatOffsetLabel(timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'shortOffset' }).formatToParts(new Date());
  return parts.find(p => p.type === 'timeZoneName')?.value ?? timeZone;
}

/** Pretty display form used in embeds, e.g. "30/08/2026 — 14:00 (GMT+7)". */
export function formatEventAtDisplay(iso: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(new Date(iso));

  const map: Record<string, string> = {};
  for (const part of parts) if (part.type !== 'literal') map[part.type] = part.value;
  return `${map.day}/${map.month}/${map.year} — ${map.hour}:${map.minute} (${formatOffsetLabel(timeZone)})`;
}

/** Plain form matching parseEventDateInput's expected format, used to prefill the edit modal. */
export function formatEventAtInput(iso: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(new Date(iso));

  const map: Record<string, string> = {};
  for (const part of parts) if (part.type !== 'literal') map[part.type] = part.value;
  return `${map.day}/${map.month}/${map.year} ${map.hour}:${map.minute}`;
}

/** SQLite's `datetime('now')` yields a UTC "YYYY-MM-DD HH:MM:SS" string with no zone marker. */
export function sqliteUtcToDate(value: string): Date {
  return new Date(`${value.replace(' ', 'T')}Z`);
}

@injectable()
export class TouchGrassService {
  private db: Db;

  constructor() {
    this.db = getDb();
  }

  private generateUniquePublicId(): string {
    for (let i = 0; i < 20; i++) {
      let suffix = '';
      for (let j = 0; j < 5; j++) suffix += ID_CHARS[Math.floor(Math.random() * ID_CHARS.length)];
      const publicId = `TG-${suffix}`;
      const existing = this.db.prepare('SELECT 1 FROM touch_grass_events WHERE public_id = ?').get(publicId);
      if (!existing) return publicId;
    }
    throw new Error('Failed to generate a unique touch-grass public id');
  }

  createDraft(guildId: string, channelId: string, creatorId: string, location: string, dateRaw: string, tz: string, eventAt: Date, description: string): TouchGrassEventRow {
    const publicId = this.generateUniquePublicId();
    const info = this.db.prepare(
      `INSERT INTO touch_grass_events (public_id, guild_id, channel_id, creator_id, location, description, event_at, event_tz, event_date_raw, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'DRAFT')`,
    ).run(publicId, guildId, channelId, creatorId, location, description, eventAt.toISOString(), tz, dateRaw);
    return this.getById(Number(info.lastInsertRowid))!;
  }

  getById(id: number): TouchGrassEventRow | undefined {
    return this.db.prepare('SELECT * FROM touch_grass_events WHERE id = ?').get(id) as TouchGrassEventRow | undefined;
  }

  deleteDraft(id: number): void {
    this.db.prepare("DELETE FROM touch_grass_events WHERE id = ? AND status = 'DRAFT'").run(id);
  }

  toggleReminder(id: number, key: ReminderKey): TouchGrassEventRow {
    const column = REMINDER_COLUMNS[key];
    this.db.prepare(`UPDATE touch_grass_events SET ${column} = 1 - ${column} WHERE id = ?`).run(id);
    return this.getById(id)!;
  }

  activate(id: number): TouchGrassEventRow {
    this.db.prepare("UPDATE touch_grass_events SET status = 'ACTIVE' WHERE id = ?").run(id);
    return this.getById(id)!;
  }

  setMessageId(id: number, messageId: string): void {
    this.db.prepare('UPDATE touch_grass_events SET message_id = ? WHERE id = ?').run(messageId, id);
  }

  close(id: number): TouchGrassEventRow {
    this.db.prepare("UPDATE touch_grass_events SET status = 'CLOSED' WHERE id = ?").run(id);
    return this.getById(id)!;
  }

  cancel(id: number): TouchGrassEventRow {
    this.db.prepare("UPDATE touch_grass_events SET status = 'CANCELLED' WHERE id = ?").run(id);
    return this.getById(id)!;
  }

  expire(id: number): TouchGrassEventRow {
    this.db.prepare("UPDATE touch_grass_events SET status = 'EXPIRED' WHERE id = ?").run(id);
    return this.getById(id)!;
  }

  updateDetails(id: number, location: string, description: string, dateRaw: string, tz: string, eventAt: Date): TouchGrassEventRow {
    this.db.prepare('UPDATE touch_grass_events SET location = ?, description = ?, event_at = ?, event_tz = ?, event_date_raw = ? WHERE id = ?')
      .run(location, description, eventAt.toISOString(), tz, dateRaw, id);
    return this.getById(id)!;
  }

  setTimezone(id: number, tz: string, eventAt: Date): void {
    this.db.prepare('UPDATE touch_grass_events SET event_tz = ?, event_at = ? WHERE id = ?').run(tz, eventAt.toISOString(), id);
  }

  setThread(id: number, threadId: string): void {
    this.db.prepare('UPDATE touch_grass_events SET thread_id = ? WHERE id = ?').run(threadId, id);
  }

  setNotifyLevel(id: number, level: TouchGrassNotifyLevel): void {
    this.db.prepare('UPDATE touch_grass_events SET notify_level = ? WHERE id = ?').run(level, id);
  }

  markReminderSent(id: number, key: ReminderKey): void {
    const column = REMINDER_SENT_COLUMNS[key];
    this.db.prepare(`UPDATE touch_grass_events SET ${column} = 1 WHERE id = ?`).run(id);
  }

  getActiveEvents(): TouchGrassEventRow[] {
    return this.db.prepare("SELECT * FROM touch_grass_events WHERE status = 'ACTIVE'").all() as TouchGrassEventRow[];
  }

  pruneOldDrafts(olderThanMinutes: number): void {
    this.db.prepare(
      `DELETE FROM touch_grass_events WHERE status = 'DRAFT' AND created_at < datetime('now', ?)`,
    ).run(`-${olderThanMinutes} minutes`);
  }

  countCreatedSince(creatorId: string, minutesAgo: number): number {
    const row = this.db.prepare(
      `SELECT COUNT(*) as c FROM touch_grass_events WHERE creator_id = ? AND created_at >= datetime('now', ?)`,
    ).get(creatorId, `-${minutesAgo} minutes`) as { c: number };
    return row.c;
  }

  oldestCreatedSince(creatorId: string, minutesAgo: number): string | null {
    const row = this.db.prepare(
      `SELECT MIN(created_at) as oldest FROM touch_grass_events WHERE creator_id = ? AND created_at >= datetime('now', ?)`,
    ).get(creatorId, `-${minutesAgo} minutes`) as { oldest: string | null };
    return row.oldest;
  }

  countActive(creatorId: string): number {
    const row = this.db.prepare(
      "SELECT COUNT(*) as c FROM touch_grass_events WHERE creator_id = ? AND status = 'ACTIVE'",
    ).get(creatorId) as { c: number };
    return row.c;
  }

  findDuplicateActive(creatorId: string, location: string, eventAt: Date, excludeId: number): TouchGrassEventRow | undefined {
    return this.db.prepare(
      `SELECT * FROM touch_grass_events
       WHERE creator_id = ? AND status = 'ACTIVE' AND id != ?
         AND lower(trim(location)) = lower(trim(?)) AND event_at = ?
       LIMIT 1`,
    ).get(creatorId, excludeId, location, eventAt.toISOString()) as TouchGrassEventRow | undefined;
  }

  upsertVote(eventId: number, userId: string, vote: TouchGrassVoteValue): void {
    this.db.prepare(
      `INSERT INTO touch_grass_votes (event_id, user_id, vote) VALUES (?, ?, ?)
       ON CONFLICT(event_id, user_id) DO UPDATE SET vote = excluded.vote, voted_at = datetime('now')`,
    ).run(eventId, userId, vote);
  }

  getVoteCounts(eventId: number): Record<TouchGrassVoteValue, number> {
    const rows = this.db.prepare(
      'SELECT vote, COUNT(*) as c FROM touch_grass_votes WHERE event_id = ? GROUP BY vote',
    ).all(eventId) as { vote: TouchGrassVoteValue; c: number }[];

    const counts: Record<TouchGrassVoteValue, number> = { going: 0, maybe: 0, cant_go: 0 };
    for (const row of rows) counts[row.vote] = row.c;
    return counts;
  }

  getGoingUserIds(eventId: number): string[] {
    return (this.db.prepare(
      "SELECT user_id FROM touch_grass_votes WHERE event_id = ? AND vote = 'going'",
    ).all(eventId) as { user_id: string }[]).map(r => r.user_id);
  }
}

export type { TouchGrassEventRow, TouchGrassStatus, TouchGrassNotifyLevel, TouchGrassVoteValue };
