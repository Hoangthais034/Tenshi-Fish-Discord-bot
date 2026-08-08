import { injectable, inject } from 'tsyringe';
import {
  Client,
  type TextChannel,
  type GuildMember,
  type User,
  DMChannel,
  type Message,
  EmbedBuilder,
  WebhookClient,
  Colors,
  type Guild,
  type GuildTextBasedChannel,
  PermissionFlagsBits,
  ChannelType,
  type Snowflake,
} from 'discord.js';
import { getDb } from '../database/init.js';
import type { TicketRow, BlockRow, WhitelistRow, SnippetRow, GuildConfigRow, NotificationRow, PersistentNoteRow, MessageLogRow } from '../database/types.js';
import { config } from '../config.js';
import Database from 'better-sqlite3';
import { t } from '../locales/index.js';

type Db = Database.Database;

function parseIds(value: string): string[] {
  try { return JSON.parse(value) as string[]; } catch { return []; }
}

function jsonArray(arr: string[]): string {
  return JSON.stringify(arr);
}

interface PendingGuildChoice {
  guildIds: string[];
  message: Message;
  timeout: ReturnType<typeof setTimeout>;
}

const GUILD_CHOICE_TIMEOUT_MS = 5 * 60 * 1000;

@injectable()
export class ModmailService {
  private db: Db;
  private pendingGuildChoice = new Map<string, PendingGuildChoice>();

  constructor(@inject(Client) private readonly client: Client) {
    this.db = getDb();
  }

  registerHandlers(): void {
    this.client.on('messageCreate', msg => {
      if (msg.author.bot) return;
      if (msg.channel.type === ChannelType.DM) {
        this.handleIncomingDm(msg).catch(e => console.error('DM handler error:', e));
      }
    });
  }

  // ─── DM Handler ──────────────────────────────────────────────────────────────

  /** Finds every configured modmail guild the given user is currently a member of. */
  private async findMutualModmailGuilds(userId: string): Promise<Guild[]> {
    const matches: Guild[] = [];
    for (const guildId of config.modmail.guildIds) {
      const guild = this.client.guilds.cache.get(guildId);
      if (!guild) continue;
      const member = guild.members.cache.get(userId) ?? await guild.members.fetch(userId).catch(() => null);
      if (member) matches.push(guild);
    }
    return matches;
  }

  private async handleIncomingDm(message: Message): Promise<void> {
    const dmChannel = message.channel as DMChannel;
    const authorId = message.author.id;

    const pending = this.pendingGuildChoice.get(authorId);
    if (pending) {
      const choice = Number.parseInt(message.content.trim(), 10);
      if (!Number.isInteger(choice) || choice < 1 || choice > pending.guildIds.length) {
        await dmChannel.send(t('modmail.dm.select_guild_invalid')).catch(() => {});
        return;
      }

      clearTimeout(pending.timeout);
      this.pendingGuildChoice.delete(authorId);

      const chosenGuild = this.client.guilds.cache.get(pending.guildIds[choice - 1]);
      if (!chosenGuild) {
        await dmChannel.send(t('modmail.dm.guild_unavailable')).catch(() => {});
        return;
      }

      await this.processDm(chosenGuild, pending.message, dmChannel);
      return;
    }

    const existingTicket = this.db.prepare('SELECT * FROM tickets WHERE user_id = ? AND open = 1').get(authorId) as TicketRow | undefined;

    let guild: Guild;
    if (existingTicket) {
      const ticketGuild = existingTicket.guild_id ? this.client.guilds.cache.get(existingTicket.guild_id) : undefined;
      if (!ticketGuild) {
        await dmChannel.send(t('modmail.dm.guild_unavailable')).catch(() => {});
        return;
      }
      guild = ticketGuild;
    } else {
      const matches = await this.findMutualModmailGuilds(authorId);
      if (matches.length === 0) {
        await dmChannel.send(t('modmail.dm.no_mutual_guild')).catch(() => {});
        return;
      }

      if (matches.length > 1) {
        const list = matches.map((g, i) => `${i + 1}. ${g.name}`).join('\n');
        await dmChannel.send(t('modmail.dm.select_guild_prompt', { list })).catch(() => {});
        const timeout = setTimeout(() => this.pendingGuildChoice.delete(authorId), GUILD_CHOICE_TIMEOUT_MS);
        this.pendingGuildChoice.set(authorId, { guildIds: matches.map(g => g.id), message, timeout });
        return;
      }

      guild = matches[0];
    }

    await this.processDm(guild, message, dmChannel);
  }

  private async processDm(guild: Guild, message: Message, dmChannel: DMChannel): Promise<void> {
    const cfg = this.getGuildConfig(guild.id);
    if (cfg.disable_all_tickets === 1 || parseIds(cfg.disabled_user_ids).includes(message.author.id)) {
      await dmChannel.send(t('modmail.dm.disabled_all')).catch(() => {});
      return;
    }

    if (this.isBlocked(guild.id, message.author.id)) {
      await dmChannel.send(t('modmail.dm.blocked')).catch(() => {});
      return;
    }

    let ticket = this.db.prepare('SELECT * FROM tickets WHERE user_id = ? AND open = 1').get(message.author.id) as TicketRow | undefined;
    let channel: TextChannel | null = null;

    // ─── DM Commands ──────────────────────────────────────────────────────
    const content = message.content.trim();

    if (content === '!close' || content === '!status') {
      if (!ticket) {
        await dmChannel.send(t('modmail.dm.no_open_ticket')).catch(() => {});
        return;
      }

      if (content === '!status') {
        const unix = Math.floor(new Date(ticket.created_at).getTime() / 1000);
        const msg = ticket.snoozed_until && new Date(ticket.snoozed_until) > new Date()
          ? t('modmail.dm.status_snoozed', { time: `<t:${Math.floor(new Date(ticket.snoozed_until).getTime() / 1000)}:R>` })
          : t('modmail.dm.status_open', { time: `<t:${unix}:R>` });
        await dmChannel.send(msg).catch(() => {});
        return;
      }

      if (content === '!close') {
        channel = guild.channels.cache.get(ticket.channel_id) as TextChannel | null;
        this.db.prepare('UPDATE tickets SET open = 0, closed_at = datetime(\'now\'), close_reason = ? WHERE channel_id = ?').run('Closed by user via DM', ticket.channel_id);
        if (channel) {
          await channel.send({
            embeds: [new EmbedBuilder()
              .setTitle(t('modmail.dm.close_title'))
              .setDescription(t('modmail.dm.close_description'))
              .setColor(Colors.Red)
              .setTimestamp()],
          });
          await channel.delete();
        }
        await dmChannel.send(t('modmail.dm.close_success')).catch(() => {});
        return;
      }
    }

    if (ticket) {
      if (ticket.disabled === 1) {
        await dmChannel.send(t('modmail.dm.ticket_disabled')).catch(() => {});
        return;
      }

      if (ticket.snoozed_until && new Date(ticket.snoozed_until) > new Date()) {
        const unix = Math.floor(new Date(ticket.snoozed_until).getTime() / 1000);
        await dmChannel.send(t('modmail.dm.snoozed', { time: `<t:${unix}:R>` })).catch(() => {});
        return;
      }

      channel = guild.channels.cache.get(ticket.channel_id) as TextChannel | null;
    }

    if (!channel) {
      if (cfg.disable_new_tickets === 1) {
        await dmChannel.send(t('modmail.dm.new_disabled')).catch(() => {});
        return;
      }

      const restChannel = await guild.channels.create({
        name: `ticket-${message.author.username}-${message.author.id.slice(-4)}`.toLowerCase(),
        type: ChannelType.GuildText,
        parent: this.getDefaultCategory(guild.id) ?? undefined,
      });

      channel = restChannel;
      const insert = this.db.prepare(
        `INSERT INTO tickets (channel_id, user_id, user_name, open, created_at, guild_id) VALUES (?, ?, ?, 1, datetime('now'), ?)`,
      );
      const result = insert.run(channel.id, message.author.id, message.author.username, guild.id);
      ticket = { id: Number(result.lastInsertRowid), channel_id: channel.id, user_id: message.author.id, user_name: message.author.username, open: 1, created_at: new Date().toISOString(), closed_at: null, snoozed_until: null, title: null, close_reason: null, closed_by_staff_id: null, is_nsfw: 0, disabled: 0, added_user_ids: '[]', subscriber_ids: '[]', webhook_id: null, webhook_token: null, parent_ticket_id: null, category: null, guild_id: guild.id };

      try {
        const webhook = await restChannel.createWebhook({ name: 'Modmail Forwarder' });
        this.db.prepare('UPDATE tickets SET webhook_id = ?, webhook_token = ? WHERE channel_id = ?').run(webhook.id, webhook.token, channel.id);
        ticket.webhook_id = webhook.id;
        ticket.webhook_token = webhook.token;
      } catch (e) {
        console.warn('Không thể tạo webhook:', e);
      }

      const alertRole = cfg.alert_role_id ? `<@&${cfg.alert_role_id}>` : null;
      const greeting = cfg.greeting_enabled && cfg.greeting_message ? cfg.greeting_message : null;

      await channel.send({
        embeds: [new EmbedBuilder()
          .setTitle(t('modmail.ticket.new_ticket_title'))
          .setDescription(t('modmail.ticket.new_ticket_desc', { user: String(message.author), id: message.author.id }) + (greeting ? `\n\n${greeting}` : ''))
          .setColor(Colors.Blue)
          .setTimestamp()],
      });

      if (alertRole) {
        await channel.send(alertRole).catch(() => {});
      }
    }

    if (ticket) {
      await this.forwardUserMessageToChannel(ticket, channel, message);
      await this.notifySubscribers(ticket);
    }

    await dmChannel.send(t('modmail.dm.sent')).catch(() => {});
  }

