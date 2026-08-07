import { injectable, inject } from 'tsyringe';
import {
  Client,
  type Message,
  type TextChannel,
  type GuildMember,
  type Guild,
  EmbedBuilder,
  Colors,
  ChannelType,
} from 'discord.js';
import { getDb } from '../database/init.js';
import type { HoneypotGuildRow } from '../database/types.js';
import Database from 'better-sqlite3';
import { t } from '../locales/index.js';

type Db = Database.Database;

export type HoneypotAction = 'Disabled' | 'Kick' | 'Ban' | 'Softban';
export type HoneypotExperiment = 'TimeoutFirst' | 'NoDm' | 'NoWarningMsg' | 'RandomChannelName';

export interface TrapChannelInfo {
  channelId: string;
  warningMessageId: string | null;
  triggerCount: number;
}

function parseTrapChannels(raw: string): TrapChannelInfo[] {
  try {
    const parsed = JSON.parse(raw);
    return parsed.map((t: any) => ({
      channelId: String(t.channelId ?? t.ChannelId ?? t.channel_id),
      warningMessageId: t.warningMessageId ?? t.WarningMessageId ?? t.warning_message_id ?? null,
      triggerCount: t.triggerCount ?? t.TriggerCount ?? t.trigger_count ?? 0,
    }));
  } catch {
    return [];
  }
}

function serializeTrapChannels(channels: TrapChannelInfo[]): string {
  return JSON.stringify(channels);
}

function hasExperiment(experiments: number, flag: number): boolean {
  return (experiments & flag) !== 0;
}

const EXPERIMENT_FLAGS: Record<string, number> = {
  TimeoutFirst: 1,
  NoDm: 2,
  NoWarningMsg: 4,
  RandomChannelName: 8,
};

@injectable()
export class HoneypotService {
  private db: Db;

  constructor(@inject(Client) private readonly client: Client) {
    this.db = getDb();
  }

  registerHandlers(): void {
    this.client.on('messageCreate', msg => {
      if (msg.author.bot) return;
      if (msg.channel.type !== ChannelType.GuildText) return;
      this.onMessageReceived(msg).catch(e => console.error('Honeypot handler error:', e));
    });
  }

  getOrCreate(guildId: string): HoneypotGuildRow & { trapChannels: TrapChannelInfo[] } {
    const raw = (this.db.prepare('SELECT * FROM honeypot_guilds WHERE guild_id = ?').get(guildId) ?? null) as HoneypotGuildRow | null;

    if (!raw) {
      this.db.prepare('INSERT INTO honeypot_guilds (guild_id) VALUES (?)').run(guildId);
      const inserted = this.db.prepare('SELECT * FROM honeypot_guilds WHERE guild_id = ?').get(guildId) as HoneypotGuildRow;
      return Object.assign(inserted, { trapChannels: [] as TrapChannelInfo[] });
    }

    return Object.assign(raw, { trapChannels: parseTrapChannels(raw.trap_channels) });
  }

  save(row: HoneypotGuildRow & { trapChannels: TrapChannelInfo[] }): void {
    this.db.prepare(
      'UPDATE honeypot_guilds SET trap_channels = ?, log_channel_id = ?, action = ?, experiments = ?, dm_message = ?, warning_message = ? WHERE guild_id = ?',
    ).run(
      serializeTrapChannels(row.trapChannels),
      row.log_channel_id,
      row.action,
      row.experiments,
      row.dm_message,
      row.warning_message,
      row.guild_id,
    );
  }

  // ─── Message handler ─────────────────────────────────────────────────────

  private async onMessageReceived(message: Message): Promise<void> {
    if (!message.guild) return;
    const channel = message.channel;
    if (!channel.isTextBased() || channel.isDMBased()) return;

    const settings = this.db.prepare('SELECT * FROM honeypot_guilds WHERE guild_id = ?').get(message.guild.id) as HoneypotGuildRow | undefined;
    if (!settings || settings.action === 'Disabled') return;

    const trapChannels = parseTrapChannels(settings.trap_channels);
    const trap = trapChannels.find(t => t.channelId === channel.id);
    if (!trap) return;

    const member = message.member;
    if (!member) return;

    if (this.shouldSkipUser(member)) {
      await this.notifyAdminSkip(channel as TextChannel, member, settings);
      if (!hasExperiment(settings.experiments, EXPERIMENT_FLAGS.NoDm)) {
        await this.notifySkippedDm(member, message.guild.name);
      }
      return;
    }

    try {
      await message.delete();

      if (hasExperiment(settings.experiments, EXPERIMENT_FLAGS.TimeoutFirst)) {
        await this.tryTimeout(member);
      }

      if (settings.action === 'Ban') {
        await message.guild.members.ban(member, { deleteMessageSeconds: 86400, reason: 'Honeypot triggered' });
      } else if (settings.action === 'Softban') {
        await this.softban(message.guild, member);
      } else {
        await member.kick('Honeypot triggered');
      }

      if (!hasExperiment(settings.experiments, EXPERIMENT_FLAGS.NoDm)) {
        await this.trySendDm(member, message.guild.name, settings);
      }

      trap.triggerCount++;

      const updatedRow = this.db.prepare('SELECT * FROM honeypot_guilds WHERE guild_id = ?').get(message.guild.id) as HoneypotGuildRow;
      this.db.prepare('UPDATE honeypot_guilds SET trap_channels = ? WHERE guild_id = ?').run(
        serializeTrapChannels(trapChannels),
        message.guild.id,
      );

      await this.updateWarningMessage(channel as TextChannel, settings, trap);
      await this.logTrigger(channel as TextChannel, member, settings, null);
    } catch (e: any) {
      console.error('Honeypot error:', e);
      await this.logTrigger(channel as TextChannel, member, settings, e.message);
      if (!hasExperiment(settings.experiments, EXPERIMENT_FLAGS.NoDm)) {
        await this.notifyActionFailedDm(member, message.guild.name, settings, e.message);
      }
    }
  }

