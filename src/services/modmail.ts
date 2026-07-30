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

type Db = Database.Database;

function parseIds(value: string): string[] {
  try { return JSON.parse(value) as string[]; } catch { return []; }
}

function jsonArray(arr: string[]): string {
  return JSON.stringify(arr);
}

@injectable()
export class ModmailService {
  private db: Db;

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

  private async handleIncomingDm(message: Message): Promise<void> {
    const dmChannel = message.channel as DMChannel;

    const guild = this.client.guilds.cache.get(config.modmail.guildId);
    if (!guild) return;

    const cfg = this.getGuildConfig(config.modmail.guildId);
    if (cfg.disable_all_tickets === 1 || parseIds(cfg.disabled_user_ids).includes(message.author.id)) {
      await dmChannel.send('Modmail hiện đang tạm tắt.').catch(() => {});
      return;
    }

    if (this.isBlocked(config.modmail.guildId, message.author.id)) {
      await dmChannel.send('Bạn đã bị chặn khỏi dịch vụ hỗ trợ.').catch(() => {});
      return;
    }

    let ticket = this.db.prepare('SELECT * FROM tickets WHERE user_id = ? AND open = 1').get(message.author.id) as TicketRow | undefined;
    let channel: TextChannel | null = null;

    // ─── DM Commands ──────────────────────────────────────────────────────
    const content = message.content.trim();

    if (content === '!close' || content === '!status') {
      if (!ticket) {
        await dmChannel.send('Bạn không có ticket nào đang mở.').catch(() => {});
        return;
      }

      if (content === '!status') {
        const unix = Math.floor(new Date(ticket.created_at).getTime() / 1000);
        const msg = ticket.snoozed_until && new Date(ticket.snoozed_until) > new Date()
          ? `⏸️ Ticket của bạn đang tạm gác đến <t:${Math.floor(new Date(ticket.snoozed_until).getTime() / 1000)}:R>.`
          : `🟢 Ticket của bạn đang mở (tạo <t:${unix}:R>).`;
        await dmChannel.send(msg).catch(() => {});
        return;
      }

      if (content === '!close') {
        channel = guild.channels.cache.get(ticket.channel_id) as TextChannel | null;
        this.db.prepare('UPDATE tickets SET open = 0, closed_at = datetime(\'now\'), close_reason = ? WHERE channel_id = ?').run('Closed by user via DM', ticket.channel_id);
        if (channel) {
          await channel.send({
            embeds: [new EmbedBuilder()
              .setTitle('Ticket đã đóng bởi người dùng')
              .setDescription(`Người dùng đã yêu cầu đóng ticket từ DM.`)
              .setColor(Colors.Red)
              .setTimestamp()],
          });
          await channel.delete();
        }
        await dmChannel.send('✅ Đã đóng ticket của bạn. Cảm ơn bạn đã liên hệ!').catch(() => {});
        return;
      }
    }

    if (ticket) {
      if (ticket.disabled === 1) {
        await dmChannel.send('Ticket của bạn đã bị tắt nhận tin nhắn.').catch(() => {});
        return;
      }

      if (ticket.snoozed_until && new Date(ticket.snoozed_until) > new Date()) {
        const unix = Math.floor(new Date(ticket.snoozed_until).getTime() / 1000);
        await dmChannel.send(`Ticket của bạn đang tạm gác, vui lòng đợi đến <t:${unix}:R>.`).catch(() => {});
        return;
      }

      channel = guild.channels.cache.get(ticket.channel_id) as TextChannel | null;
    }

    if (!channel) {
      if (cfg.disable_new_tickets === 1) {
        await dmChannel.send('Hiện không thể tạo ticket mới.').catch(() => {});
        return;
      }

      const restChannel = await guild.channels.create({
        name: `ticket-${message.author.username}-${message.author.id.slice(-4)}`.toLowerCase(),
        type: ChannelType.GuildText,
        parent: config.modmail.categoryId !== '0' ? config.modmail.categoryId : undefined,
      });

      channel = restChannel;
      const insert = this.db.prepare(
        `INSERT INTO tickets (channel_id, user_id, user_name, open, created_at) VALUES (?, ?, ?, 1, datetime('now'))`,
      );
      const result = insert.run(channel.id, message.author.id, message.author.username);
      ticket = { id: Number(result.lastInsertRowid), channel_id: channel.id, user_id: message.author.id, user_name: message.author.username, open: 1, created_at: new Date().toISOString(), closed_at: null, snoozed_until: null, title: null, close_reason: null, closed_by_staff_id: null, is_nsfw: 0, disabled: 0, added_user_ids: '[]', subscriber_ids: '[]', webhook_id: null, webhook_token: null, parent_ticket_id: null, category: null };

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
          .setTitle('Modmail mới')
          .setDescription(`Từ ${message.author} (\`${message.author.id}\`)${greeting ? `\n\n${greeting}` : ''}`)
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

    await dmChannel.send('✅ Tin nhắn của bạn đã được gửi đến đội ngũ hỗ trợ.').catch(() => {});
  }

  private async notifySubscribers(ticket: TicketRow): Promise<void> {
    const subscriberIds = parseIds(ticket.subscriber_ids);
    if (!subscriberIds.length) return;

    for (const sid of subscriberIds) {
      try {
        const user = await this.client.users.fetch(sid);
        if (!user) continue;
        const dm = await user.createDM();
        await dm.send(`📩 Tin nhắn mới trong ticket <#${ticket.channel_id}> (người dùng: ${ticket.user_name})`);
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

    const finalContent = contentParts.join('\n') || '(file)';

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
    if (!ticket) return 'Channel này không phải ticket đang mở.';

    const user = await this.client.users.fetch(ticket.user_id).catch(() => null);
    if (!user) return 'Không thể tìm thấy người dùng.';

    try {
      const dm = await user.createDM();
      const embed = new EmbedBuilder()
        .setAuthor({ name: staff.displayName, iconURL: staff.displayAvatarURL() })
        .setDescription(content)
        .setColor(Colors.Green)
        .setTimestamp();
      const dmMsg = await dm.send({ embeds: [embed] });

      const confirmEmbed = new EmbedBuilder()
        .setAuthor({ name: `Bạn → ${user.username}`, iconURL: staff.displayAvatarURL() })
        .setDescription(content)
        .setColor(Colors.Green)
        .setTimestamp()
        .setFooter({ text: `ID: ${dmMsg.id}` });
      await channel.send({ embeds: [confirmEmbed] });

      this.logMessage(ticket.channel_id, staff.id, staff.displayName, content, '[]', true, false);
      return '✅ Đã gửi tin nhắn.';
    } catch (e) {
      console.warn('Không thể gửi DM:', e);
      return '❌ Không thể gửi tin nhắn. Người dùng có thể đã tắt DM hoặc chặn bot.';
    }
  }

  async plainReply(channel: TextChannel, staff: GuildMember, content: string): Promise<string> {
    const ticket = this.db.prepare('SELECT * FROM tickets WHERE channel_id = ? AND open = 1').get(channel.id) as TicketRow | undefined;
    if (!ticket) return 'Channel này không phải ticket đang mở.';

    const user = await this.client.users.fetch(ticket.user_id).catch(() => null);
    if (!user) return 'Không thể tìm thấy người dùng.';

    try {
      const dm = await user.createDM();
      const dmMsg = await dm.send(`**${staff.displayName}:** ${content}`);
      await channel.send(`📨 **Bạn → ${user.username}:** ${content}`);
      this.logMessage(ticket.channel_id, staff.id, staff.displayName, content, '[]', true, false);
      return '✅ Đã gửi tin nhắn dạng text.';
    } catch {
      return '❌ Không thể gửi tin nhắn.';
    }
  }

  async anonymousReply(channel: TextChannel, content: string): Promise<string> {
    const ticket = this.db.prepare('SELECT * FROM tickets WHERE channel_id = ? AND open = 1').get(channel.id) as TicketRow | undefined;
    if (!ticket) return 'Channel này không phải ticket đang mở.';

    const user = await this.client.users.fetch(ticket.user_id).catch(() => null);
    if (!user) return 'Không thể tìm thấy người dùng.';

    try {
      const dm = await user.createDM();
      const embed = new EmbedBuilder()
        .setAuthor({ name: 'Staff (Anonymous)' })
        .setDescription(content)
        .setColor(Colors.LightGrey)
        .setTimestamp();
      const dmMsg = await dm.send({ embeds: [embed] });

      const confirmEmbed = new EmbedBuilder()
        .setAuthor({ name: `Staff (Anonymous) → ${user.username}` })
        .setDescription(content)
        .setColor(Colors.LightGrey)
        .setTimestamp()
        .setFooter({ text: `ID: ${dmMsg.id}` });
      await channel.send({ embeds: [confirmEmbed] });

      this.logMessage(ticket.channel_id, '0', 'Staff (Anonymous)', content, '[]', true, true);
      return '✅ Đã gửi tin nhắn ẩn danh.';
    } catch {
      return '❌ Không thể gửi tin nhắn.';
    }
  }

  async plainAnonymousReply(channel: TextChannel, content: string): Promise<string> {
    const ticket = this.db.prepare('SELECT * FROM tickets WHERE channel_id = ? AND open = 1').get(channel.id) as TicketRow | undefined;
    if (!ticket) return 'Channel này không phải ticket đang mở.';

    const user = await this.client.users.fetch(ticket.user_id).catch(() => null);
    if (!user) return 'Không thể tìm thấy người dùng.';

    try {
      const dm = await user.createDM();
      await dm.send(`**Staff (Anonymous):** ${content}`);
      await channel.send(`📨 **Staff (Anonymous) → ${user.username}:** ${content}`);
      this.logMessage(ticket.channel_id, '0', 'Staff (Anonymous)', content, '[]', true, true);
      return '✅ Đã gửi tin nhắn ẩn danh dạng text.';
    } catch {
      return '❌ Không thể gửi tin nhắn.';
    }
  }

  async replyWithSnippet(channel: TextChannel, staff: GuildMember, snippetName: string): Promise<string> {
    const snippet = this.db.prepare('SELECT * FROM snippets WHERE guild_id = ? AND name = ?').get(channel.guild.id, snippetName) as SnippetRow | undefined;
    if (!snippet) return `Không tìm thấy snippet \`${snippetName}\`.`;
    return this.reply(channel, staff, snippet.content);
  }

  // ─── Edit / Delete ──────────────────────────────────────────────────────────

  async editReply(channel: TextChannel, messageId: string, newContent: string): Promise<string> {
    const ticket = this.db.prepare('SELECT * FROM tickets WHERE channel_id = ? AND open = 1').get(channel.id) as TicketRow | undefined;
    if (!ticket) return 'Channel này không phải ticket đang mở.';

    const user = await this.client.users.fetch(ticket.user_id).catch(() => null);
    if (!user) return 'Không thể tìm thấy người dùng.';

    try {
      const dm = await user.createDM();
      const msg = await dm.messages.fetch(messageId);
      if (!msg) return 'Không tìm thấy tin nhắn với ID này.';

      const embed = msg.embeds[0];
      if (!embed) return 'Tin nhắn không có embed để sửa.';

      const newEmbed = EmbedBuilder.from(embed).setDescription(newContent).setFooter({ text: 'Đã sửa' });
      await msg.edit({ embeds: [newEmbed] });

      this.logMessage(ticket.channel_id, '0', 'System', `Edited message ${messageId}: ${newContent}`, '[]', true, false);
      return '✅ Đã sửa tin nhắn.';
    } catch {
      return '❌ Không thể sửa tin nhắn.';
    }
  }

  async deleteReply(channel: TextChannel, messageId: string): Promise<string> {
    const ticket = this.db.prepare('SELECT * FROM tickets WHERE channel_id = ? AND open = 1').get(channel.id) as TicketRow | undefined;
    if (!ticket) return 'Channel này không phải ticket đang mở.';

    const user = await this.client.users.fetch(ticket.user_id).catch(() => null);
    if (!user) return 'Không thể tìm thấy người dùng.';

    try {
      const dm = await user.createDM();
      const msg = await dm.messages.fetch(messageId).catch(() => null);
      if (msg) await msg.delete();

      this.logMessage(ticket.channel_id, '0', 'System', `Deleted message ${messageId}`, '[]', true, false);
      return '✅ Đã xoá tin nhắn.';
    } catch {
      return '❌ Không thể xoá tin nhắn.';
    }
  }

  // ─── Ticket management ──────────────────────────────────────────────────────

  async setTicketTitle(channel: TextChannel, _staff: GuildMember, title: string): Promise<string> {
    const ticket = this.db.prepare('SELECT * FROM tickets WHERE channel_id = ? AND open = 1').get(channel.id) as TicketRow | undefined;
    if (!ticket) return 'Channel này không phải ticket đang mở.';

    this.db.prepare('UPDATE tickets SET title = ? WHERE channel_id = ?').run(title, channel.id);

    await channel.send({
      embeds: [new EmbedBuilder()
        .setTitle('Tiêu đề đã được cập nhật')
        .setDescription(`"${title}"`)
        .setColor(Colors.Blue)
        .setTimestamp()],
    });

    return `✅ Đã đặt tiêu đề: "${title}"`;
  }

  async addUserToTicket(channel: TextChannel, target: GuildMember): Promise<string> {
    const ticket = this.db.prepare('SELECT * FROM tickets WHERE channel_id = ? AND open = 1').get(channel.id) as TicketRow | undefined;
    if (!ticket) return 'Channel này không phải ticket đang mở.';

    const added = parseIds(ticket.added_user_ids);
    if (added.includes(target.id)) return 'Người dùng này đã được thêm.';

    added.push(target.id);
    this.db.prepare('UPDATE tickets SET added_user_ids = ? WHERE channel_id = ?').run(jsonArray(added), channel.id);

    try {
      await channel.permissionOverwrites.create(target, {
        ViewChannel: true,
        SendMessages: true,
        ReadMessageHistory: true,
      });
    } catch {}

    return `✅ Đã thêm ${target} vào ticket.`;
  }

  async removeUserFromTicket(channel: TextChannel, target: GuildMember): Promise<string> {
    const ticket = this.db.prepare('SELECT * FROM tickets WHERE channel_id = ? AND open = 1').get(channel.id) as TicketRow | undefined;
    if (!ticket) return 'Channel này không phải ticket đang mở.';

    const added = parseIds(ticket.added_user_ids);
    if (!added.includes(target.id)) return 'Người dùng này không có trong ticket.';

    const filtered = added.filter(id => id !== target.id);
    this.db.prepare('UPDATE tickets SET added_user_ids = ? WHERE channel_id = ?').run(jsonArray(filtered), channel.id);

    try {
      await channel.permissionOverwrites.create(target, { ViewChannel: false });
    } catch {}

    return `✅ Đã xoá ${target} khỏi ticket.`;
  }

  async repairTicket(channel: TextChannel): Promise<string> {
    const ticket = this.db.prepare('SELECT * FROM tickets WHERE channel_id = ?').get(channel.id) as TicketRow | undefined;
    if (!ticket) return 'Channel này không phải ticket.';

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

    if (!fixed.length) return '✅ Ticket không cần sửa chữa.';
    return `✅ Đã sửa: ${fixed.join(', ')}.`;
  }

  getTicketByChannel(channelId: string): TicketRow | undefined {
    return this.db.prepare('SELECT * FROM tickets WHERE channel_id = ?').get(channelId) as TicketRow | undefined;
  }

  // ─── Move ───────────────────────────────────────────────────────────────────

  async moveTicket(channel: TextChannel, categoryId: string): Promise<string> {
    const ticket = this.db.prepare('SELECT * FROM tickets WHERE channel_id = ? AND open = 1').get(channel.id) as TicketRow | undefined;
    if (!ticket) return 'Channel này không phải ticket đang mở.';

    try {
      await channel.setParent(categoryId);
      return '✅ Đã di chuyển ticket sang category mới.';
    } catch {
      return '❌ Không thể di chuyển ticket.';
    }
  }

  // ─── Close ──────────────────────────────────────────────────────────────────

  async closeTicket(channel: TextChannel, closer: GuildMember, reason: string | null, silent: boolean): Promise<string> {
    const ticket = this.db.prepare('SELECT * FROM tickets WHERE channel_id = ? AND open = 1').get(channel.id) as TicketRow | undefined;
    if (!ticket) return 'Channel này không phải ticket đang mở.';

    this.db.prepare('UPDATE tickets SET open = 0, closed_at = datetime(\'now\'), close_reason = ?, closed_by_staff_id = ? WHERE channel_id = ?').run(reason, closer.id, channel.id);

    if (!silent) {
      const user = await this.client.users.fetch(ticket.user_id).catch(() => null);
      if (user) {
        try {
          const dm = await user.createDM();
          await dm.send({
            embeds: [new EmbedBuilder()
              .setTitle('Ticket đã đóng')
              .setDescription(reason ?? 'Cảm ơn bạn đã liên hệ.')
              .setColor(Colors.Red)
              .setTimestamp()],
          });
        } catch {}
      }
    }

    await channel.send({
      embeds: [new EmbedBuilder()
        .setTitle('Ticket đã đóng')
        .addFields(
          { name: 'Người dùng', value: `<@${ticket.user_id}> (\`${ticket.user_id}\`)`, inline: true },
          { name: 'Đóng bởi', value: closer.toString(), inline: true },
          { name: 'Lý do', value: reason ?? 'Không có', inline: true },
        )
        .setColor(Colors.Red)
        .setTimestamp()],
    });

    await this.sendTranscriptLog(channel.guild.id, ticket, closer, reason);

    await channel.delete();
    return '✅ Đã đóng ticket.';
  }

  // ─── Block / Whitelist ──────────────────────────────────────────────────────

  isBlocked(guildId: string, userId: string): boolean {
    return !!this.db.prepare('SELECT 1 FROM blocks WHERE guild_id = ? AND user_id = ?').get(guildId, userId);
  }

  blockUser(guildId: string, userId: string, reason: string | null, staffId: string | null): string {
    if (this.isBlocked(guildId, userId)) return 'Người dùng này đã bị chặn rồi.';

    this.db.prepare('INSERT INTO blocks (guild_id, user_id, reason, blocked_at, blocked_by_staff_id) VALUES (?, ?, ?, datetime(\'now\'), ?)').run(guildId, userId, reason, staffId);

    const whitelistEntry = this.db.prepare('SELECT id FROM whitelist WHERE guild_id = ? AND user_id = ?').get(guildId, userId) as WhitelistRow | undefined;
    if (whitelistEntry) this.db.prepare('DELETE FROM whitelist WHERE id = ?').run(whitelistEntry.id);

    return `✅ Đã chặn <@${userId}> khỏi modmail.`;
  }

  unblockUser(guildId: string, userId: string): string {
    const block = this.db.prepare('SELECT id FROM blocks WHERE guild_id = ? AND user_id = ?').get(guildId, userId) as BlockRow | undefined;
    if (!block) return 'Người dùng này không bị chặn.';

    this.db.prepare('DELETE FROM blocks WHERE id = ?').run(block.id);
    return `✅ Đã bỏ chặn <@${userId}>.`;
  }

  getBlockedUsers(guildId: string): BlockRow[] {
    return this.db.prepare('SELECT * FROM blocks WHERE guild_id = ?').all(guildId) as BlockRow[];
  }

  isWhitelisted(guildId: string, userId: string): boolean {
    return !!this.db.prepare('SELECT 1 FROM whitelist WHERE guild_id = ? AND user_id = ?').get(guildId, userId);
  }

  whitelistUser(guildId: string, userId: string, staffId: string | null): string {
    if (this.isWhitelisted(guildId, userId)) return 'Người dùng này đã có trong whitelist.';

    this.db.prepare('INSERT INTO whitelist (guild_id, user_id, created_at, added_by_staff_id) VALUES (?, ?, datetime(\'now\'), ?)').run(guildId, userId, staffId);

    const block = this.db.prepare('SELECT id FROM blocks WHERE guild_id = ? AND user_id = ?').get(guildId, userId) as BlockRow | undefined;
    if (block) {
      this.db.prepare('DELETE FROM blocks WHERE id = ?').run(block.id);
      return `✅ Đã whitelist <@${userId}> và bỏ chặn.`;
    }

    return `✅ Đã whitelist <@${userId}>.`;
  }

  unwhitelistUser(guildId: string, userId: string): string {
    const entry = this.db.prepare('SELECT id FROM whitelist WHERE guild_id = ? AND user_id = ?').get(guildId, userId) as WhitelistRow | undefined;
    if (!entry) return 'Người dùng này không có trong whitelist.';

    this.db.prepare('DELETE FROM whitelist WHERE id = ?').run(entry.id);
    return `✅ Đã xoá <@${userId}> khỏi whitelist.`;
  }

  getWhitelistedUsers(guildId: string): WhitelistRow[] {
    return this.db.prepare('SELECT * FROM whitelist WHERE guild_id = ?').all(guildId) as WhitelistRow[];
  }

  // ─── Contact ────────────────────────────────────────────────────────────────

  async contact(guildId: string, user: User): Promise<string> {
    const guild = this.client.guilds.cache.get(guildId);
    if (!guild) return 'Không tìm thấy guild.';

    if (this.isBlocked(guildId, user.id)) return 'Người dùng này đã bị chặn.';

    const existing = this.db.prepare('SELECT * FROM tickets WHERE user_id = ? AND open = 1').get(user.id) as TicketRow | undefined;
    if (existing) return `Người dùng đã có ticket mở tại <#${existing.channel_id}>.`;

    const restChannel = await guild.channels.create({
        name: `ticket-${user.username}-${user.id.slice(-4)}`.toLowerCase(),
      type: ChannelType.GuildText,
      parent: config.modmail.categoryId !== '0' ? config.modmail.categoryId : undefined,
    });

    this.db.prepare('INSERT INTO tickets (channel_id, user_id, user_name, open, created_at) VALUES (?, ?, ?, 1, datetime(\'now\'))').run(restChannel.id, user.id, user.username);

    try {
      const webhook = await restChannel.createWebhook({ name: 'Modmail Forwarder' });
      this.db.prepare('UPDATE tickets SET webhook_id = ?, webhook_token = ? WHERE channel_id = ?').run(webhook.id, webhook.token, restChannel.id);
    } catch {}

    await restChannel.send({
      embeds: [new EmbedBuilder()
        .setTitle('Ticket được tạo bởi staff')
        .setDescription(`Liên hệ ${user} (\`${user.id}\`)`)
        .setColor(Colors.Green)
        .setTimestamp()],
    });

    return `✅ Đã tạo ticket cho ${user} tại ${restChannel}.`;
  }

  async selfContact(staff: GuildMember, target: User): Promise<string> {
    const guild = this.client.guilds.cache.get(config.modmail.guildId);
    if (!guild) return 'Không tìm thấy guild.';

    const existing = this.db.prepare('SELECT * FROM tickets WHERE user_id = ? AND open = 1').get(target.id) as TicketRow | undefined;
    if (existing) return `Người dùng đã có ticket mở tại <#${existing.channel_id}>.`;

    const restChannel = await guild.channels.create({
        name: `ticket-${target.username}-${target.id.slice(-4)}`.toLowerCase(),
      type: ChannelType.GuildText,
      parent: config.modmail.categoryId !== '0' ? config.modmail.categoryId : undefined,
    });

    this.db.prepare('INSERT INTO tickets (channel_id, user_id, user_name, open, created_at) VALUES (?, ?, ?, 1, datetime(\'now\'))').run(restChannel.id, target.id, target.username);

    try {
      const webhook = await restChannel.createWebhook({ name: 'Modmail Forwarder' });
      this.db.prepare('UPDATE tickets SET webhook_id = ?, webhook_token = ? WHERE channel_id = ?').run(webhook.id, webhook.token, restChannel.id);
    } catch {}

    await restChannel.send({
      embeds: [new EmbedBuilder()
        .setTitle('Staff tự liên hệ')
        .setDescription(`${staff} đã tạo ticket để liên hệ ${target}`)
        .setColor(Colors.Green)
        .setTimestamp()],
    });

    return `✅ Đã tạo ticket cho ${target} tại ${restChannel}.`;
  }

  // ─── Reopen ──────────────────────────────────────────────────────────────────

  async reopenTicket(guild: Guild, staff: GuildMember, userId: string): Promise<string> {
    const latest = this.db.prepare(
      'SELECT * FROM tickets WHERE user_id = ? AND open = 0 ORDER BY closed_at DESC LIMIT 1',
    ).get(userId) as TicketRow | undefined;

    if (!latest) return 'Người dùng này không có ticket cũ.';

    const existing = this.db.prepare('SELECT * FROM tickets WHERE user_id = ? AND open = 1').get(userId) as TicketRow | undefined;
    if (existing) return `Người dùng đã có ticket mở tại <#${existing.channel_id}>.`;

    const restChannel = await guild.channels.create({
      name: `ticket-${latest.user_name}-${userId.slice(-4)}`.toLowerCase(),
      type: ChannelType.GuildText,
      parent: config.modmail.categoryId !== '0' ? config.modmail.categoryId : undefined,
    });

    this.db.prepare(
      'INSERT INTO tickets (channel_id, user_id, user_name, open, created_at, parent_ticket_id) VALUES (?, ?, ?, 1, datetime(\'now\'), ?)',
    ).run(restChannel.id, userId, latest.user_name, latest.id);

    try {
      const webhook = await restChannel.createWebhook({ name: 'Modmail Forwarder' });
      this.db.prepare('UPDATE tickets SET webhook_id = ?, webhook_token = ? WHERE channel_id = ?').run(webhook.id, webhook.token, restChannel.id);
    } catch {}

    await restChannel.send({
      embeds: [new EmbedBuilder()
        .setTitle('Ticket mở lại')
        .setDescription(`Ticket cũ của ${staff} đã được mở lại cho <@${userId}> (\`${userId}\`)`)
        .addFields({ name: 'Ticket cũ', value: `#${latest.id} — đóng lúc ${latest.closed_at?.slice(0, 16).replace('T', ' ') ?? '?'}` })
        .setColor(Colors.Green)
        .setTimestamp()],
    });

    return `✅ Đã mở lại ticket cho <@${userId}> tại ${restChannel}.`;
  }

  // ─── Notes ───────────────────────────────────────────────────────────────────

  async note(channel: TextChannel, staff: GuildMember, content: string): Promise<string> {
    const ticket = this.db.prepare('SELECT * FROM tickets WHERE channel_id = ?').get(channel.id) as TicketRow | undefined;
    if (!ticket) return 'Channel này không phải ticket.';

    await channel.send({
      embeds: [new EmbedBuilder()
        .setAuthor({ name: `📝 Note — ${staff.displayName}`, iconURL: staff.displayAvatarURL() })
        .setDescription(content)
        .setColor(Colors.DarkGrey)
        .setTimestamp()],
    });

      this.logMessage(ticket.channel_id, staff.id, staff.displayName, `[NOTE] ${content}`, '[]', true, false);
    return '✅ Đã thêm note.';
  }

  async persistentNote(channel: TextChannel, staff: GuildMember, content: string): Promise<string> {
    const ticket = this.db.prepare('SELECT * FROM tickets WHERE channel_id = ?').get(channel.id) as TicketRow | undefined;
    if (!ticket) return 'Channel này không phải ticket.';

    const existing = this.db.prepare('SELECT * FROM persistent_notes WHERE ticket_channel_id = ?').get(channel.id) as PersistentNoteRow | undefined;

    if (existing) {
      this.db.prepare('UPDATE persistent_notes SET content = ?, updated_at = datetime(\'now\'), last_editor_id = ? WHERE ticket_channel_id = ?').run(content, staff.id, channel.id);
    } else {
      this.db.prepare('INSERT INTO persistent_notes (ticket_channel_id, content, updated_at, last_editor_id) VALUES (?, ?, datetime(\'now\'), ?)').run(channel.id, content, staff.id);
    }

    const msg = await channel.send({
      embeds: [new EmbedBuilder()
        .setAuthor({ name: `📌 Persistent Note — ${staff.displayName}`, iconURL: staff.displayAvatarURL() })
        .setDescription(content)
        .setColor(Colors.DarkGrey)
        .setFooter({ text: 'Note này sẽ hiển thị lại khi có tin nhắn mới' })
        .setTimestamp()],
    });

    if (!existing) {
      await channel.send('💡 Persistent note đã được ghim. Dùng `/modmail note persistent` để cập nhật.');
    }

    this.logMessage(ticket.channel_id, staff.id, staff.displayName, `[PERSISTENT NOTE] ${content}`, '[]', true, false);
    return '✅ Đã thêm persistent note.';
  }

  // ─── Snooze ─────────────────────────────────────────────────────────────────

  async snoozeTicket(channel: TextChannel, minutes: number): Promise<string> {
    const ticket = this.db.prepare('SELECT * FROM tickets WHERE channel_id = ? AND open = 1').get(channel.id) as TicketRow | undefined;
    if (!ticket) return 'Channel này không phải ticket đang mở.';

    const snoozedUntil = new Date(Date.now() + minutes * 60_000).toISOString();
    this.db.prepare('UPDATE tickets SET snoozed_until = ? WHERE channel_id = ?').run(snoozedUntil, channel.id);

    const unix = Math.floor(new Date(snoozedUntil).getTime() / 1000);
    await channel.send({
      embeds: [new EmbedBuilder()
        .setTitle('Ticket tạm gác')
        .setDescription(`Ticket sẽ tự động mở lại sau <t:${unix}:R>.`)
        .setColor(Colors.Orange)
        .setTimestamp()],
    });

    return `✅ Đã gác ticket đến ${new Date(snoozedUntil).toISOString().slice(11, 16)} UTC.`;
  }

  async unsnoozeTicket(channel: TextChannel): Promise<string> {
    const ticket = this.db.prepare('SELECT * FROM tickets WHERE channel_id = ? AND open = 1').get(channel.id) as TicketRow | undefined;
    if (!ticket) return 'Channel này không phải ticket đang mở.';

    if (!ticket.snoozed_until) return 'Ticket này không đang gác.';

    this.db.prepare('UPDATE tickets SET snoozed_until = NULL WHERE channel_id = ?').run(channel.id);
    await channel.send('✅ Đã mở lại ticket.');
    return '✅ Đã mở lại ticket.';
  }

  getSnoozedTickets(guild: Guild): string {
    const snoozed = this.db.prepare('SELECT * FROM tickets WHERE open = 1 AND snoozed_until IS NOT NULL AND snoozed_until > datetime(\'now\')').all() as TicketRow[];
    if (!snoozed.length) return 'Không có ticket nào đang gác.';

    const lines = snoozed.map(t => {
      const remaining = Math.round((new Date(t.snoozed_until!).getTime() - Date.now()) / 60_000);
      const channel = guild.channels.cache.get(t.channel_id);
      return `• ${channel ? `<#${channel.id}>` : `\`${t.channel_id}\``} — ${t.user_name} — còn ${remaining}ph`;
    });

    return lines.join('\n');
  }

  clearSnoozedTickets(): string {
    const result = this.db.prepare('UPDATE tickets SET snoozed_until = NULL WHERE open = 1 AND snoozed_until IS NOT NULL AND snoozed_until > datetime(\'now\')').run();
    return `✅ Đã xoá gác cho ${result.changes} ticket(s).`;
  }

  // ─── Notifications ──────────────────────────────────────────────────────────

  toggleNotify(guildId: string, staffId: string, channelId: string): string {
    const existing = this.db.prepare('SELECT id FROM notifications WHERE guild_id = ? AND user_id = ? AND ticket_channel_id = ?').get(guildId, staffId, channelId) as NotificationRow | undefined;

    if (existing) {
      this.db.prepare('DELETE FROM notifications WHERE id = ?').run(existing.id);
      return '✅ Đã tắt thông báo cho ticket này.';
    }

    this.db.prepare('INSERT INTO notifications (guild_id, user_id, ticket_channel_id) VALUES (?, ?, ?)').run(guildId, staffId, channelId);
    return '✅ Đã bật thông báo cho ticket này.';
  }

  // ─── Subscribe ──────────────────────────────────────────────────────────────

  toggleSubscribe(channelId: string, userId: string): string {
    const ticket = this.db.prepare('SELECT * FROM tickets WHERE channel_id = ?').get(channelId) as TicketRow | undefined;
    if (!ticket) return 'Không tìm thấy ticket.';

    const subs = parseIds(ticket.subscriber_ids);
    if (subs.includes(userId)) {
      const filtered = subs.filter(id => id !== userId);
      this.db.prepare('UPDATE tickets SET subscriber_ids = ? WHERE channel_id = ?').run(jsonArray(filtered), channelId);
      return '✅ Đã huỷ đăng ký nhận thông báo.';
    }

    subs.push(userId);
    this.db.prepare('UPDATE tickets SET subscriber_ids = ? WHERE channel_id = ?').run(jsonArray(subs), channelId);
    return '✅ Đã đăng ký nhận thông báo khi người dùng trả lời.';
  }

  // ─── NSFW / SFW ─────────────────────────────────────────────────────────────

  async setNsfw(channel: TextChannel): Promise<string> {
    const ticket = this.db.prepare('SELECT * FROM tickets WHERE channel_id = ? AND open = 1').get(channel.id) as TicketRow | undefined;
    if (!ticket) return 'Channel này không phải ticket đang mở.';

    this.db.prepare('UPDATE tickets SET is_nsfw = 1 WHERE channel_id = ?').run(channel.id);
    try { await channel.edit({ nsfw: true }); } catch {}
    return '✅ Đã đánh dấu ticket là NSFW.';
  }

  async setSfw(channel: TextChannel): Promise<string> {
    const ticket = this.db.prepare('SELECT * FROM tickets WHERE channel_id = ? AND open = 1').get(channel.id) as TicketRow | undefined;
    if (!ticket) return 'Channel này không phải ticket đang mở.';

    this.db.prepare('UPDATE tickets SET is_nsfw = 0 WHERE channel_id = ?').run(channel.id);
    try { await channel.edit({ nsfw: false }); } catch {}
    return '✅ Đã đánh dấu ticket là SFW.';
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
      if (cfg.disable_all_tickets === 1) return 'Modmail đang tắt hoàn toàn.';
      if (cfg.disable_new_tickets === 1) return 'Không thể tạo ticket mới.';
      return 'Modmail đang bật.';
    }

    if (parseIds(cfg.disabled_user_ids).includes(userId)) return 'Người dùng này đã bị tắt modmail.';
    return 'Người dùng này có thể dùng modmail.';
  }

  enableModmail(guildId: string, userId?: string): string {
    const cfg = this.getGuildConfig(guildId);

    if (!userId) {
      this.db.prepare('UPDATE guild_configs SET disable_all_tickets = 0, disable_new_tickets = 0 WHERE guild_id = ?').run(guildId);
      return '✅ Đã bật modmail.';
    }

    const disabled = parseIds(cfg.disabled_user_ids).filter(id => id !== userId);
    this.db.prepare('UPDATE guild_configs SET disabled_user_ids = ? WHERE guild_id = ?').run(jsonArray(disabled), guildId);
    this.db.prepare('UPDATE tickets SET disabled = 0 WHERE user_id = ? AND open = 1').run(userId);

    return `✅ Đã bật modmail cho <@${userId}>.`;
  }

  disableModmail(guildId: string, disableNew: boolean, disableAll: boolean, userId?: string): string {
    const cfg = this.getGuildConfig(guildId);

    if (userId) {
      const disabled = parseIds(cfg.disabled_user_ids);
      if (!disabled.includes(userId)) disabled.push(userId);
      this.db.prepare('UPDATE guild_configs SET disabled_user_ids = ? WHERE guild_id = ?').run(jsonArray(disabled), guildId);
      this.db.prepare('UPDATE tickets SET disabled = 1 WHERE user_id = ? AND open = 1').run(userId);
      return `✅ Đã tắt modmail cho <@${userId}>.`;
    }

    if (disableAll) this.db.prepare('UPDATE guild_configs SET disable_all_tickets = 1 WHERE guild_id = ?').run(guildId);
    if (disableNew) this.db.prepare('UPDATE guild_configs SET disable_new_tickets = 1 WHERE guild_id = ?').run(guildId);
    return '✅ Đã tắt modmail.';
  }

  // ─── Log Channel ────────────────────────────────────────────────────────────

  setLogChannel(guildId: string, channelId: string | null): string {
    if (channelId) {
      this.db.prepare('UPDATE guild_configs SET log_channel_id = ? WHERE guild_id = ?').run(channelId, guildId);
      return `✅ Đã set log channel thành <#${channelId}>.`;
    }
    this.db.prepare('UPDATE guild_configs SET log_channel_id = NULL WHERE guild_id = ?').run(guildId);
    return '✅ Đã xoá log channel.';
  }

  getLogChannel(guildId: string): string | null {
    const cfg = this.getGuildConfig(guildId);
    return cfg.log_channel_id;
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
      .setTitle('Ticket Closed')
      .setColor(Colors.Red)
      .addFields(
        { name: 'User', value: `${userMention} (\`${ticket.user_id}\`)`, inline: true },
        { name: 'Closed by', value: closer.toString(), inline: true },
        { name: 'Duration', value: duration, inline: true },
        { name: 'Messages', value: `${messageCount}`, inline: true },
        { name: 'Reason', value: reason || 'None', inline: false },
      )
      .setTimestamp();

    await logChannel.send({ embeds: [embed] }).catch(() => {});
  }

  // ─── Alert Role ──────────────────────────────────────────────────────────────

  setAlertRole(guildId: string, roleId: string | null): string {
    if (roleId) {
      this.db.prepare('UPDATE guild_configs SET alert_role_id = ? WHERE guild_id = ?').run(roleId, guildId);
      return `✅ Đã set alert role thành <@&${roleId}>.`;
    }
    this.db.prepare('UPDATE guild_configs SET alert_role_id = NULL WHERE guild_id = ?').run(guildId);
    return '✅ Đã xoá alert role.';
  }

  getAlertRole(guildId: string): string | null {
    const cfg = this.getGuildConfig(guildId);
    return cfg.alert_role_id;
  }

  // ─── Staff Roles ──────────────────────────────────────────────────────────────

  addStaffRole(guildId: string, roleId: string): string {
    const cfg = this.getGuildConfig(guildId);
    const roles = parseIds(cfg.staff_role_ids);
    if (roles.includes(roleId)) return 'Role này đã có trong danh sách.';
    roles.push(roleId);
    this.db.prepare('UPDATE guild_configs SET staff_role_ids = ? WHERE guild_id = ?').run(jsonArray(roles), guildId);
    return `✅ Đã thêm <@&${roleId}> vào staff roles.`;
  }

  removeStaffRole(guildId: string, roleId: string): string {
    const cfg = this.getGuildConfig(guildId);
    const roles = parseIds(cfg.staff_role_ids).filter(id => id !== roleId);
    if (roles.length === parseIds(cfg.staff_role_ids).length) return 'Role này không có trong danh sách.';
    this.db.prepare('UPDATE guild_configs SET staff_role_ids = ? WHERE guild_id = ?').run(jsonArray(roles), guildId);
    return `✅ Đã xoá <@&${roleId}> khỏi staff roles.`;
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
    if (cats.some(c => c.name === name)) return `Category \`${name}\` đã tồn tại.`;
    cats.push({ name, parentId });
    this.db.prepare('UPDATE guild_configs SET categories = ? WHERE guild_id = ?').run(JSON.stringify(cats), guildId);
    return `✅ Đã thêm category \`${name}\`.`;
  }

  removeCategory(guildId: string, name: string): string {
    const cfg = this.getGuildConfig(guildId);
    const cats = JSON.parse(cfg.categories) as { name: string; parentId: string | null }[];
    const filtered = cats.filter(c => c.name !== name);
    if (filtered.length === cats.length) return `Không tìm thấy category \`${name}\`.`;
    this.db.prepare('UPDATE guild_configs SET categories = ? WHERE guild_id = ?').run(JSON.stringify(filtered), guildId);
    return `✅ Đã xoá category \`${name}\`.`;
  }

  getCategories(guildId: string): { name: string; parentId: string | null }[] {
    const cfg = this.getGuildConfig(guildId);
    return JSON.parse(cfg.categories);
  }

  // ─── Greeting ────────────────────────────────────────────────────────────────

  setGreeting(guildId: string, message: string | null): string {
    if (message) {
      this.db.prepare('UPDATE guild_configs SET greeting_message = ?, greeting_enabled = 1 WHERE guild_id = ?').run(message, guildId);
      return '✅ Đã bật greeting message.';
    }
    this.db.prepare('UPDATE guild_configs SET greeting_message = NULL, greeting_enabled = 0 WHERE guild_id = ?').run(guildId);
    return '✅ Đã tắt greeting message.';
  }

  // ─── Logs ───────────────────────────────────────────────────────────────────

  getLogsByUser(guild: Guild, userId: string): string {
    const tickets = this.db.prepare('SELECT * FROM tickets WHERE user_id = ? ORDER BY created_at DESC').all(userId) as TicketRow[];
    if (!tickets.length) return 'Người dùng này chưa có ticket nào.';

    const lines = tickets.map(t => {
      const status = t.open ? '🟢 Đang mở' : '🔴 Đã đóng';
      const closedBy = t.closed_by_staff_id ? ` bởi <@${t.closed_by_staff_id}>` : '';
      const reason = t.close_reason ? ` — ${t.close_reason}` : '';
      const subject = t.title ? ` **${t.title}**` : '';
      const created = t.created_at.slice(0, 16).replace('T', ' ');
      const snoozed = t.snoozed_until && new Date(t.snoozed_until) > new Date() ? ' ⏸️' : '';
      return `\`${created}\` ${status}${snoozed}${subject}${closedBy}${reason}`;
    });

    return lines.slice(0, 20).join('\n');
  }

  getLogsClosedBy(guildId: string, staffId: string): string {
    const tickets = this.db.prepare('SELECT * FROM tickets WHERE closed_by_staff_id = ? ORDER BY closed_at DESC').all(staffId) as TicketRow[];
    if (!tickets.length) return 'Staff này chưa đóng ticket nào.';

    const lines = tickets.map(t => {
      const closedAt = t.closed_at ? t.closed_at.slice(0, 16).replace('T', ' ') : '?';
      return `• <@${t.user_id}> — ${t.close_reason ?? 'Không có lý do'} — ${closedAt}`;
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

    if (!tickets.length) return `Không tìm thấy ticket nào với từ khoá "${keyword}".`;

    const lines = tickets.slice(0, 20).map(t =>
      `• <@${t.user_id}> — ${t.user_name} — ${t.created_at.slice(0, 16).replace('T', ' ')}`,
    );
    return lines.join('\n');
  }

  getLogsResponded(channelId: string): string {
    const log = this.db.prepare('SELECT 1 FROM message_logs WHERE ticket_channel_id = ? AND is_staff = 1 LIMIT 1').get(channelId) as MessageLogRow | undefined;
    return log ? '✅ Staff đã trả lời trong ticket này.' : '❌ Chưa có staff nào trả lời.';
  }

  searchLogs(keyword: string): string {
    const lower = keyword.toLowerCase();
    const logs = (this.db.prepare('SELECT * FROM message_logs').all() as MessageLogRow[])
      .filter(l => l.content.toLowerCase().includes(lower))
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
      .slice(0, 20);

    if (!logs.length) return `Không tìm thấy log nào với từ khoá "${keyword}".`;

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
      return `✅ Đã cập nhật snippet \`${name}\`.`;
    }

    this.db.prepare('INSERT INTO snippets (guild_id, name, content) VALUES (?, ?, ?)').run(guildId, name, content);
    return `✅ Đã tạo snippet \`${name}\`.`;
  }

  editSnippet(guildId: string, name: string, newContent: string): string {
    const snippet = this.db.prepare('SELECT id FROM snippets WHERE guild_id = ? AND name = ?').get(guildId, name) as SnippetRow | undefined;
    if (!snippet) return `Không tìm thấy snippet \`${name}\`.`;

    this.db.prepare('UPDATE snippets SET content = ? WHERE id = ?').run(newContent, snippet.id);
    return `✅ Đã cập nhật snippet \`${name}\`.`;
  }

  deleteSnippet(guildId: string, name: string): string {
    const snippet = this.db.prepare('SELECT id FROM snippets WHERE guild_id = ? AND name = ?').get(guildId, name) as SnippetRow | undefined;
    if (!snippet) return `Không tìm thấy snippet \`${name}\`.`;

    this.db.prepare('DELETE FROM snippets WHERE id = ?').run(snippet.id);
    return `✅ Đã xoá snippet \`${name}\`.`;
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
