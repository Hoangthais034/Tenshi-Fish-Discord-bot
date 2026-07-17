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

## 4. Phase 3 — Honeypot (kế hoạch chi tiết)

### Khảo sát source gốc (RiskyMH/honeypot)

Source gốc có các features:
- Trap channel + action (kick/ban/softban/disabled)
- Multi-channel (nhiều channel bẫy/guild)
- Experiments: timeout-first, no-dm, no-warning-msg, ensure-msg-delete, channel-warmer, random-channel-name, recreate-channel, forward-message, reinvite, only-recent-delete
- Custom DM/warning/log messages
- Warning message trong trap channel (đếm số lần trigger)
- Permission skip cho admin/owner
- Rate limiting

### Hiện trạng

- ✅ `/honeypot setup <trap> <log> [action]` — đã có
- ✅ `/honeypot disable` — đã có
- ✅ HoneypotService cơ bản (OnMessageReceived, kick/ban, log)
- ❌ Chỉ 1 trap channel/guild
- ❌ Thiếu softban action
- ❌ Thiếu custom messages
- ❌ Thiếu experiments (timeout-first, no-dm, random-channel-name)
- ❌ Thiếu warning message trong channel

### Danh sách thay đổi Phase 3

| # | Feature | Mô tả |
|---|---------|-------|
| 1 | Multi-honeypot | Chuyển từ `TrapChannelId` (ulong) → `TrapChannels` (List) |
| 2 | Softban action | Ban + unban ngay (kick + xoá message) |
| 3 | Experiments flag | Enum flags: TimeoutFirst, NoDm, NoWarningMsg, RandomChannelName |
| 4 | `/honeypot messages` | Custom DM message + warning message |
| 5 | `/honeypot experiment` | Bật/tắt experiments |
| 6 | Random channel name | `IHostedService` timer đổi tên channel mỗi giờ |
| 7 | Warning message | Bot post + update warning trong trap channel |
| 8 | Permission skip | Không ban admin/owner, log riêng |

### Files cần sửa / tạo

| File | Action | Mô tả |
|------|--------|-------|
| `Services/HoneypotModels.cs` | ✨ Tạo mới | Models cho settings + experiments |
| `Services/HoneypotService.cs` | ✏️ Rewrite | Multi-channel, experiments, custom messages, warning |
| `Modules/HoneypotModule.cs` | ✏️ Rewrite | Thêm `/messages`, `/experiment` commands |
| `Services/HoneypotHostedService.cs` | ✨ Tạo mới | `IHostedService` timer cho random channel name |
| `Program.cs` | ✏️ Edit | Add `HoneypotHostedService` |
| `README.md` | ✏️ Edit | Update command list |

### HoneypotGuildSettings model

```
HoneypotGuildSettings
├── GuildId
├── TrapChannels (List<HoneypotChannelInfo>)  ← multi channel
├── LogChannelId
├── Action (Kick / Ban / Softban / Disabled)
├── Experiments (HoneypotExperiment flags)
├── DmMessage (custom DM)
├── WarningMessage (custom warning)
└── WarningMessageId (message ID trong trap channel)
```

### HoneypotExperiments enum

```
[Flags]
HoneypotExperiments:
  None = 0
  TimeoutFirst = 1
  NoDm = 2
  NoWarningMsg = 4
  RandomChannelName = 8
```

### Definition of Done

- [x] `dotnet build` sạch (0 errors, 0 warnings)
- [x] Multi-honeypot hoạt động (test với 2+ channels)
- [x] `/honeypot messages` cho phép set custom DM + warning text
- [x] `/honeypot experiment` bật/tắt từng experiment
- [x] Random channel name chạy background timer
- [x] Update `README.md`

## 5. Phase 4 — Hardening

### Mục tiêu
Xử lý lỗi toàn cục, rate limiting, shutdown graceful.

### Danh sách thay đổi

| # | Feature | Mô tả |
|---|---------|-------|
| 1 | Global error handler | Bắt exception từ tất cả slash command, log + reply ephemeral |
| 2 | Rate limit (cooldown) | Custom `[Cooldown]` attribute, per-user per-command, dùng `IMemoryCache` |
| 3 | Graceful shutdown | Disconnect Lavalink, log cleanup, cancellation token propagation |

### Files cần sửa / tạo

| File | Action | Mô tả |
|------|--------|-------|
| `Services/RateLimitService.cs` | ✨ Tạo mới | Rate limit logic + `CooldownAttribute` |
| `Program.cs` | ✏️ Edit | Hook `InteractionExecuted` + rate limit DI + shutdown handling |
| `BotWorker.cs` | ✏️ Tách file | Tách BotWorker ra file riêng, thêm `StopAsync` cleanup |
| `Modules/ModmailModule.cs` | ✏️ Edit | Thêm `[Cooldown]` attribute |
| `Modules/HoneypotModule.cs` | ✏️ Edit | Thêm `[Cooldown]` attribute |

### Definition of Done

- [ ] Global error handler bắt + log mọi exception từ interaction
- [ ] Rate limit: `/modmail reply` + `/modmail close` + `/honeypot setup` có cooldown 5s
- [ ] `dotnet build` sạch (0 errors, 0 warnings)