  private async notifySubscribers(ticket: TicketRow): Promise<void> {
    const subscriberIds = parseIds(ticket.subscriber_ids);
    if (!subscriberIds.length) return;

    for (const sid of subscriberIds) {
      try {
        const user = await this.client.users.fetch(sid);
        if (!user) continue;
        const dm = await user.createDM();
        await dm.send(t('modmail.dm.subscriber_notify', { channel: ticket.channel_id, user: ticket.user_name }));
      } catch {}
    }
  }

  private async forwardUserMessageToChannel(ticket: TicketRow, channel: TextChannel, message: Message): Promise<void> {
    const attachmentUrls = [...message.attachments.values()].map(a => a.url);
    const embedAttachments = message.embeds.filter(e => e.data?.type === 'image').map(e => e.url ?? '');
    const stickerUrls = [...message.stickers.values()].map(s => s.url);
    const allUrls = [...attachmentUrls, ...embedAttachments, ...stickerUrls].filter(Boolean);

    const contentParts: string[] = [];
    if (message.content) contentParts.push(message.content);
    for (const url of allUrls) contentParts.push(url);

    const finalContent = contentParts.join('\n') || t('modmail.dm.file_placeholder');

    if (ticket.webhook_id && ticket.webhook_token) {
      try {
        const whClient = new WebhookClient({ id: ticket.webhook_id, token: ticket.webhook_token });
        const whPayload: Parameters<typeof whClient.send>[0] = {
          content: message.content || undefined,
          username: message.author.username,
          avatarURL: message.author.displayAvatarURL(),
        };
        if (allUrls.length) whPayload.files = allUrls.slice(0, 10).map(url => ({ attachment: url }));
        await whClient.send(whPayload);
        this.logMessage(ticket.channel_id, message.author.id, message.author.username, finalContent, JSON.stringify(allUrls), false, false);
        return;
      } catch (e) {
        console.warn('Webhook send failed, fallback to plain text:', e);
      }
    }

    const channelMsg = allUrls.length
      ? `**${message.author.username}:** ${message.content || ''}\n${allUrls.join('\n')}`
      : `**${message.author.username}:** ${message.content}`;

    await channel.send(channelMsg);
    this.logMessage(ticket.channel_id, message.author.id, message.author.username, finalContent, JSON.stringify(allUrls), false, false);
  }

  private getGuildConfig(guildId: string): GuildConfigRow {
    let cfg = this.db.prepare('SELECT * FROM guild_configs WHERE guild_id = ?').get(guildId) as GuildConfigRow | undefined;
    if (!cfg) {
      this.db.prepare('INSERT INTO guild_configs (guild_id) VALUES (?)').run(guildId);
      cfg = this.db.prepare('SELECT * FROM guild_configs WHERE guild_id = ?').get(guildId) as GuildConfigRow;
    }
    return cfg;
  }

  // ─── Reply ───────────────────────────────────────────────────────────────────

  async reply(channel: TextChannel, staff: GuildMember, content: string): Promise<string> {
    const ticket = this.db.prepare('SELECT * FROM tickets WHERE channel_id = ? AND open = 1').get(channel.id) as TicketRow | undefined;
    if (!ticket) return t('modmail.ticket.not_found');

    const user = await this.client.users.fetch(ticket.user_id).catch(() => null);
    if (!user) return t('modmail.ticket.user_not_found');

    try {
      const dm = await user.createDM();
      const embed = new EmbedBuilder()
        .setAuthor({ name: staff.displayName, iconURL: staff.displayAvatarURL() })
        .setDescription(content)
        .setColor(Colors.Green)
        .setTimestamp();
      const dmMsg = await dm.send({ embeds: [embed] });

      const confirmEmbed = new EmbedBuilder()
        .setAuthor({ name: t('modmail.reply.author_confirm', { user: user.username }), iconURL: staff.displayAvatarURL() })
        .setDescription(content)
        .setColor(Colors.Green)
        .setTimestamp()
        .setFooter({ text: `ID: ${dmMsg.id}` });
      await channel.send({ embeds: [confirmEmbed] });

      this.logMessage(ticket.channel_id, staff.id, staff.displayName, content, '[]', true, false);
      return t('modmail.ticket.reply_sent');
    } catch (e) {
      console.warn('Không thể gửi DM:', e);
      return t('modmail.ticket.reply_failed');
    }
  }

  async plainReply(channel: TextChannel, staff: GuildMember, content: string): Promise<string> {
    const ticket = this.db.prepare('SELECT * FROM tickets WHERE channel_id = ? AND open = 1').get(channel.id) as TicketRow | undefined;
    if (!ticket) return t('modmail.ticket.not_found');

    const user = await this.client.users.fetch(ticket.user_id).catch(() => null);
    if (!user) return t('modmail.ticket.user_not_found');

    try {
      const dm = await user.createDM();
      const dmMsg = await dm.send(`**${staff.displayName}:** ${content}`);
      await channel.send(t('modmail.reply.plain_confirm', { user: user.username, content }));
      this.logMessage(ticket.channel_id, staff.id, staff.displayName, content, '[]', true, false);
      return t('modmail.ticket.plain_sent');
    } catch {
      return t('modmail.ticket.plain_failed');
    }
  }

