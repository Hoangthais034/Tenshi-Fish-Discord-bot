import { injectable, inject } from 'tsyringe';
import { Client } from 'discord.js';
import { TouchGrassService, type ReminderKey } from './touch-grass.js';
import type { TouchGrassEventRow } from '../database/types.js';
import { buildEventCard } from '../modules/touch-grass.js';
import { t } from '../locales/index.js';

const TICK_MS = 60_000;
const DRAFT_TTL_MINUTES = 20;
const MS_24H = 24 * 60 * 60 * 1000;
const MS_1H = 60 * 60 * 1000;
const MS_15M = 15 * 60 * 1000;

@injectable()
export class TouchGrassSchedulerService {
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    @inject(Client) private readonly client: Client,
    @inject(TouchGrassService) private readonly touchGrass: TouchGrassService,
  ) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick().catch(e => console.error('Touch-grass scheduler error:', e)), TICK_MS);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async tick(): Promise<void> {
    this.touchGrass.pruneOldDrafts(DRAFT_TTL_MINUTES);

    const now = Date.now();
    for (const event of this.touchGrass.getActiveEvents()) {
      const diff = new Date(event.event_at).getTime() - now;

      if (diff <= 0) {
        await this.expireEvent(event);
        continue;
      }

      if (event.reminder_24h && !event.reminder_24h_sent && diff <= MS_24H) await this.sendReminder(event, '24h');
      if (event.reminder_1h && !event.reminder_1h_sent && diff <= MS_1H) await this.sendReminder(event, '1h');
      if (event.reminder_15m && !event.reminder_15m_sent && diff <= MS_15M) await this.sendReminder(event, '15m');
    }
  }

  private async expireEvent(event: TouchGrassEventRow): Promise<void> {
    const updated = this.touchGrass.expire(event.id);
    await this.updateCardMessage(updated);
  }

  private async sendReminder(event: TouchGrassEventRow, key: ReminderKey): Promise<void> {
    this.touchGrass.markReminderSent(event.id, key);

    const goingIds = this.touchGrass.getGoingUserIds(event.id);
    if (!goingIds.length) return;

    const targetId = event.thread_id ?? event.channel_id;
    const channel = await this.client.channels.fetch(targetId).catch(() => null);
    if (!channel || !channel.isSendable()) return;

    await channel.send({
      content: t(`touchgrass.reminder.${key}`, { mentions: goingIds.map(id => `<@${id}>`).join(' '), id: event.public_id, location: event.location }),
      allowedMentions: { users: goingIds },
    }).catch(() => {});
  }

  private async updateCardMessage(event: TouchGrassEventRow): Promise<void> {
    if (!event.message_id) return;
    const channel = await this.client.channels.fetch(event.channel_id).catch(() => null);
    if (!channel || !channel.isSendable()) return;
    const message = await channel.messages.fetch(event.message_id).catch(() => null);
    if (!message) return;

    const { embeds, components } = buildEventCard(event);
    await message.edit({ embeds, components }).catch(() => {});
  }
}
