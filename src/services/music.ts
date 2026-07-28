import { LavalinkManager } from 'lavalink-client';
import { Client } from 'discord.js';
import { singleton, inject } from 'tsyringe';
import { config } from '../config.js';

@singleton()
export class MusicService {
  public manager!: LavalinkManager;
  private ready = false;

  constructor(@inject(Client) private readonly client: Client) {}

  init(): void {
    this.manager = new LavalinkManager({
      nodes: [
        {
          host: config.nodelink.host,
          port: config.nodelink.port,
          authorization: config.nodelink.password,
          id: 'nodelink',
        },
      ],
      client: {
        id: this.client.user!.id,
        username: this.client.user!.username,
      },
      sendToShard: (guildId, payload) => {
        const guild = this.client.guilds.cache.get(guildId);
        if (!guild) return;
        guild.shard.send(payload);
      },
      autoSkip: true,
      playerOptions: {
        defaultSearchPlatform: 'ytsearch',
        volumeDecrementer: 1,
        onDisconnect: {
          autoReconnect: true,
          destroyPlayer: false,
        },
        onEmptyQueue: {
          destroyAfterMs: 30_000,
        },
        useUnresolvedData: true,
      },
      queueOptions: {
        maxPreviousTracks: 25,
      },
    });

    this.manager.on('trackStart', (player, track) => {
      if (track) console.log(`Playing: ${track.info.title}`);
    });

    this.manager.on('trackEnd', (player, track, payload) => {
      console.log(`Track ended: ${track?.info?.title}, reason: ${payload.reason}`);
    });

    this.manager.on('queueEnd', player => {
      console.log(`Queue ended for guild ${player.guildId}`);
    });

    this.manager.on('playerCreate', player => {
      console.log(`Player created for guild ${player.guildId}`);
    });

    this.manager.on('playerDestroy', player => {
      console.log(`Player destroyed for guild ${player.guildId}`);
    });

    this.manager.on('nodeConnect', node => {
      console.log(`Lavalink node connected: ${node.id}`);
    });

    this.manager.on('nodeError', (node, error) => {
      console.error(`Lavalink node error [${node.id}]:`, error.message);
    });

    this.manager.on('nodeDisconnect', (node, { code, reason }) => {
      console.log(`Node disconnected: ${node.id}, code=${code} reason=${reason}`);
    });

    this.manager.init({ id: this.client.user!.id, username: this.client.user!.username });
    this.ready = true;
  }

  private getPlayer(guildId: string) {
    return this.manager.getPlayer(guildId);
  }

  private async getOrCreatePlayer(guildId: string, voiceChannelId: string, textChannelId?: string) {
    let player = this.manager.getPlayer(guildId);
    if (player) return player;

    player = this.manager.createPlayer({
      guildId,
      voiceChannelId,
      textChannelId,
      selfDeaf: true,
    });

    return player;
  }

  private formatTime(ms: number): string {
    const totalSec = Math.floor(ms / 1000);
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    if (h > 0) return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }

  private cleanUrl(query: string): string {
    try {
      const url = new URL(query);
      if (!url.hostname.includes('youtube.com') && url.hostname !== 'youtu.be') return query;
      const params = new URLSearchParams(url.search);
      params.delete('si');
      params.delete('feature');
      const clean = params.toString();
      return url.origin + url.pathname + (clean ? `?${clean}` : '');
    } catch {
      return query;
    }
  }

  async play(guildId: string, voiceChannelId: string, query: string, textChannelId?: string): Promise<string> {
    query = this.cleanUrl(query);

    const player = await this.getOrCreatePlayer(guildId, voiceChannelId, textChannelId);
    if (!player) return 'Không thể kết nối tới voice channel.';

    let result;
    try {
      result = await player.search({ query }, this.client.user!);
    } catch (e) {
      console.error('[play] search error:', e);
      return `Lỗi khi tải track: \`${query}\`.`;
    }

    if (result.loadType === 'error' || result.exception) {
      return `Lỗi khi tải track: \`${query}\`.`;
    }

    if (result.loadType === 'empty') {
      return `Không tìm thấy kết quả cho \`${query}\`.`;
    }

    if (result.loadType === 'playlist') {
      const tracks = result.tracks;
      if (!tracks.length) return `Playlist trống: **${result.playlist?.name ?? query}**.`;

      const enqueue = player.queue.current !== null;
      await player.queue.add(tracks);
      if (!player.playing && !player.paused) player.play();

      return enqueue
        ? `Đã thêm playlist **${result.playlist?.name ?? 'Unknown'}** (${tracks.length} bài) vào hàng đợi.`
        : `Đang phát playlist **${result.playlist?.name ?? 'Unknown'}** (${tracks.length} bài).`;
    }

    const track = result.tracks[0];
    if (!track) return `Không tìm thấy kết quả cho \`${query}\`.`;

    const enqueueSingle = player.queue.current !== null;
    await player.queue.add(track);

    if (!player.playing && !player.paused) {
      player.play();
    }

    return enqueueSingle
      ? `Đã thêm vào hàng đợi: **${track.info.title}**`
      : `Đang phát: **${track.info.title}**`;
  }