  async anonymousReply(channel: TextChannel, content: string): Promise<string> {
    const ticket = this.db.prepare('SELECT * FROM tickets WHERE channel_id = ? AND open = 1').get(channel.id) as TicketRow | undefined;
    if (!ticket) return t('modmail.ticket.not_found');

    const user = await this.client.users.fetch(ticket.user_id).catch(() => null);
    if (!user) return t('modmail.ticket.user_not_found');

    try {
      const dm = await user.createDM();
      const embed = new EmbedBuilder()
        .setAuthor({ name: t('modmail.reply.anonymous_author') })
        .setDescription(content)
        .setColor(Colors.LightGrey)
        .setTimestamp();
      const dmMsg = await dm.send({ embeds: [embed] });

      const confirmEmbed = new EmbedBuilder()
        .setAuthor({ name: t('modmail.reply.anonymous_confirm', { user: user.username }) })
        .setDescription(content)
        .setColor(Colors.LightGrey)
        .setTimestamp()
        .setFooter({ text: `ID: ${dmMsg.id}` });
      await channel.send({ embeds: [confirmEmbed] });

      this.logMessage(ticket.channel_id, '0', 'Staff (Anonymous)', content, '[]', true, true);
      return t('modmail.ticket.anon_sent');
    } catch {
      return t('modmail.ticket.plain_failed');
    }
  }

  async plainAnonymousReply(channel: TextChannel, content: string): Promise<string> {
    const ticket = this.db.prepare('SELECT * FROM tickets WHERE channel_id = ? AND open = 1').get(channel.id) as TicketRow | undefined;
    if (!ticket) return t('modmail.ticket.not_found');

    const user = await this.client.users.fetch(ticket.user_id).catch(() => null);
    if (!user) return t('modmail.ticket.user_not_found');

    try {
      const dm = await user.createDM();
      await dm.send(t('modmail.reply.anonymous_plain_dm', { content }));
      await channel.send(t('modmail.reply.anonymous_plain_confirm', { user: user.username, content }));
      this.logMessage(ticket.channel_id, '0', 'Staff (Anonymous)', content, '[]', true, true);
      return t('modmail.ticket.anon_plain_sent');
    } catch {
      return t('modmail.ticket.plain_failed');
    }
  }

  async replyWithSnippet(channel: TextChannel, staff: GuildMember, snippetName: string): Promise<string> {
    const snippet = this.db.prepare('SELECT * FROM snippets WHERE guild_id = ? AND name = ?').get(channel.guild.id, snippetName) as SnippetRow | undefined;
    if (!snippet) return t('modmail.snippet.not_found', { name: snippetName });
    return this.reply(channel, staff, snippet.content);
  }

  // ─── Edit / Delete ──────────────────────────────────────────────────────────

  async editReply(channel: TextChannel, messageId: string, newContent: string): Promise<string> {
    const ticket = this.db.prepare('SELECT * FROM tickets WHERE channel_id = ? AND open = 1').get(channel.id) as TicketRow | undefined;
    if (!ticket) return t('modmail.ticket.not_found');

    const user = await this.client.users.fetch(ticket.user_id).catch(() => null);
    if (!user) return t('modmail.ticket.user_not_found');

    try {
      const dm = await user.createDM();
      const msg = await dm.messages.fetch(messageId);
      if (!msg) return t('modmail.ticket.edit_not_found');

      const embed = msg.embeds[0];
      if (!embed) return t('modmail.ticket.edit_no_embed');

      const newEmbed = EmbedBuilder.from(embed).setDescription(newContent).setFooter({ text: t('modmail.note.updated') });
      await msg.edit({ embeds: [newEmbed] });

      this.logMessage(ticket.channel_id, '0', 'System', `Edited message ${messageId}: ${newContent}`, '[]', true, false);
      return t('modmail.ticket.edit_success');
    } catch {
      return t('modmail.ticket.edit_failed');
    }
  }

  async deleteReply(channel: TextChannel, messageId: string): Promise<string> {
    const ticket = this.db.prepare('SELECT * FROM tickets WHERE channel_id = ? AND open = 1').get(channel.id) as TicketRow | undefined;
    if (!ticket) return t('modmail.ticket.not_found');

    const user = await this.client.users.fetch(ticket.user_id).catch(() => null);
    if (!user) return t('modmail.ticket.user_not_found');

    try {
      const dm = await user.createDM();
      const msg = await dm.messages.fetch(messageId).catch(() => null);
      if (msg) await msg.delete();

      this.logMessage(ticket.channel_id, '0', 'System', `Deleted message ${messageId}`, '[]', true, false);
      return t('modmail.ticket.delete_success');
    } catch {
      return t('modmail.ticket.delete_failed');
    }
  }

  // ─── Ticket management ──────────────────────────────────────────────────────

  async setTicketTitle(channel: TextChannel, _staff: GuildMember, title: string): Promise<string> {
    const ticket = this.db.prepare('SELECT * FROM tickets WHERE channel_id = ? AND open = 1').get(channel.id) as TicketRow | undefined;
    if (!ticket) return t('modmail.ticket.not_found');

    this.db.prepare('UPDATE tickets SET title = ? WHERE channel_id = ?').run(title, channel.id);

    await channel.send({
      embeds: [new EmbedBuilder()
        .setTitle(t('modmail.ticket.title_updated'))
        .setDescription(t('modmail.ticket.title_updated_desc', { title }))
        .setColor(Colors.Blue)
        .setTimestamp()],
    });

    return t('modmail.ticket.set_title', { title });
  }

  async addUserToTicket(channel: TextChannel, target: GuildMember): Promise<string> {
    const ticket = this.db.prepare('SELECT * FROM tickets WHERE channel_id = ? AND open = 1').get(channel.id) as TicketRow | undefined;
    if (!ticket) return t('modmail.ticket.not_found');

    const added = parseIds(ticket.added_user_ids);
    if (added.includes(target.id)) return t('modmail.ticket.already_added');

    added.push(target.id);
    this.db.prepare('UPDATE tickets SET added_user_ids = ? WHERE channel_id = ?').run(jsonArray(added), channel.id);

    try {
      await channel.permissionOverwrites.create(target, {
        ViewChannel: true,
        SendMessages: true,
        ReadMessageHistory: true,
      });
    } catch {}

      return t('modmail.ticket.added', { user: String(target) });
  }

  async removeUserFromTicket(channel: TextChannel, target: GuildMember): Promise<string> {
    const ticket = this.db.prepare('SELECT * FROM tickets WHERE channel_id = ? AND open = 1').get(channel.id) as TicketRow | undefined;
    if (!ticket) return t('modmail.ticket.not_found');

    const added = parseIds(ticket.added_user_ids);
    if (!added.includes(target.id)) return t('modmail.ticket.not_added');

    const filtered = added.filter(id => id !== target.id);
    this.db.prepare('UPDATE tickets SET added_user_ids = ? WHERE channel_id = ?').run(jsonArray(filtered), channel.id);

    try {
      await channel.permissionOverwrites.create(target, { ViewChannel: false });
    } catch {}

      return t('modmail.ticket.removed', { user: String(target) });
  }

