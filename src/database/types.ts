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
  parent_ticket_id: number | null;
  category: string | null;
  guild_id: string | null;
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
  attachment_urls: string;
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
  log_channel_id: string | null;
  alert_role_id: string | null;
  staff_role_ids: string;
  greeting_message: string | null;
  greeting_enabled: number;
  categories: string;
  default_category_id: string | null;
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

export type TouchGrassStatus = 'DRAFT' | 'ACTIVE' | 'CLOSED' | 'CANCELLED' | 'EXPIRED';
export type TouchGrassNotifyLevel = 'none' | 'participants' | 'here' | 'everyone';
export type TouchGrassVoteValue = 'going' | 'maybe' | 'cant_go';

export interface TouchGrassEventRow {
  id: number;
  public_id: string;
  guild_id: string;
  channel_id: string;
  message_id: string | null;
  thread_id: string | null;
  creator_id: string;
  location: string;
  description: string;
  event_at: string;
  event_tz: string;
  event_date_raw: string;
  status: TouchGrassStatus;
  notify_level: TouchGrassNotifyLevel | null;
  reminder_24h: number;
  reminder_1h: number;
  reminder_15m: number;
  reminder_24h_sent: number;
  reminder_1h_sent: number;
  reminder_15m_sent: number;
  created_at: string;
}

export interface TouchGrassVoteRow {
  event_id: number;
  user_id: string;
  vote: TouchGrassVoteValue;
  voted_at: string;
}

export type Action = 'Kick' | 'Ban' | 'Softban';
export type LoopMode = 'none' | 'track' | 'queue';
