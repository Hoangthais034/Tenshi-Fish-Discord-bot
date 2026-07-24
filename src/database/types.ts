export interface TicketRow {
  id: number;
  channel_id: string;
  user_id: string;
  user_name: string;
  open: number;
  created_at: string;
  closed_at: string | null;
  snoozed_until: string | null;
  title: string | null;
  close_reason: string | null;
  closed_by_staff_id: string | null;
  is_nsfw: number;
  disabled: number;
  added_user_ids: string;
  subscriber_ids: string;
  webhook_id: string | null;
  webhook_token: string | null;
}

export interface BlockRow {
  id: number;
  guild_id: string;
  user_id: string;
  reason: string | null;
  blocked_at: string;
  blocked_by_staff_id: string | null;
}

export interface WhitelistRow {
  id: number;
  guild_id: string;
  user_id: string;
  created_at: string;
  added_by_staff_id: string | null;
}

export interface MessageLogRow {
  id: number;
  ticket_channel_id: string;
  author_id: string;
  author_name: string;
  content: string;
  is_staff: number;
  anonymous: number;
  timestamp: string;
}

export interface SnippetRow {
  id: number;
  guild_id: string;
  name: string;
  content: string;
}

export interface GuildConfigRow {
  id: number;
  guild_id: string;
  disable_new_tickets: number;
  disable_all_tickets: number;
  disabled_user_ids: string;
}

export interface NotificationRow {
  id: number;
  guild_id: string;
  user_id: string;
  ticket_channel_id: string;
  notify_on_reply: number;
}

export interface PersistentNoteRow {
  id: number;
  ticket_channel_id: string;
  content: string;
  updated_at: string;
  last_editor_id: string | null;
}

export interface HoneypotGuildRow {
  id: number;
  guild_id: string;
  trap_channels: string;
  log_channel_id: string | null;
  action: string;
  experiments: number;
  dm_message: string | null;
  warning_message: string | null;
}

export type Action = 'Kick' | 'Ban' | 'Softban';
export type LoopMode = 'none' | 'track' | 'queue';