  async repairTicket(channel: TextChannel): Promise<string> {
    const ticket = this.db.prepare('SELECT * FROM tickets WHERE channel_id = ?').get(channel.id) as TicketRow | undefined;
    if (!ticket) return t('modmail.ticket.not_ticket');

    const fixed: string[] = [];

    if (!ticket.webhook_id || !ticket.webhook_token) {
      try {
        const webhook = await channel.createWebhook({ name: 'Modmail Forwarder' });
        this.db.prepare('UPDATE tickets SET webhook_id = ?, webhook_token = ? WHERE channel_id = ?').run(webhook.id, webhook.token, channel.id);
        fixed.push('webhook');
      } catch (e) {
        console.warn('Không thể tạo webhook repair:', e);
      }
    }

    const guild = channel.guild;
    const member = guild.members.cache.get(ticket.user_id);
    if (member) {
      const existingOverwrite = channel.permissionOverwrites.cache.get(member.id);
      if (!existingOverwrite) {
        try {
          await channel.permissionOverwrites.create(member, {
            ViewChannel: true,
            ReadMessageHistory: true,
          });
          fixed.push('permissions');
        } catch {}
      }
    }

    if (!fixed.length) return t('modmail.ticket.repair_ok');
    return t('modmail.ticket.repaired', { things: fixed.join(', ') });
  }

  getTicketByChannel(channelId: string): TicketRow | undefined {
    return this.db.prepare('SELECT * FROM tickets WHERE channel_id = ?').get(channelId) as TicketRow | undefined;
  }

  // ─── Move ───────────────────────────────────────────────────────────────────

  async moveTicket(channel: TextChannel, categoryId: string): Promise<string> {
    const ticket = this.db.prepare('SELECT * FROM tickets WHERE channel_id = ? AND open = 1').get(channel.id) as TicketRow | undefined;
    if (!ticket) return t('modmail.ticket.not_found');

    try {
      await channel.setParent(categoryId);
      return t('modmail.ticket.move_ok');
    } catch {
      return t('modmail.ticket.move_failed');
    }
  }

  // ─── Close ──────────────────────────────────────────────────────────────────

  async closeTicket(channel: TextChannel, closer: GuildMember, reason: string | null, silent: boolean): Promise<string> {
    const ticket = this.db.prepare('SELECT * FROM tickets WHERE channel_id = ? AND open = 1').get(channel.id) as TicketRow | undefined;
    if (!ticket) return t('modmail.ticket.not_found');

    this.db.prepare('UPDATE tickets SET open = 0, closed_at = datetime(\'now\'), close_reason = ?, closed_by_staff_id = ? WHERE channel_id = ?').run(reason, closer.id, channel.id);

    if (!silent) {
      const user = await this.client.users.fetch(ticket.user_id).catch(() => null);
      if (user) {
        try {
          const dm = await user.createDM();
          await dm.send({
            embeds: [new EmbedBuilder()
              .setTitle(t('modmail.close.user_dm_title'))
              .setDescription(reason ?? t('modmail.close.user_dm_desc'))
              .setColor(Colors.Red)
              .setTimestamp()],
          });
        } catch {}
      }
    }

    await channel.send({
      embeds: [new EmbedBuilder()
        .setTitle(t('modmail.close.title'))
        .addFields(
          { name: t('modmail.close.fields_user'), value: `<@${ticket.user_id}> (\`${ticket.user_id}\`)`, inline: true },
          { name: t('modmail.close.fields_closed_by'), value: closer.toString(), inline: true },
          { name: t('modmail.close.fields_reason'), value: reason ?? t('modmail.block.no_reason'), inline: true },
        )
        .setColor(Colors.Red)
        .setTimestamp()],
    });

    await this.sendTranscriptLog(channel.guild.id, ticket, closer, reason);

    await channel.delete();
    return t('modmail.close.success');
  }

  // ─── Block / Whitelist ──────────────────────────────────────────────────────

  isBlocked(guildId: string, userId: string): boolean {
    return !!this.db.prepare('SELECT 1 FROM blocks WHERE guild_id = ? AND user_id = ?').get(guildId, userId);
  }

  blockUser(guildId: string, userId: string, reason: string | null, staffId: string | null): string {
    if (this.isBlocked(guildId, userId)) return t('modmail.block.already');

    this.db.prepare('INSERT INTO blocks (guild_id, user_id, reason, blocked_at, blocked_by_staff_id) VALUES (?, ?, ?, datetime(\'now\'), ?)').run(guildId, userId, reason, staffId);

    const whitelistEntry = this.db.prepare('SELECT id FROM whitelist WHERE guild_id = ? AND user_id = ?').get(guildId, userId) as WhitelistRow | undefined;
    if (whitelistEntry) this.db.prepare('DELETE FROM whitelist WHERE id = ?').run(whitelistEntry.id);

    return t('modmail.block.blocked', { user: `<@${userId}>` });
  }

  unblockUser(guildId: string, userId: string): string {
    const block = this.db.prepare('SELECT id FROM blocks WHERE guild_id = ? AND user_id = ?').get(guildId, userId) as BlockRow | undefined;
    if (!block) return t('modmail.block.not_blocked');

    this.db.prepare('DELETE FROM blocks WHERE id = ?').run(block.id);
    return t('modmail.block.unblocked', { user: `<@${userId}>` });
  }

  getBlockedUsers(guildId: string): BlockRow[] {
    return this.db.prepare('SELECT * FROM blocks WHERE guild_id = ?').all(guildId) as BlockRow[];
  }

  isWhitelisted(guildId: string, userId: string): boolean {
    return !!this.db.prepare('SELECT 1 FROM whitelist WHERE guild_id = ? AND user_id = ?').get(guildId, userId);
  }

  whitelistUser(guildId: string, userId: string, staffId: string | null): string {
    if (this.isWhitelisted(guildId, userId)) return t('modmail.whitelist.already');

    this.db.prepare('INSERT INTO whitelist (guild_id, user_id, created_at, added_by_staff_id) VALUES (?, ?, datetime(\'now\'), ?)').run(guildId, userId, staffId);

    const block = this.db.prepare('SELECT id FROM blocks WHERE guild_id = ? AND user_id = ?').get(guildId, userId) as BlockRow | undefined;
    if (block) {
      this.db.prepare('DELETE FROM blocks WHERE id = ?').run(block.id);
      return t('modmail.whitelist.whitelisted', { user: `<@${userId}>` });
    }

    return t('modmail.whitelist.whitelisted_no_block', { user: `<@${userId}>` });
  }

  unwhitelistUser(guildId: string, userId: string): string {
    const entry = this.db.prepare('SELECT id FROM whitelist WHERE guild_id = ? AND user_id = ?').get(guildId, userId) as WhitelistRow | undefined;
    if (!entry) return t('modmail.whitelist.not_whitelisted');

    this.db.prepare('DELETE FROM whitelist WHERE id = ?').run(entry.id);
    return t('modmail.whitelist.removed', { user: `<@${userId}>` });
  }

  getWhitelistedUsers(guildId: string): WhitelistRow[] {
    return this.db.prepare('SELECT * FROM whitelist WHERE guild_id = ?').all(guildId) as WhitelistRow[];
  }

  // ─── Contact ────────────────────────────────────────────────────────────────

