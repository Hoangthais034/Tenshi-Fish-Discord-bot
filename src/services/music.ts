import { Manager, Structure, type SearchResult, type Player, type Track } from 'erela.js';
import WebSocket from 'ws';
import { Client } from 'discord.js';
import { singleton, inject } from 'tsyringe';
import { config } from '../config.js';

Structure.extend('Node', (NodeClass) => {
  return class NodeLinkNode extends NodeClass {
    constructor(options: any) {
      super(options);
      const origMessage = (this as any).message.bind(this);
      (this as any).message = (d: any) => {
        if (typeof d === 'string' || d instanceof Buffer || d instanceof ArrayBuffer) {
          try {
            const parsed = JSON.parse(d.toString());
            if (parsed?.op === 'ready') return;
          } catch {}
        }
        origMessage(d);
      };
    }

    connect() {
      if ((this as any).connected) return;
      const headers = {
        Authorization: (this as any).options.password,
        'Num-Shards': String((this as any).manager.options.shards),
        'User-Id': (this as any).manager.options.clientId,
        'Client-Name': (this as any).manager.options.clientName,
      };
      const proto = (this as any).options.secure ? 'wss' : 'ws';
      const url = `${proto}://${(this as any).address}/v4/websocket`;
      (this as any).socket = new WebSocket(url, { headers });
      (this as any).socket.on('open', (this as any).open.bind(this));
      (this as any).socket.on('close', (this as any).close.bind(this));
      (this as any).socket.on('message', (this as any).message.bind(this));
      (this as any).socket.on('error', (this as any).error.bind(this));
    }

    async makeRequest(endpoint: string, modify?: (options: any) => void): Promise<any> {
      let path = endpoint;
      if (path.startsWith('/loadtracks')) {
        path = path.replace('/loadtracks', '/v4/loadtracks');
      } else if (path.startsWith('/decodetracks')) {
        path = path.replace('/decodetracks', '/v4/decodetrack');
      } else if (!path.startsWith('/version')) {
        path = `/v4${path}`;
      }
      const res = await (NodeClass.prototype as any).makeRequest.call(this, path, modify);
      return transformV4ToV3(res);
    }
  };
});

function normalizeTrackV4toV3(t: any): any {
  if (!t) return t;
  return {
    track: t.encoded ?? t.track ?? '',
    info: t.info ?? {},
  };
}

function transformV4ToV3(res: any): any {
  if (!res || typeof res !== 'object' || !res.loadType) return res;

  const { loadType, data } = res;

  switch (loadType) {
    case 'search':
      return {
        loadType: 'SearchResult',
        tracks: Array.isArray(data) ? data.map(normalizeTrackV4toV3) : [],
        playlistInfo: null,
        exception: null,
      };
    case 'track':
      return {
        loadType: 'TrackLoaded',
        tracks: data ? [normalizeTrackV4toV3(data)] : [],
        playlistInfo: null,
        exception: null,
      };
    case 'playlist':
      return {
        loadType: 'PlaylistLoaded',
        tracks: Array.isArray(data?.tracks) ? data.tracks.map(normalizeTrackV4toV3) : [],
        playlistInfo: { name: data?.info?.name ?? 'Unknown', selectedTrack: data?.info?.selectedTrack ?? -1 },
        exception: null,
      };
    case 'empty':
      return { loadType: 'NoMatches', tracks: [], playlistInfo: null, exception: null };
    case 'error':
      return {
        loadType: 'LoadFailed',
        tracks: [],
        playlistInfo: null,
        exception: { message: data?.message ?? 'Unknown error', severity: data?.severity ?? 'COMMON' },
      };
    default:
      return res;
  }
}

@singleton()
export class MusicService {
  public manager!: Manager;
  private ready = false;

  constructor(@inject(Client) private readonly client: Client) {}

  init(): void {
    this.manager = new Manager({
      nodes: [
        {
          host: config.nodelink.host,
          port: config.nodelink.port,
          password: config.nodelink.password,
          secure: config.nodelink.secure,
        },
      ],
      send: (id, payload) => {
        const guild = this.client.guilds.cache.get(id);
        if (guild) guild.shard.send(payload);
      },
    });

    this.manager.on('nodeConnect', node => {
      console.log(`Lavalink node connected: ${node.options.identifier}`);
    });

    this.manager.on('nodeError', (node, error) => {
      console.error(`Lavalink node error [${node.options.identifier}]:`, error.message);
    });

    this.manager.on('trackStart', (player, track) => {
      console.log(`Playing: ${track.title}`);
    });

    this.manager.on('queueEnd', player => {
      player.destroy();
    });

    this.manager.on('playerDestroy', player => {
      console.log(`Player destroyed for guild ${player.guild}`);
    });

    this.manager.init(this.client.user!.id);
    this.ready = true;
  }

  private getPlayer(guildId: string): Player | undefined {
    return this.manager.players.get(guildId);
  }

