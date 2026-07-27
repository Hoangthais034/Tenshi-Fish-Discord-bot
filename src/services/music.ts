import { Manager, Structure, type SearchResult, type Player, type Track } from 'erela.js';
import WebSocket from 'ws';
import { Client } from 'discord.js';
import { singleton, inject } from 'tsyringe';
import { config } from '../config.js';

Structure.extend('Node', (NodeClass) => {
  return class NodeLinkNode extends NodeClass {
    private pingInterval: ReturnType<typeof setInterval> | null = null;
    private sessionId: string | null = null;

    constructor(options: any) {
      super(options);
      const origMessage = (this as any).message.bind(this);
      (this as any).message = (d: any) => {
        if (typeof d === 'string' || d instanceof Buffer || d instanceof ArrayBuffer) {
          try {
            const parsed = JSON.parse(d.toString());
            if (parsed?.op === 'ready') {
              if (parsed.sessionId) this.sessionId = parsed.sessionId;
              return;
            }
            if (parsed?.op === 'pong') return;
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

    open() {
      (NodeClass.prototype as any).open.call(this);
      if (this.pingInterval) clearInterval(this.pingInterval);
      this.pingInterval = setInterval(() => {
        if ((this as any).connected) {
          (this as any).send({ op: 'ping' });
        }
      }, 30_000);
    }

    close(code: number, reason: string) {
      if (this.pingInterval) {
        clearInterval(this.pingInterval);
        this.pingInterval = null;
      }
      (NodeClass.prototype as any).close.call(this, code, reason);
    }

    async send(data: any): Promise<boolean> {
      if (!data || !data.op) return false;

      switch (data.op) {
        case 'voiceUpdate':
        case 'play':
        case 'stop':
        case 'pause':
        case 'seek':
        case 'volume':
        case 'destroy':
          console.log(`[REST] sending op=${data.op} guildId=${data.guildId} sessionId=${this.sessionId}`);
          const ok = await this.sendViaRest(data);
          console.log(`[REST] result=${ok}`);
          return ok;
        default:
          return (NodeClass.prototype as any).send.call(this, data);
      }
    }

    private async sendViaRest(data: any): Promise<boolean> {
      if (!this.sessionId) {
        console.warn(`[REST] No sessionId yet, dropping op=${data.op}`);
        return false;
      }
      const guildId = data.guildId;
      if (!guildId) return false;

      const proto = (this as any).options.secure ? 'https' : 'http';
      const base = `${proto}://${(this as any).address}`;
      const headers: Record<string, string> = { Authorization: (this as any).options.password };

      try {
        if (data.op === 'destroy') {
          const url = `${base}/v4/sessions/${this.sessionId}/players/${guildId}`;
          const res = await fetch(url, { method: 'DELETE', headers });
          return res.ok;
        }

        const body: any = {};

        switch (data.op) {
          case 'voiceUpdate': {
            body.voice = {
              sessionId: data.sessionId,
              token: data.event?.token,
              endpoint: data.event?.endpoint,
            };
            break;
          }
          case 'play': {
            body.track = { encoded: data.track };
            if (data.startTime != null) body.position = data.startTime;
            if (data.endTime != null) body.endTime = data.endTime;
            break;
          }
          case 'stop': {
            body.track = { encoded: null };
            break;
          }
          case 'pause': {
            body.paused = data.pause;
            break;
          }
          case 'seek': {
            body.position = data.position;
            break;
          }
          case 'volume': {
            body.volume = data.volume;
            break;
          }
        }

        headers['Content-Type'] = 'application/json';
        const noReplace = data.noReplace ? 'true' : 'false';
        const url = `${base}/v4/sessions/${this.sessionId}/players/${guildId}?noReplace=${noReplace}`;
        const res = await fetch(url, { method: 'PATCH', headers, body: JSON.stringify(body) });
        return res.ok;
      } catch (e) {
        console.error(`[REST] Error op=${data.op} guildId=${guildId}:`, (e as Error).message);
        return false;
      }
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
      console.log(`[makeRequest] calling ${path}`);
      const res = await (NodeClass.prototype as any).makeRequest.call(this, path, modify);
      console.log(`[makeRequest] response loadType=${res?.loadType}, has data=${!!res?.data}`);
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
        if (!guild) {
          console.error(`[Send] Guild not found in cache: ${id}`);
          return;
        }
        const shard = guild.shard;
        if (!shard) {
          console.error(`[Send] Shard not found for guild ${id} (shardId=${guild.shardId})`);
          return;
        }
        console.log(`[Send] Sending op ${payload.op} voice state to guild ${id}`);
        shard.send(payload);
      },
    });

    this.manager.on('nodeConnect', node => {
      console.log(`Lavalink node connected: ${node.options.identifier}`);
    });

    this.manager.on('nodeRaw', (payload: any) => {
      if (payload.op === 'voiceUpdate' || payload.op === 'play' || payload.op === 'destroy') {
        console.log(`[NodeRaw] op=${payload.op} guildId=${payload.guildId} has_session=${!!payload.sessionId} has_event=${!!payload.event}`);
      }
    });

    this.manager.on('nodeError', (node, error) => {
      console.error(`Lavalink node error [${node.options.identifier}]:`, error.message);
    });

    this.manager.on('trackStart', (player, track) => {
      console.log(`Playing: ${track.title}`);
    });

    this.manager.on('trackEnd', (player, track, payload) => {
      console.log(`Track ended: ${track?.title}, reason: ${payload.reason}`);
    });

    this.manager.on('queueEnd', player => {
      console.log(`Queue ended for guild ${player.guild}`);
      player.destroy();
    });

    this.manager.on('playerDestroy', player => {
      console.log(`Player destroyed for guild ${player.guild}`);
    });

    this.manager.on('nodeDisconnect', (node, { code, reason }) => {
      console.log(`Node disconnected: ${node.options.identifier}, code=${code} reason=${reason}`);
    });

    this.manager.on('nodeReconnect', node => {
      console.log(`Node reconnecting: ${node.options.identifier}`);
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
    console.log(`[play] start guild=${guildId} vc=${voiceChannelId} query=${query}`);
    query = this.cleanUrl(query);
    console.log(`[play] cleaned query=${query}`);

    const player = await this.getOrCreatePlayer(guildId, voiceChannelId, textChannelId);
    console.log(`[play] player created/retrieved: ${!!player}`);
    if (!player) return 'Không thể kết nối tới voice channel.';
    console.log(`[play] player state: playing=${player.playing} paused=${player.paused} connected=${player.voiceState?.connected}`);

    let result: SearchResult;
    try {
      console.log(`[play] searching... manager exists: ${!!this.manager}`);
      result = await this.manager.search(query, this.client.user!);
      console.log(`[play] search result loadType=${result?.loadType} tracks=${result?.tracks?.length}`);
    } catch (e) {
      console.error(`[play] search error:`, e);
      return `Lỗi khi tải track: \`${query}\`.`;
    }

    if (result.loadType === 'LOAD_FAILED' || result.exception) {
      console.error(`[play] load failed:`, result.exception?.message);
      return `Lỗi khi tải track: \`${query}\`.`;
    }

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
    try {
      player.queue.add(track);
      console.log(`[play] track added to queue, current=${!!player.queue.current}, playing=${player.playing}, paused=${player.paused}`);
    } catch (e) {
      console.error(`[play] queue.add error:`, e);
      return '❌ Lỗi khi thêm track vào hàng đợi.';
    }

    if (!player.playing && !player.paused) {
      try {
        console.log(`[play] calling player.play()`);
        player.play();
        console.log(`[play] player.play() returned`);
      } catch (e) {
        console.error(`[play] player.play() error:`, e);
        return '❌ Lỗi khi phát nhạc.';
      }
    }

    console.log(`[play] returning success: ${track.title}`);
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

  forwardVoiceEvents(): void {
    console.log('[VoiceEvents] Registering voice event listeners...');
    console.log('[VoiceEvents] client.ws exists:', !!this.client.ws);

    this.client.ws.on('VOICE_STATE_UPDATE', (data: any) => {
      console.log('[VoiceEvents] VOICE_STATE_UPDATE raw keys:', Object.keys(data || {}), 'guild_id:', data?.guild_id, 'channel_id:', data?.channel_id);
      console.log('[VoiceEvents] forwarding VOICE_STATE_UPDATE to manager...');
      this.manager.updateVoiceState({ t: 'VOICE_STATE_UPDATE', d: data });
    });

    this.client.ws.on('VOICE_SERVER_UPDATE', (data: any) => {
      console.log('[VoiceEvents] VOICE_SERVER_UPDATE raw keys:', Object.keys(data || {}), 'endpoint:', data?.endpoint, 'token:', data?.token ? 'present' : 'missing');
      console.log('[VoiceEvents] forwarding VOICE_SERVER_UPDATE to manager...');
      this.manager.updateVoiceState({ t: 'VOICE_SERVER_UPDATE', d: data });
    });
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