  async skip(guildId: string): Promise<string> {
    const player = this.getPlayer(guildId);
    if (!player) return 'Bot không ở trong voice channel nào.';
    if (!player.queue.current) return 'Không có bài nào đang phát.';

    await player.skip();
    return 'Đã skip bài hiện tại.';
  }

  async stop(guildId: string): Promise<string> {
    const player = this.getPlayer(guildId);
    if (!player) return 'Bot không ở trong voice channel nào.';

    await player.destroy();
    return 'Đã dừng và rời voice channel.';
  }

  async pause(guildId: string): Promise<string> {
    const player = this.getPlayer(guildId);
    if (!player) return 'Bot không ở trong voice channel nào.';
    if (player.paused) return 'Đã tạm dừng rồi.';

    await player.pause();
    return 'Đã tạm dừng.';
  }

  async resume(guildId: string): Promise<string> {
    const player = this.getPlayer(guildId);
    if (!player) return 'Bot không ở trong voice channel nào.';
    if (!player.paused) return 'Không ở trạng thái tạm dừng.';

    await player.resume();
    return 'Đã tiếp tục phát.';
  }

  async setVolume(guildId: string, volume: number): Promise<string> {
    const player = this.getPlayer(guildId);
    if (!player) return 'Bot không ở trong voice channel nào.';

    volume = Math.max(0, Math.min(200, volume));
    await player.setVolume(volume);
    return `Đã chỉnh volume về ${volume}%.`;
  }

  async shuffle(guildId: string): Promise<string> {
    const player = this.getPlayer(guildId);
    if (!player) return 'Bot không ở trong voice channel nào.';

    await player.queue.shuffle();
    return 'Đã xáo trộn hàng đợi.';
  }

  async setLoop(guildId: string, mode: 'none' | 'track' | 'queue'): Promise<string> {
    const player = this.getPlayer(guildId);
    if (!player) return 'Bot không ở trong voice channel nào.';

    await player.setRepeatMode(mode);
    const label = mode === 'track' ? 'bài hiện tại' : mode === 'queue' ? 'toàn bộ hàng đợi' : 'tắt';
    return `Đã chọn loop chế độ ${label}.`;
  }

  forwardVoiceEvents(): void {
    this.client.ws.on('VOICE_STATE_UPDATE', (data: any) => {
      this.manager.sendRawData({ t: 'VOICE_STATE_UPDATE', d: data });
    });

    this.client.ws.on('VOICE_SERVER_UPDATE', (data: any) => {
      this.manager.sendRawData({ t: 'VOICE_SERVER_UPDATE', d: data });
    });
  }

  async nowPlaying(guildId: string): Promise<string> {
    const player = this.getPlayer(guildId);
    if (!player || !player.queue.current) return 'Không có bài nào đang phát.';

    const track = player.queue.current;
    const position = player.position ?? 0;
    const duration = track.info.duration ?? 0;
    const progress = duration === 0 ? '??:??' : `${this.formatTime(position)}/${this.formatTime(duration)}`;
    const state = player.paused ? '⏸️' : '▶️';

    return `${state} **${track.info.title}** — ${track.info.author}\n\`${progress}\``;
  }

  async getQueue(guildId: string): Promise<string> {
    const player = this.getPlayer(guildId);
    if (!player) return 'Hàng đợi trống.';

    const lines: string[] = [];
    const current = player.queue.current;
    if (current) {
      lines.push(`▶️ **${current.info.title}** — ${current.info.author}`);
    }

    const queue = player.queue;
    if (!queue.tracks.length) return lines.length ? lines.join('\n') : 'Hàng đợi trống.';

    const total = queue.tracks.length;
    const take = Math.min(total, 20);

    for (let i = 0; i < take; i++) {
      const track = queue.tracks[i];
      if (track) lines.push(`  ${i + 1}. ${track.info.title} — ${track.info.author}`);
    }

    if (total > 20) lines.push(`  ... và ${total - 20} bài nữa`);

    return lines.join('\n');
  }
}