  async contact(guildId: string, user: User): Promise<string> {
    const guild = this.client.guilds.cache.get(guildId);
    if (!guild) return t('modmail.contact.guild_not_found');

    if (this.isBlocked(guildId, user.id)) return t('modmail.contact.blocked');

    const existing = this.db.prepare('SELECT * FROM tickets WHERE user_id = ? AND open = 1').get(user.id) as TicketRow | undefined;
    if (existing) return t('modmail.contact.existing', { channel: existing.channel_id });

    const restChannel = await guild.channels.create({
        name: `ticket-${user.username}-${user.id.slice(-4)}`.toLowerCase(),
      type: ChannelType.GuildText,
      parent: this.getDefaultCategory(guildId) ?? undefined,
    });

    this.db.prepare('INSERT INTO tickets (channel_id, user_id, user_name, open, created_at, guild_id) VALUES (?, ?, ?, 1, datetime(\'now\'), ?)').run(restChannel.id, user.id, user.username, guildId);

    try {
      const webhook = await restChannel.createWebhook({ name: 'Modmail Forwarder' });
      this.db.prepare('UPDATE tickets SET webhook_id = ?, webhook_token = ? WHERE channel_id = ?').run(webhook.id, webhook.token, restChannel.id);
    } catch {}

    await restChannel.send({
      embeds: [new EmbedBuilder()
        .setTitle(t('modmail.ticket.staff_contact_title'))
        .setDescription(t('modmail.ticket.staff_contact_desc', { user: String(user), id: user.id }))
        .setColor(Colors.Green)
        .setTimestamp()],
    });

    return t('modmail.contact.success', { user: String(user), channel: String(restChannel) });
  }

  async selfContact(guildId: string, staff: GuildMember, target: User): Promise<string> {
    const guild = this.client.guilds.cache.get(guildId);
    if (!guild) return t('modmail.contact.guild_not_found');

    const existing = this.db.prepare('SELECT * FROM tickets WHERE user_id = ? AND open = 1').get(target.id) as TicketRow | undefined;
    if (existing) return t('modmail.contact.existing', { channel: existing.channel_id });

    const restChannel = await guild.channels.create({
        name: `ticket-${target.username}-${target.id.slice(-4)}`.toLowerCase(),
      type: ChannelType.GuildText,
      parent: this.getDefaultCategory(guildId) ?? undefined,
    });

    this.db.prepare('INSERT INTO tickets (channel_id, user_id, user_name, open, created_at, guild_id) VALUES (?, ?, ?, 1, datetime(\'now\'), ?)').run(restChannel.id, target.id, target.username, guildId);

    try {
      const webhook = await restChannel.createWebhook({ name: 'Modmail Forwarder' });
      this.db.prepare('UPDATE tickets SET webhook_id = ?, webhook_token = ? WHERE channel_id = ?').run(webhook.id, webhook.token, restChannel.id);
    } catch {}

    await restChannel.send({
      embeds: [new EmbedBuilder()
        .setTitle(t('modmail.ticket.self_contact_title'))
        .setDescription(t('modmail.ticket.self_contact_desc', { staff: String(staff), user: String(target) }))
        .setColor(Colors.Green)
        .setTimestamp()],
    });

    return t('modmail.contact.self_success', { user: String(target), channel: String(restChannel) });
  }

  // ─── Reopen ──────────────────────────────────────────────────────────────────

  async reopenTicket(guild: Guild, staff: GuildMember, userId: string): Promise<string> {
    const latest = this.db.prepare(
      'SELECT * FROM tickets WHERE user_id = ? AND open = 0 ORDER BY closed_at DESC LIMIT 1',
    ).get(userId) as TicketRow | undefined;

    if (!latest) return t('modmail.ticket.no_old_ticket');

    const existing = this.db.prepare('SELECT * FROM tickets WHERE user_id = ? AND open = 1').get(userId) as TicketRow | undefined;
    if (existing) return t('modmail.contact.existing', { channel: existing.channel_id });

    const restChannel = await guild.channels.create({
      name: `ticket-${latest.user_name}-${userId.slice(-4)}`.toLowerCase(),
      type: ChannelType.GuildText,
      parent: this.getDefaultCategory(guild.id) ?? undefined,
    });

    this.db.prepare(
      'INSERT INTO tickets (channel_id, user_id, user_name, open, created_at, parent_ticket_id, guild_id) VALUES (?, ?, ?, 1, datetime(\'now\'), ?, ?)',
    ).run(restChannel.id, userId, latest.user_name, latest.id, guild.id);

    try {
      const webhook = await restChannel.createWebhook({ name: 'Modmail Forwarder' });
      this.db.prepare('UPDATE tickets SET webhook_id = ?, webhook_token = ? WHERE channel_id = ?').run(webhook.id, webhook.token, restChannel.id);
    } catch {}

    await restChannel.send({
      embeds: [new EmbedBuilder()
        .setTitle(t('modmail.ticket.reopened_title'))
        .setDescription(t('modmail.ticket.reopened_desc', { staff: String(staff), user: `<@${userId}>`, id: userId }))
        .addFields({ name: t('modmail.ticket.reopened_field_old'), value: t('modmail.ticket.reopened_old', { id: latest.id, time: latest.closed_at?.slice(0, 16).replace('T', ' ') ?? '?' }) })
        .setColor(Colors.Green)
        .setTimestamp()],
    });

    return t('modmail.ticket.reopened_success', { user: `<@${userId}>`, channel: String(restChannel) });
  }

  // ─── Notes ───────────────────────────────────────────────────────────────────

  async note(channel: TextChannel, staff: GuildMember, content: string): Promise<string> {
    const ticket = this.db.prepare('SELECT * FROM tickets WHERE channel_id = ?').get(channel.id) as TicketRow | undefined;
    if (!ticket) return t('modmail.ticket.not_ticket');

    await channel.send({
      embeds: [new EmbedBuilder()
        .setAuthor({ name: t('modmail.note.label') + ' — ' + staff.displayName, iconURL: staff.displayAvatarURL() })
        .setDescription(content)
        .setColor(Colors.DarkGrey)
        .setTimestamp()],
    });

      this.logMessage(ticket.channel_id, staff.id, staff.displayName, `[NOTE] ${content}`, '[]', true, false);
    return t('modmail.note.added');
  }

  async persistentNote(channel: TextChannel, staff: GuildMember, content: string): Promise<string> {
    const ticket = this.db.prepare('SELECT * FROM tickets WHERE channel_id = ?').get(channel.id) as TicketRow | undefined;
    if (!ticket) return t('modmail.ticket.not_ticket');

    const existing = this.db.prepare('SELECT * FROM persistent_notes WHERE ticket_channel_id = ?').get(channel.id) as PersistentNoteRow | undefined;

    if (existing) {
      this.db.prepare('UPDATE persistent_notes SET content = ?, updated_at = datetime(\'now\'), last_editor_id = ? WHERE ticket_channel_id = ?').run(content, staff.id, channel.id);
    } else {
      this.db.prepare('INSERT INTO persistent_notes (ticket_channel_id, content, updated_at, last_editor_id) VALUES (?, ?, datetime(\'now\'), ?)').run(channel.id, content, staff.id);
    }

    const msg = await channel.send({
      embeds: [new EmbedBuilder()
        .setAuthor({ name: t('modmail.note.persistent_label') + ' — ' + staff.displayName, iconURL: staff.displayAvatarURL() })
        .setDescription(content)
        .setColor(Colors.DarkGrey)
        .setFooter({ text: t('modmail.note.reply_hint') })
        .setTimestamp()],
    });

    if (!existing) {
      await channel.send(t('modmail.note.persistent_hint'));
    }

    this.logMessage(ticket.channel_id, staff.id, staff.displayName, `[PERSISTENT NOTE] ${content}`, '[]', true, false);
    return t('modmail.note.persistent_added');
  }

  // ─── Snooze ─────────────────────────────────────────────────────────────────

