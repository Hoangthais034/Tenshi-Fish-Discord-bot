# PLAN.md — Kế hoạch port Music + Honeypot + Modmail sang C# (Discord.Net)

## 0. Bối cảnh / ràng buộc cứng

- **.NET 6**, C# 10 (không primary constructors, không collection expressions)
- **Discord.Net 3.13.0** (interaction framework, slash commands)
- Music: **Lavalink4NET 4.0.0** (cần Lavalink server riêng)
- Storage: **LiteDB 5.0.21**
- `MusicModule` + `MusicService` tạm disable, chờ Phase 2

## 1. Feature Matrix

Xem `docs/FEATURE_MATRIX.md` — đã có so sánh chi tiết từ 3 repo gốc.

## 2. Trạng thái hiện tại

| Phase | Tính năng | Trạng thái |
|-------|-----------|------------|
| 1 | Modmail core (reply/close/block/logs) | ✅ Done |
| 2 | Music (Lavalink play/skip/stop/queue/pause/resume/np/volume/shuffle/loop) | 🔜 Lên kế hoạch |
| 3 | Honeypot | ⏸️ |
| 4 | Hardening chung | ⏸️ |

## 3. Phase 2 — Music (kế hoạch chi tiết)

### API Lavalink4NET 4.0.0 đã khảo sát

```
IPlayerManager:
  JoinAsync(guildId, voiceChannelId, PlayerFactory, options, ct) → ILavalinkPlayer
  GetPlayerAsync<TPlayer>(guildId) → TPlayer?
  Extension: JoinAsync(playerManager, voiceChannel, PlayerFactory)

QueuedLavalinkPlayer:
  PlayAsync(LavalinkTrack track, enqueue, properties, ct)
  PlayAsync(string identifier, enqueue, properties, ct)
  SkipAsync(count, ct)
  StopAsync(ct)
  PauseAsync(ct) / ResumeAsync(ct)          (từ base LavalinkPlayer)
  SetVolumeAsync(float volume, ct)
  DisconnectAsync(ct)
  CurrentItem → ITrackQueueItem
  CurrentTrack → LavalinkTrack              (từ base)
  Queue → ITrackQueue
  RepeatMode (get/set)                      (TrackRepeatMode: None/Queue/Track)
  Shuffle (get/set)
  Volume, IsPaused, State, Position

ITrackQueue:
  ShuffleAsync(ct)
  TryDequeueAsync(mode, ct)
  InsertAsync(index, item, ct)
  History

QueuedLavalinkPlayerOptions:
  ClearQueueOnStop, DisconnectOnStop, DisconnectOnDestroy, SelfDeaf, SelfMute
  InitialVolume, DefaultTrackRepeatMode, InitialTrack

PlayerFactory:
  PlayerFactory.Create<QueuedLavalinkPlayer, QueuedLavalinkPlayerOptions>()
  PlayerFactory.Default<QueuedLavalinkPlayer, QueuedLavalinkPlayerOptions>
```

### Danh sách command Phase 2 (10 slash commands)

| # | Command | Mô tả | Ghi chú |
|---|---------|-------|---------|
| 1 | `/play <query>` | Join voice → search YouTube → play / enqueue | input là search term hoặc URL |
| 2 | `/skip` | Skip bài hiện tại | skip 1 track |
| 3 | `/stop` | Clear queue + stop + disconnect | |
| 4 | `/queue` | Xem hàng đợi (tối đa 20 track) | |
| 5 | `/pause` | Tạm dừng | |
| 6 | `/resume` | Tiếp tục | |
| 7 | `/nowplaying` | Bài đang phát + tiến trình | progress bar |
| 8 | `/volume <0-200>` | Chỉnh volume | |
| 9 | `/shuffle` | Bật/tắt shuffle | |
| 10 | `/loop <mode>` | Chọn loop mode: None / Queue / Track | |

### Files cần sửa / tạo

| File | Action | Mô tả |
|------|--------|-------|
| `Services/MusicService.cs` | ✏️ Rewrite | Implement toàn bộ music logic dùng Lavalink4NET 4.0 |
| `Modules/MusicModule.cs` | ✏️ Rewrite | 10 slash commands gọi MusicService |
| `Program.cs` | ✏️ Edit | Re-add `builder.Services.AddLavalink()`, `builder.Services.AddSingleton<MusicService>()`, + using |
| `Configuration/BotConfig.cs` | ✅ Có sẵn | `LavalinkConfig` đã có |
| `appsettings.json` | ✏️ Edit | Thêm section `Lavalink` |
| `appsettings.Development.json` | ✏️ Edit | Thêm section `Lavalink` nếu override |
| `docker-compose.yml` | ✏️ Edit | Thêm `lavalink` service image |
| `.env.example` | ✏️ Edit | Thêm `LAVALINK_PASSWORD` |
| `PLAN.md` (file này) | ✅ Done | |

### Kiến trúc MusicService

```
MusicService
├── IAudioService _audio             ← injected via DI
├── JoinPlayerAsync(guild, voice)    ← tạo / lấy player (QueuedLavalinkPlayer)
├── PlayAsync(guild, voice, query)   ← search + play/queue
├── SkipAsync(guild)                 ← skip 1
├── StopAsync(guild)                 ← clear + stop + disconnect
├── PauseAsync(guild)
├── ResumeAsync(guild)
├── SetVolumeAsync(guild, volume)
├── ToggleShuffleAsync(guild)
├── SetLoopModeAsync(guild, mode)
├── GetNowPlaying(guild)             ← trả về string embed
├── GetQueue(guild)                  ← trả về string danh sách
└── EnsurePlayerAsync → helper private
```

### Definition of Done

- [x] Khảo sát API Lavalink4NET 4.0.0
- [x] Lập kế hoạch chi tiết
- [ ] Rewrite `MusicService.cs`
- [ ] Rewrite `MusicModule.cs`
- [ ] Update `Program.cs` (DI + Lavalink)
- [ ] Update config files (appsettings, Docker, env)
- [ ] `dotnet build` sạch (0 errors, 0 warnings)
- [ ] Update `README.md` cho Phase 2

## 4. Phase 3 — Honeypot (kế hoạch sơ bộ)

(Kế hoạch chi tiết sau Phase 2)

## 5. Phase 4 — Hardening

(Kế hoạch chi tiết sau Phase 3)
