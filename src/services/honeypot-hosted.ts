import { injectable, inject } from 'tsyringe';
import { Client, type TextChannel } from 'discord.js';
import { HoneypotService } from './honeypot.js';
import { getDb } from '../database/init.js';
import Database from 'better-sqlite3';

type Db = Database.Database;

const RANDOM_NAMES = [
  'welcome', 'general', 'chat', 'talk', 'lounge',
  'water-cooler', 'random', 'discussion', 'chit-chat',
  'banter', 'gossip', 'hangout', 'meetup', 'coffee-talk',
];

@injectable()
export class HoneypotHostedService {
  private timer: ReturnType<typeof setInterval> | null = null;
  private db: Db;

  constructor(
    @inject(Client) private readonly client: Client,
    @inject(HoneypotService) private readonly honeypot: HoneypotService,
  ) {
    this.db = getDb();
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.randomizeChannelNames(), 60 * 60 * 1000);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async randomizeChannelNames(): Promise<void> {
    const rows = this.db.prepare('SELECT * FROM honeypot_guilds').all() as any[];

    for (const row of rows) {
      const experiments = row.experiments as number;
      if (!(experiments & 8)) continue;

      const guild = this.client.guilds.cache.get(row.guild_id);
      if (!guild) continue;

      try {
        const trapChannels = JSON.parse(row.trap_channels) as any[];
        for (const trap of trapChannels) {
          const channelId = trap.channelId ?? trap.ChannelId;
          const channel = guild.channels.cache.get(channelId) as TextChannel | undefined;
          if (!channel) continue;

          const name = RANDOM_NAMES[Math.floor(Math.random() * RANDOM_NAMES.length)];
          try {
            await channel.setName(name);
          } catch (e) {
            console.warn(`Failed to rename trap channel ${channelId}:`, e);
          }
        }
      } catch {}
    }
  }
}