  async snoozeTicket(channel: TextChannel, minutes: number): Promise<string> {
    const ticket = this.db.prepare('SELECT * FROM tickets WHERE channel_id = ? AND open = 1').get(channel.id) as TicketRow | undefined;
    if (!ticket) return t('modmail.ticket.not_found');

    const snoozedUntil = new Date(Date.now() + minutes * 60_000).toISOString();
    this.db.prepare('UPDATE tickets SET snoozed_until = ? WHERE channel_id = ?').run(snoozedUntil, channel.id);

    const unix = Math.floor(new Date(snoozedUntil).getTime() / 1000);
    await channel.send({
      embeds: [new EmbedBuilder()
        .setTitle(t('modmail.snooze.title'))
        .setDescription(t('modmail.snooze.desc', { time: `<t:${unix}:R>` }))
        .setColor(Colors.Orange)
        .setTimestamp()],
    });

    return t('modmail.snooze.success', { time: new Date(snoozedUntil).toISOString().slice(11, 16) + ' UTC' });
  }

  async unsnoozeTicket(channel: TextChannel): Promise<string> {
    const ticket = this.db.prepare('SELECT * FROM tickets WHERE channel_id = ? AND open = 1').get(channel.id) as TicketRow | undefined;
    if (!ticket) return t('modmail.ticket.not_found');

    if (!ticket.snoozed_until) return t('modmail.snooze.not_snoozed');

    this.db.prepare('UPDATE tickets SET snoozed_until = NULL WHERE channel_id = ?').run(channel.id);
    await channel.send(t('modmail.ticket.unsnoozed_channel'));
    return t('modmail.snooze.unsnoozed');
  }

  getSnoozedTickets(guild: Guild): string {
    const snoozed = this.db.prepare('SELECT * FROM tickets WHERE open = 1 AND snoozed_until IS NOT NULL AND snoozed_until > datetime(\'now\')').all() as TicketRow[];
    if (!snoozed.length) return t('modmail.snooze.none');

    const lines = snoozed.map(tk => {
      const remaining = Math.round((new Date(tk.snoozed_until!).getTime() - Date.now()) / 60_000);
      const channel = guild.channels.cache.get(tk.channel_id);
      return t('modmail.snooze.list_item', { channel: channel ? `<#${channel.id}>` : `\`${tk.channel_id}\``, user: tk.user_name, minutes: remaining });
    });

    return lines.join('\n');
  }

  clearSnoozedTickets(): string {
    const result = this.db.prepare('UPDATE tickets SET snoozed_until = NULL WHERE open = 1 AND snoozed_until IS NOT NULL AND snoozed_until > datetime(\'now\')').run();
    return t('modmail.snooze.cleared', { count: result.changes });
  }

  // ─── Notifications ──────────────────────────────────────────────────────────

  toggleNotify(guildId: string, staffId: string, channelId: string): string {
    const existing = this.db.prepare('SELECT id FROM notifications WHERE guild_id = ? AND user_id = ? AND ticket_channel_id = ?').get(guildId, staffId, channelId) as NotificationRow | undefined;

    if (existing) {
      this.db.prepare('DELETE FROM notifications WHERE id = ?').run(existing.id);
      return t('modmail.notify.off');
    }

    this.db.prepare('INSERT INTO notifications (guild_id, user_id, ticket_channel_id) VALUES (?, ?, ?)').run(guildId, staffId, channelId);
    return t('modmail.notify.on');
  }

  // ─── Subscribe ──────────────────────────────────────────────────────────────

  toggleSubscribe(channelId: string, userId: string): string {
    const ticket = this.db.prepare('SELECT * FROM tickets WHERE channel_id = ?').get(channelId) as TicketRow | undefined;
    if (!ticket) return t('modmail.ticket.not_found');

    const subs = parseIds(ticket.subscriber_ids);
    if (subs.includes(userId)) {
      const filtered = subs.filter(id => id !== userId);
      this.db.prepare('UPDATE tickets SET subscriber_ids = ? WHERE channel_id = ?').run(jsonArray(filtered), channelId);
      return t('modmail.subscribe.off');
    }

    subs.push(userId);
    this.db.prepare('UPDATE tickets SET subscriber_ids = ? WHERE channel_id = ?').run(jsonArray(subs), channelId);
    return t('modmail.subscribe.on');
  }

  // ─── NSFW / SFW ─────────────────────────────────────────────────────────────

  async setNsfw(channel: TextChannel): Promise<string> {
    const ticket = this.db.prepare('SELECT * FROM tickets WHERE channel_id = ? AND open = 1').get(channel.id) as TicketRow | undefined;
    if (!ticket) return t('modmail.ticket.not_found');

    this.db.prepare('UPDATE tickets SET is_nsfw = 1 WHERE channel_id = ?').run(channel.id);
    try { await channel.edit({ nsfw: true }); } catch {}
    return t('modmail.nsfw.set');
  }

  async setSfw(channel: TextChannel): Promise<string> {
    const ticket = this.db.prepare('SELECT * FROM tickets WHERE channel_id = ? AND open = 1').get(channel.id) as TicketRow | undefined;
    if (!ticket) return t('modmail.ticket.not_found');

    this.db.prepare('UPDATE tickets SET is_nsfw = 0 WHERE channel_id = ?').run(channel.id);
    try { await channel.edit({ nsfw: false }); } catch {}
    return t('modmail.nsfw.unset');
  }

  // ─── Links ──────────────────────────────────────────────────────────────────

  getMessageLink(guildId: string, channelId: string, messageId: string): string {
    return `https://discord.com/channels/${guildId}/${channelId}/${messageId}`;
  }

  getLogLink(guildId: string, channelId: string): string {
    return `https://discord.com/channels/${guildId}/${channelId}`;
  }

  // ─── Enable / Disable ───────────────────────────────────────────────────────

  isModmailEnabled(guildId: string, userId?: string): string {
    const cfg = this.getGuildConfig(guildId);

    if (!userId) {
      if (cfg.disable_all_tickets === 1) return t('modmail.enable.off_all');
      if (cfg.disable_new_tickets === 1) return t('modmail.enable.off_new');
      return t('modmail.enable.on');
    }

    if (parseIds(cfg.disabled_user_ids).includes(userId)) return t('modmail.enable.user_off');
    return t('modmail.enable.user_on');
  }

  enableModmail(guildId: string, userId?: string): string {
    const cfg = this.getGuildConfig(guildId);

    if (!userId) {
      this.db.prepare('UPDATE guild_configs SET disable_all_tickets = 0, disable_new_tickets = 0 WHERE guild_id = ?').run(guildId);
      return t('modmail.enable.enabled');
    }

    const disabled = parseIds(cfg.disabled_user_ids).filter(id => id !== userId);
    this.db.prepare('UPDATE guild_configs SET disabled_user_ids = ? WHERE guild_id = ?').run(jsonArray(disabled), guildId);
    this.db.prepare('UPDATE tickets SET disabled = 0 WHERE user_id = ? AND open = 1').run(userId);

    return t('modmail.enable.user_enabled', { user: `<@${userId}>` });
  }