  private async getOrCreatePlayer(guildId: string, voiceChannelId: string, textChannelId?: string): Promise<Player | undefined> {
    let player = this.manager.players.get(guildId);
    if (player) return player;

    player = this.manager.create({
      guild: guildId,
      voiceChannel: voiceChannelId,
      textChannel: textChannelId ?? '',
    });

    player.connect();

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

    let result: SearchResult;
    try {
      result = await this.manager.search(query, this.client.user!);
    } catch {
      return `Lỗi khi tải track: \`${query}\`.`;
    }

    if (result.loadType === 'LOAD_FAILED' || result.exception)
      return `Lỗi khi tải track: \`${query}\`.`;

    if (result.loadType === 'NO_MATCHES')
      return `Không tìm thấy kết quả cho \`${query}\`.`;

    if (result.loadType === 'PLAYLIST_LOADED') {
      const tracks = result.tracks;
      if (!tracks.length) return `Playlist trống: **${result.playlist?.name ?? query}**.`;

      const enqueue = player.queue.current !== null;
      for (const track of tracks) player.queue.add(track);
      if (!player.playing && !player.paused) player.play();

      return enqueue
        ? `Đã thêm playlist **${result.playlist?.name ?? 'Unknown'}** (${tracks.length} bài) vào hàng đợi.`
        : `Đang phát playlist **${result.playlist?.name ?? 'Unknown'}** (${tracks.length} bài).`;
    }

    const track = result.tracks[0];
    if (!track) return `Không tìm thấy kết quả cho \`${query}\`.`;

    const enqueueSingle = player.queue.current !== null;
    player.queue.add(track);
    if (!player.playing && !player.paused) player.play();

    return enqueueSingle
      ? `Đã thêm vào hàng đợi: **${track.title}**`
      : `Đang phát: **${track.title}**`;
  }

  async skip(guildId: string): Promise<string> {
    const player = this.getPlayer(guildId);
    if (!player) return 'Bot không ở trong voice channel nào.';
    if (!player.queue.current) return 'Không có bài nào đang phát.';

    player.stop();
    return 'Đã skip bài hiện tại.';
  }

  async stop(guildId: string): Promise<string> {
    const player = this.getPlayer(guildId);
    if (!player) return 'Bot không ở trong voice channel nào.';

    player.destroy();
    return 'Đã dừng và rời voice channel.';
  }

  async pause(guildId: string): Promise<string> {
    const player = this.getPlayer(guildId);
    if (!player) return 'Bot không ở trong voice channel nào.';
    if (player.paused) return 'Đã tạm dừng rồi.';

    player.pause(true);
    return 'Đã tạm dừng.';
  }

  async resume(guildId: string): Promise<string> {
    const player = this.getPlayer(guildId);
    if (!player) return 'Bot không ở trong voice channel nào.';
    if (!player.paused) return 'Không ở trạng thái tạm dừng.';

    player.pause(false);
    return 'Đã tiếp tục phát.';
  }

  async setVolume(guildId: string, volume: number): Promise<string> {
    const player = this.getPlayer(guildId);
    if (!player) return 'Bot không ở trong voice channel nào.';

    volume = Math.max(0, Math.min(200, volume));
    player.setVolume(volume);
    return `Đã chỉnh volume về ${volume}%.`;
  }

  async shuffle(guildId: string): Promise<string> {
    const player = this.getPlayer(guildId);
    if (!player) return 'Bot không ở trong voice channel nào.';

    player.queue.shuffle();
    return 'Đã xáo trộn hàng đợi.';
  }

  async setLoop(guildId: string, mode: 'none' | 'track' | 'queue'): Promise<string> {
    const player = this.getPlayer(guildId);
    if (!player) return 'Bot không ở trong voice channel nào.';

    if (mode === 'track') {
      player.setTrackRepeat(true);
    } else if (mode === 'queue') {
      player.setQueueRepeat(true);
    } else {
      player.setTrackRepeat(false);
      player.setQueueRepeat(false);
    }

    const label = mode === 'track' ? 'bài hiện tại' : mode === 'queue' ? 'toàn bộ hàng đợi' : 'tắt';
    return `Đã chọn loop chế độ ${label}.`;
  }

  async nowPlaying(guildId: string): Promise<string> {
    const player = this.getPlayer(guildId);
    if (!player || !player.queue.current) return 'Không có bài nào đang phát.';

    const track = player.queue.current;
    const position = player.position ?? 0;
    const duration = track.duration ?? 0;
    const progress = duration === 0 ? '??:??' : `${this.formatTime(position)}/${this.formatTime(duration)}`;
    const state = player.paused ? '⏸️' : '▶️';

    return `${state} **${track.title}** — ${track.author}\n\`${progress}\``;
  }

  async getQueue(guildId: string): Promise<string> {
    const player = this.getPlayer(guildId);
    if (!player) return 'Hàng đợi trống.';

    const lines: string[] = [];
    const current = player.queue.current;
    if (current) {
      lines.push(`▶️ **${current.title}** — ${current.author}`);
    }

    const queue = player.queue;
    if (!queue.length) return lines.length ? lines.join('\n') : 'Hàng đợi trống.';

    const total = queue.length;
    const take = Math.min(total, 20);

    for (let i = 0; i < take; i++) {
      const track = queue[i];
      if (track) lines.push(`  ${i + 1}. ${track.title} — ${track.author}`);
    }

    if (total > 20) lines.push(`  ... và ${total - 20} bài nữa`);

    return lines.join('\n');
  }
}