  private shouldSkipUser(member: GuildMember): boolean {
    if (member.id === member.guild.ownerId) return true;
    return member.permissions.has('Administrator');
  }

  private async notifyAdminSkip(channel: TextChannel, user: GuildMember, settings: HoneypotGuildRow): Promise<void> {
    if (!settings.log_channel_id) return;
    const log = channel.guild.channels.cache.get(settings.log_channel_id) as TextChannel | undefined;
    if (!log) return;

    await log.send({
      embeds: [new EmbedBuilder()
        .setTitle(t('honeypot.skipped_title'))
        .setColor(Colors.Orange)
        .setDescription(t('honeypot.skipped_desc', { user: String(user) }))
        .setTimestamp()],
    });
  }

  private async tryTimeout(user: GuildMember): Promise<void> {
    try {
      await user.timeout(60 * 60 * 1000, 'Honeypot timeout');
    } catch {}
  }

  private async trySendDm(user: GuildMember, guildName: string, settings: HoneypotGuildRow): Promise<void> {
    try {
      const dm = await user.createDM();
      const msg = settings.dm_message ?? `You triggered the honeypot in ${guildName} and have been ${settings.action}.`;
      await dm.send(msg);
    } catch {}
  }

  private async notifySkippedDm(user: GuildMember, guildName: string): Promise<void> {
    try {
      const dm = await user.createDM();
      await dm.send(t('honeypot.dm_skipped', { guild: guildName }));
    } catch {}
  }

  private async notifyActionFailedDm(user: GuildMember, guildName: string, settings: HoneypotGuildRow, reason: string): Promise<void> {
    try {
      const dm = await user.createDM();
      await dm.send(t('honeypot.dm_action_failed', { guild: guildName, action: settings.action, reason }));
    } catch {}
  }

  private async softban(guild: Guild, member: GuildMember): Promise<void> {
    await guild.members.ban(member, { deleteMessageSeconds: 86400, reason: 'Honeypot softban' });
    try {
      await new Promise(r => setTimeout(r, 250));
      await guild.bans.remove(member.id);
    } catch {}
  }

  private async updateWarningMessage(channel: TextChannel, settings: HoneypotGuildRow, trap: TrapChannelInfo): Promise<void> {
    if (hasExperiment(settings.experiments, EXPERIMENT_FLAGS.NoWarningMsg)) return;
    if (!trap.warningMessageId) return;

    try {
      const msg = await channel.messages.fetch(trap.warningMessageId);
      if (msg) {
        const content = settings.warning_message ?? `⚠️ This is a honeypot channel. **${trap.triggerCount}** users have been caught.`;
        await msg.edit(content);
      }
    } catch {}
  }

  private async logTrigger(channel: TextChannel, user: GuildMember, settings: HoneypotGuildRow, error: string | null): Promise<void> {
    if (!settings.log_channel_id) return;
    const log = channel.guild.channels.cache.get(settings.log_channel_id) as TextChannel | undefined;
    if (!log) return;

    const embed = new EmbedBuilder()
      .setTitle(error ? t('honeypot.error_title') : t('honeypot.triggered_title'))
      .setColor(error ? Colors.Orange : Colors.Red)
      .addFields(
        { name: t('honeypot.field_user'), value: `${user} (\`${user.id}\`)`, inline: true },
        { name: t('honeypot.field_action'), value: settings.action, inline: true },
        { name: t('honeypot.field_channel'), value: channel.toString(), inline: true },
      );

    if (error) embed.addFields({ name: t('honeypot.field_error'), value: error });

    embed.setTimestamp();
    await log.send({ embeds: [embed] });
  }

  // ─── Public API ──────────────────────────────────────────────────────────

  async postWarningMessage(channel: TextChannel, settings: HoneypotGuildRow, trap: TrapChannelInfo): Promise<boolean> {
    try {
      const content = settings.warning_message ?? '⚠️ This is a honeypot channel.';
      const msg = await channel.send(content);
      trap.warningMessageId = msg.id;
      this.save(settings as any);
      return true;
    } catch {
      return false;
    }
  }

  getExperimentStatus(experiments: number): string {
    if (experiments === 0) return t('honeypot.no_experiments');

    const list: string[] = [];
    if (hasExperiment(experiments, EXPERIMENT_FLAGS.TimeoutFirst)) list.push('TimeoutFirst');
    if (hasExperiment(experiments, EXPERIMENT_FLAGS.NoDm)) list.push('NoDm');
    if (hasExperiment(experiments, EXPERIMENT_FLAGS.NoWarningMsg)) list.push('NoWarningMsg');
    if (hasExperiment(experiments, EXPERIMENT_FLAGS.RandomChannelName)) list.push('RandomChannelName');
    return list.join(', ');
  }
}