  disableModmail(guildId: string, disableNew: boolean, disableAll: boolean, userId?: string): string {
    const cfg = this.getGuildConfig(guildId);

    if (userId) {
      const disabled = parseIds(cfg.disabled_user_ids);
      if (!disabled.includes(userId)) disabled.push(userId);
      this.db.prepare('UPDATE guild_configs SET disabled_user_ids = ? WHERE guild_id = ?').run(jsonArray(disabled), guildId);
      this.db.prepare('UPDATE tickets SET disabled = 1 WHERE user_id = ? AND open = 1').run(userId);
      return t('modmail.enable.user_disabled', { user: `<@${userId}>` });
    }

    if (disableAll) this.db.prepare('UPDATE guild_configs SET disable_all_tickets = 1 WHERE guild_id = ?').run(guildId);
    if (disableNew) this.db.prepare('UPDATE guild_configs SET disable_new_tickets = 1 WHERE guild_id = ?').run(guildId);
    return t('modmail.enable.disabled');
  }

  // ─── Log Channel ────────────────────────────────────────────────────────────

  setLogChannel(guildId: string, channelId: string | null): string {
    if (channelId) {
      this.db.prepare('UPDATE guild_configs SET log_channel_id = ? WHERE guild_id = ?').run(channelId, guildId);
      return t('modmail.log_channel.set', { channel: `<#${channelId}>` });
    }
    this.db.prepare('UPDATE guild_configs SET log_channel_id = NULL WHERE guild_id = ?').run(guildId);
    return t('modmail.log_channel.removed');
  }

  getLogChannel(guildId: string): string | null {
    const cfg = this.getGuildConfig(guildId);
    return cfg.log_channel_id;
  }

  // ─── Default Ticket Category ────────────────────────────────────────────────

  setDefaultCategory(guildId: string, categoryId: string | null): string {
    if (categoryId) {
      this.db.prepare('UPDATE guild_configs SET default_category_id = ? WHERE guild_id = ?').run(categoryId, guildId);
      return t('modmail.default_category.set', { category: `<#${categoryId}>` });
    }
    this.db.prepare('UPDATE guild_configs SET default_category_id = NULL WHERE guild_id = ?').run(guildId);
    return t('modmail.default_category.removed');
  }

  /** Category to place new ticket channels under for this guild, falling back to the legacy single-guild env var. */
  getDefaultCategory(guildId: string): string | null {
    const cfg = this.getGuildConfig(guildId);
    if (cfg.default_category_id) return cfg.default_category_id;
    return config.modmail.categoryId !== '0' ? config.modmail.categoryId : null;
  }

  async sendTranscriptLog(guildId: string, ticket: TicketRow, closer: GuildMember, reason: string | null): Promise<void> {
    const logChannelId = this.getLogChannel(guildId);
    if (!logChannelId) return;

    const guild = this.client.guilds.cache.get(guildId);
    if (!guild) return;

    const logChannel = guild.channels.cache.get(logChannelId) as TextChannel | null;
    if (!logChannel) return;

    const messageCount = (this.db.prepare('SELECT COUNT(*) as count FROM message_logs WHERE ticket_channel_id = ?').get(ticket.channel_id) as { count: number }).count;
    const userMention = `<@${ticket.user_id}>`;
    const duration = ticket.created_at ? Math.round((Date.now() - new Date(ticket.created_at).getTime()) / 3600000) + 'h' : '?';

    const embed = new EmbedBuilder()
      .setTitle(t('modmail.close.log_title'))
      .setColor(Colors.Red)
      .addFields(
        { name: t('modmail.close.fields_user'), value: `${userMention} (\`${ticket.user_id}\`)`, inline: true },
        { name: t('modmail.close.fields_closed_by'), value: closer.toString(), inline: true },
        { name: t('modmail.close.fields_duration'), value: duration, inline: true },
        { name: t('modmail.close.fields_messages'), value: `${messageCount}`, inline: true },
        { name: t('modmail.close.fields_reason'), value: reason || t('modmail.block.no_reason'), inline: false },
      )
      .setTimestamp();

    await logChannel.send({ embeds: [embed] }).catch(() => {});
  }

  // ─── Alert Role ──────────────────────────────────────────────────────────────

  setAlertRole(guildId: string, roleId: string | null): string {
    if (roleId) {
      this.db.prepare('UPDATE guild_configs SET alert_role_id = ? WHERE guild_id = ?').run(roleId, guildId);
      return t('modmail.alert_role.set', { role: `<@&${roleId}>` });
    }
    this.db.prepare('UPDATE guild_configs SET alert_role_id = NULL WHERE guild_id = ?').run(guildId);
    return t('modmail.alert_role.removed');
  }

  getAlertRole(guildId: string): string | null {
    const cfg = this.getGuildConfig(guildId);
    return cfg.alert_role_id;
  }

  // ─── Staff Roles ──────────────────────────────────────────────────────────────

  addStaffRole(guildId: string, roleId: string): string {
    const cfg = this.getGuildConfig(guildId);
    const roles = parseIds(cfg.staff_role_ids);
    if (roles.includes(roleId)) return t('modmail.staff_role.already');
    roles.push(roleId);
    this.db.prepare('UPDATE guild_configs SET staff_role_ids = ? WHERE guild_id = ?').run(jsonArray(roles), guildId);
    return t('modmail.staff_role.added', { role: `<@&${roleId}>` });
  }

  removeStaffRole(guildId: string, roleId: string): string {
    const cfg = this.getGuildConfig(guildId);
    const roles = parseIds(cfg.staff_role_ids).filter(id => id !== roleId);
    if (roles.length === parseIds(cfg.staff_role_ids).length) return t('modmail.staff_role.not_found');
    this.db.prepare('UPDATE guild_configs SET staff_role_ids = ? WHERE guild_id = ?').run(jsonArray(roles), guildId);
    return t('modmail.staff_role.removed', { role: `<@&${roleId}>` });
  }

  getStaffRoles(guildId: string): string[] {
    const cfg = this.getGuildConfig(guildId);
    return parseIds(cfg.staff_role_ids);
  }

  isStaff(guildId: string, member: GuildMember): boolean {
    const cfg = this.getGuildConfig(guildId);
    const roles = parseIds(cfg.staff_role_ids);
    if (!roles.length) return true;
    return member.roles.cache.some(r => roles.includes(r.id));
  }

  // ─── Categories ──────────────────────────────────────────────────────────────

  addCategory(guildId: string, name: string, parentId: string | null): string {
    const cfg = this.getGuildConfig(guildId);
    const cats = JSON.parse(cfg.categories) as { name: string; parentId: string | null }[];
    if (cats.some(c => c.name === name)) return t('modmail.category.exists', { name });
    cats.push({ name, parentId });
    this.db.prepare('UPDATE guild_configs SET categories = ? WHERE guild_id = ?').run(JSON.stringify(cats), guildId);
    return t('modmail.category.added', { name });
  }

  removeCategory(guildId: string, name: string): string {
    const cfg = this.getGuildConfig(guildId);
    const cats = JSON.parse(cfg.categories) as { name: string; parentId: string | null }[];
    const filtered = cats.filter(c => c.name !== name);
    if (filtered.length === cats.length) return t('modmail.category.not_found', { name });
    this.db.prepare('UPDATE guild_configs SET categories = ? WHERE guild_id = ?').run(JSON.stringify(filtered), guildId);
    return t('modmail.category.removed', { name });
  }

  getCategories(guildId: string): { name: string; parentId: string | null }[] {
    const cfg = this.getGuildConfig(guildId);
    return JSON.parse(cfg.categories);
  }

  // ─── Greeting ────────────────────────────────────────────────────────────────

