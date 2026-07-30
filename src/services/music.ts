import { LavalinkManager, type Track } from 'lavalink-client';
import { Client } from 'discord.js';
import { singleton, inject } from 'tsyringe';
import { config } from '../config.js';
import { t } from '../locales/index.js';

export interface MusicResult {
  text: string;
  track?: {
    title: string;
    author: string;
    artworkUrl: string | null;
    uri: string;
  };
}

@singleton()
export class MusicService {
  public manager!: LavalinkManager;
  private ready = false;

  constructor(@inject(Client) private readonly client: Client) {}

  init(): void {
    this.manager = new LavalinkManager({
      nodes: [
        {
          host: config.lavalink.host,
          port: config.lavalink.port,
          authorization: config.lavalink.password,
          id: 'lavalink',
          retryAmount: 20,
          retryDelay: 3000,
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

    this.manager.nodeManager.on('error', (...args) => {
      // prevent crash from unhandled 'error' event on NodeManager
    });

    this.manager.nodeManager.on('connect', (node: any) => {
      console.log(`Lavalink node connected: ${node.id}`);
    });

    this.manager.nodeManager.on('error', (node: any, error: any) => {
      console.error(`Lavalink node error [${node.id}]:`, error?.message ?? error);
    });

    this.manager.nodeManager.on('disconnect', (node: any, { code, reason }: any) => {
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

    await player.connect();

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

  private trackToResult(track: Track): NonNullable<MusicResult['track']> {
    return {
      title: track.info.title,
      author: track.info.author,
      artworkUrl: track.info.artworkUrl,
      uri: track.info.uri,
    };
  }

  async play(guildId: string, voiceChannelId: string, query: string, textChannelId?: string): Promise<MusicResult> {
    query = this.cleanUrl(query);

    const player = await this.getOrCreatePlayer(guildId, voiceChannelId, textChannelId);
    if (!player) return { text: t('music.no_player') };

    let result;
    try {
      result = await player.search({ query }, this.client.user!);
    } catch (e) {
      console.error('[play] search error:', e);
      return { text: t('music.search_error', { query }) };
    }

    if (result.loadType === 'error' || result.exception) {
      return { text: t('music.search_error', { query }) };
    }

    if (result.loadType === 'empty') {
      return { text: t('music.no_results', { query }) };
    }

    if (result.loadType === 'playlist') {
      const tracks = result.tracks;
      if (!tracks.length) return { text: t('music.playlist_empty', { name: result.playlist?.name ?? query }) };

      const enqueue = player.queue.current !== null;
      await player.queue.add(tracks);
      if (!player.playing && !player.paused) player.play();

      const firstTrack = tracks[0];
      return {
        text: enqueue
          ? t('music.playlist_enqueued', { name: result.playlist?.name ?? 'Unknown', count: tracks.length })
          : t('music.playlist_playing', { name: result.playlist?.name ?? 'Unknown', count: tracks.length }),
        track: firstTrack ? this.trackToResult(firstTrack as any) : undefined,
      };
    }

    const track = result.tracks[0];
    if (!track) return { text: t('music.no_results', { query }) };

    const enqueueSingle = player.queue.current !== null;
    await player.queue.add(track);

    if (!player.playing && !player.paused) {
      player.play();
    }

    return {
      text: enqueueSingle
        ? t('music.track_enqueued', { title: track.info.title })
        : t('music.track_playing', { title: track.info.title }),
      track: this.trackToResult(track as any),
    };
  }

  async skip(guildId: string): Promise<MusicResult> {
    const player = this.getPlayer(guildId);
    if (!player) return { text: t('music.no_voice') };
    if (!player.queue.current) return { text: t('music.nothing_playing') };

    await player.skip();
    return { text: t('music.skipped') };
  }

  async stop(guildId: string): Promise<MusicResult> {
    const player = this.getPlayer(guildId);
    if (!player) return { text: t('music.no_voice') };

    await player.destroy();
    return { text: t('music.stopped') };
  }

  async pause(guildId: string): Promise<MusicResult> {
    const player = this.getPlayer(guildId);
    if (!player) return { text: t('music.no_voice') };
    if (player.paused) return { text: t('music.already_paused') };

    await player.pause();
    return { text: t('music.paused') };
  }

  async resume(guildId: string): Promise<MusicResult> {
    const player = this.getPlayer(guildId);
    if (!player) return { text: t('music.no_voice') };
    if (!player.paused) return { text: t('music.not_paused') };

    await player.resume();
    return { text: t('music.resumed') };
  }

  async setVolume(guildId: string, volume: number): Promise<MusicResult> {
    const player = this.getPlayer(guildId);
    if (!player) return { text: t('music.no_voice') };

    volume = Math.max(0, Math.min(200, volume));
    await player.setVolume(volume);
    return { text: t('music.volume_set', { volume }) };
  }

  async shuffle(guildId: string): Promise<MusicResult> {
    const player = this.getPlayer(guildId);
    if (!player) return { text: t('music.no_voice') };

    await player.queue.shuffle();
    return { text: t('music.shuffled') };
  }

  async setLoop(guildId: string, mode: 'off' | 'track' | 'queue'): Promise<MusicResult> {
    const player = this.getPlayer(guildId);
    if (!player) return { text: t('music.no_voice') };

    await player.setRepeatMode(mode);
    const label = mode === 'track' ? t('music.loop_mode_track') : mode === 'queue' ? t('music.loop_mode_queue') : t('music.loop_mode_none');
    return { text: t('music.loop_set', { mode: label }) };
  }

  forwardVoiceEvents(): void {
    this.client.ws.on('VOICE_STATE_UPDATE' as any, (data: any) => {
      this.manager.sendRawData({ t: 'VOICE_STATE_UPDATE', d: data });
    });

    this.client.ws.on('VOICE_SERVER_UPDATE' as any, (data: any) => {
      this.manager.sendRawData({ t: 'VOICE_SERVER_UPDATE', d: data });
    });
  }

  async nowPlaying(guildId: string): Promise<MusicResult> {
    const player = this.getPlayer(guildId);
    if (!player || !player.queue.current) return { text: t('music.nothing_playing') };

    const track = player.queue.current;
    const position = player.position ?? 0;
    const duration = track.info.duration ?? 0;
    const progress = duration === 0 ? '??:??' : `${this.formatTime(position)}/${this.formatTime(duration)}`;
    const state = player.paused ? '⏸️' : '▶️';

    return {
      text: t('music.nowplaying', { state, title: track.info.title, author: track.info.author, progress }),
      track: this.trackToResult(track as any),
    };
  }

  async getQueue(guildId: string): Promise<MusicResult> {
    const player = this.getPlayer(guildId);
    if (!player) return { text: t('music.queue_empty') };

    const lines: string[] = [];
    const current = player.queue.current;
    if (current) {
      lines.push(t('music.queue_current', { title: current.info.title, author: current.info.author }));
    }

    const queue = player.queue;
    if (!queue.tracks.length) return { text: lines.length ? lines.join('\n') : t('music.queue_empty') };

    const total = queue.tracks.length;
    const take = Math.min(total, 20);

    for (let i = 0; i < take; i++) {
      const track = queue.tracks[i];
      if (track) lines.push(`  ${i + 1}. ${track.info.title} — ${track.info.author}`);
    }

    if (total > 20) lines.push(t('music.queue_more', { count: total - 20 }));

    return { text: lines.join('\n') };
  }
}