  setGreeting(guildId: string, message: string | null): string {
    if (message) {
      this.db.prepare('UPDATE guild_configs SET greeting_message = ?, greeting_enabled = 1 WHERE guild_id = ?').run(message, guildId);
      return t('modmail.greeting.enabled');
    }
    this.db.prepare('UPDATE guild_configs SET greeting_message = NULL, greeting_enabled = 0 WHERE guild_id = ?').run(guildId);
    return t('modmail.greeting.disabled');
  }

  // ─── Logs ───────────────────────────────────────────────────────────────────

  getLogsByUser(guild: Guild, userId: string): string {
    const tickets = this.db.prepare('SELECT * FROM tickets WHERE user_id = ? ORDER BY created_at DESC').all(userId) as TicketRow[];
    if (!tickets.length) return t('modmail.logs.no_user');

    const lines = tickets.map(tk => {
      const status = tk.open ? t('modmail.logs.status_open') : t('modmail.logs.status_closed');
      const closedBy = tk.closed_by_staff_id ? ` ${t('modmail.logs.by')} <@${tk.closed_by_staff_id}>` : '';
      const reason = tk.close_reason ? t('modmail.logs.reason', { reason: tk.close_reason }) : '';
      const subject = tk.title ? ` **${tk.title}**` : '';
      const created = tk.created_at.slice(0, 16).replace('T', ' ');
      const snoozed = tk.snoozed_until && new Date(tk.snoozed_until) > new Date() ? ' ⏸️' : '';
      return `\`${created}\` ${status}${snoozed}${subject}${closedBy}${reason}`;
    });

    return lines.slice(0, 20).join('\n');
  }

  getLogsClosedBy(guildId: string, staffId: string): string {
    const tickets = this.db.prepare('SELECT * FROM tickets WHERE closed_by_staff_id = ? ORDER BY closed_at DESC').all(staffId) as TicketRow[];
    if (!tickets.length) return t('modmail.logs.no_staff');

    const lines = tickets.map(tk => {
      const closedAt = tk.closed_at ? tk.closed_at.slice(0, 16).replace('T', ' ') : '?';
      return t('modmail.logs.entry', { userId: tk.user_id, reason: tk.close_reason ?? t('modmail.block.no_reason'), closedAt });
    });

    return lines.slice(0, 20).join('\n');
  }

  getLogsByKeyword(guildId: string, keyword: string): string {
    const lower = keyword.toLowerCase();
    const tickets = (this.db.prepare('SELECT * FROM tickets').all() as TicketRow[]).filter(t =>
      (t.close_reason && t.close_reason.toLowerCase().includes(lower)) ||
      (t.title && t.title.toLowerCase().includes(lower)) ||
      t.user_name.toLowerCase().includes(lower),
    ).sort((a, b) => b.created_at.localeCompare(a.created_at));

    if (!tickets.length) return t('modmail.logs.no_keyword', { keyword });

    const lines = tickets.slice(0, 20).map(t =>
      `• <@${t.user_id}> — ${t.user_name} — ${t.created_at.slice(0, 16).replace('T', ' ')}`,
    );
    return lines.join('\n');
  }

  getLogsResponded(channelId: string): string {
    const log = this.db.prepare('SELECT 1 FROM message_logs WHERE ticket_channel_id = ? AND is_staff = 1 LIMIT 1').get(channelId) as MessageLogRow | undefined;
    return log ? t('modmail.logs.responded_yes') : t('modmail.logs.responded_no');
  }

  searchLogs(keyword: string): string {
    const lower = keyword.toLowerCase();
    const logs = (this.db.prepare('SELECT * FROM message_logs').all() as MessageLogRow[])
      .filter(l => l.content.toLowerCase().includes(lower))
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
      .slice(0, 20);

    if (!logs.length) return t('modmail.logs.no_search', { keyword });

    const lines = logs.map(l => {
      const time = l.timestamp.slice(5, 16).replace('T', ' ');
      const content = l.content.length > 100 ? l.content.slice(0, 100) : l.content;
      return `• ${time} — ${l.author_name}: ${content}`;
    });
    return lines.join('\n');
  }

  // ─── Snippets ───────────────────────────────────────────────────────────────

  createSnippet(guildId: string, name: string, content: string): string {
    const existing = this.db.prepare('SELECT id FROM snippets WHERE guild_id = ? AND name = ?').get(guildId, name) as SnippetRow | undefined;

    if (existing) {
      this.db.prepare('UPDATE snippets SET content = ? WHERE id = ?').run(content, existing.id);
      return t('modmail.snippet.updated', { name });
    }

    this.db.prepare('INSERT INTO snippets (guild_id, name, content) VALUES (?, ?, ?)').run(guildId, name, content);
    return t('modmail.snippet.created', { name });
  }

  editSnippet(guildId: string, name: string, newContent: string): string {
    const snippet = this.db.prepare('SELECT id FROM snippets WHERE guild_id = ? AND name = ?').get(guildId, name) as SnippetRow | undefined;
    if (!snippet) return t('modmail.snippet.not_found', { name });

    this.db.prepare('UPDATE snippets SET content = ? WHERE id = ?').run(newContent, snippet.id);
    return t('modmail.snippet.updated', { name });
  }

  deleteSnippet(guildId: string, name: string): string {
    const snippet = this.db.prepare('SELECT id FROM snippets WHERE guild_id = ? AND name = ?').get(guildId, name) as SnippetRow | undefined;
    if (!snippet) return t('modmail.snippet.not_found', { name });

    this.db.prepare('DELETE FROM snippets WHERE id = ?').run(snippet.id);
    return t('modmail.snippet.deleted', { name });
  }

  getSnippetRaw(guildId: string, name: string): string | null {
    const snippet = this.db.prepare('SELECT content FROM snippets WHERE guild_id = ? AND name = ?').get(guildId, name) as SnippetRow | undefined;
    return snippet?.content ?? null;
  }

  getSnippets(guildId: string): SnippetRow[] {
    return this.db.prepare('SELECT * FROM snippets WHERE guild_id = ? ORDER BY name').all(guildId) as SnippetRow[];
  }

  autocompleteSnippets(guildId: string, startsWith?: string): string[] {
    let query = 'SELECT name FROM snippets WHERE guild_id = ?';
    const params: unknown[] = [guildId];

    if (startsWith) {
      query += ' AND name LIKE ?';
      params.push(`${startsWith}%`);
    }

    query += ' ORDER BY name LIMIT 10';
    const rows = this.db.prepare(query).all(...params) as { name: string }[];
    return rows.map(r => r.name);
  }

  // ─── Message logs ───────────────────────────────────────────────────────────

  getMessageLogs(channelId: string, limit = 50): MessageLogRow[] {
    return this.db.prepare('SELECT * FROM message_logs WHERE ticket_channel_id = ? ORDER BY timestamp DESC LIMIT ?').all(channelId, limit) as MessageLogRow[];
  }

  getTicketUserIdByChannel(channelId: string): string | null {
    const ticket = this.db.prepare('SELECT user_id FROM tickets WHERE channel_id = ?').get(channelId) as { user_id: string } | undefined;
    return ticket?.user_id ?? null;
  }

  private logMessage(channelId: string, authorId: string, authorName: string, content: string, attachmentUrls: string, isStaff: boolean, anonymous: boolean): void {
    this.db.prepare(
      'INSERT INTO message_logs (ticket_channel_id, author_id, author_name, content, attachment_urls, is_staff, anonymous, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?, datetime(\'now\'))',
    ).run(channelId, authorId, authorName, content, attachmentUrls, isStaff ? 1 : 0, anonymous ? 1 : 0);
  }
}
