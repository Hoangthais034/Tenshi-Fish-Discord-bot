# Migration Plan: C# → Node.js + TypeScript

## Stack chốt

| Thành phần | Công nghệ |
|---|---|
| Runtime | Node.js 20+ |
| Framework | discord.js v14 |
| Ngôn ngữ | TypeScript |
| Audio Client | erela.js v2 |
| Audio Server | NodeLink |
| Database | better-sqlite3 |
| DI Container | tsyringe |
| Config | dotenv |
| Dev Build | tsx + tsup |
| Prod Build | tsup → dist/ |

## Cấu trúc thư mục

```
DiscordBot/
├── .plan/
│   └── migration.md
├── src/
│   ├── index.ts                  # Entry: dotenv, container, login
│   ├── config.ts                 # Env → typed config object
│   ├── types.ts                  # Shared types
│   ├── di.ts                     # tsyringe container
│   ├── handlers/
│   │   ├── interaction.ts        # Global interaction handler
│   │   └── register.ts           # Module loader + command register
│   ├── modules/
│   │   ├── help.ts               # /help
│   │   ├── music.ts              # /music (10 commands)
│   │   ├── modmail.ts            # /modmail (40 commands)
│   │   └── honeypot.ts           # /honeypot (6 commands)
│   ├── services/
│   │   ├── music.ts              # erela.js Manager
│   │   ├── modmail.ts            # DM → ticket, reply, close, block...
│   │   ├── honeypot.ts           # Trap detection
│   │   ├── honeypot-hosted.ts    # Background rename timer
│   │   └── ratelimit.ts          # In-memory cooldown
│   └── database/
│       ├── schema.sql            # DDL (9 tables)
│       ├── init.ts               # Khởi tạo DB
│       └── types.ts               # Row types
├── nodelink/
│   └── application.yml           # NodeLink config
├── docker-compose.yml
├── Dockerfile
├── deploy.sh
├── package.json
├── tsconfig.json
└── .env.example
```

## Database (better-sqlite3) — 9 tables

| Bảng | Mục đích |
|---|---|
| `tickets` | Modmail ticket channel mapping |
| `blocks` | Blocked users |
| `whitelist` | Whitelisted users |
| `message_logs` | Modmail message history |
| `snippets` | Canned responses |
| `guild_configs` | Guild-level modmail config |
| `notifications` | Staff notification prefs |
| `persistent_notes` | Persistent ticket notes |
| `honeypot_guilds` | Honeypot config per guild |

## Thứ tự implement

| Phase | Files | Nội dung |
|---|---|---|
| 1.1 | package.json, tsconfig.json, .env.example, config.ts | Project skeleton |
| 1.2 | schema.sql, init.ts, types.ts | Database layer |
| 1.3 | di.ts, index.ts, handlers/interaction.ts, handlers/register.ts | Bot core |
| 1.4 | services/ratelimit.ts, services/music.ts | Rate limit + Music |
| 1.5 | modules/music.ts, modules/help.ts | Slash commands |
| 2.1 | services/modmail.ts, modules/modmail.ts | Modmail full |
| 2.2 | services/honeypot.ts, services/honeypot-hosted.ts, modules/honeypot.ts | Honeypot |
| 3 | nodelink/, docker-compose.yml, Dockerfile, deploy.sh | Infra |

## So sánh C# → TS methods

### MusicService (erela.js)

| C# | TypeScript |
|---|---|
| `PlayAsync(guildId, voiceChannelId, query)` | `play(guildId, voiceId, query)` |
| `SkipAsync(guildId)` | `skip(guildId)` |
| `StopAsync(guildId)` | `stop(guildId)` |
| `PauseAsync(guildId)` | `pause(guildId)` |
| `ResumeAsync(guildId)` | `resume(guildId)` |
| `SetVolumeAsync(guildId, volume)` | `setVolume(guildId, volume)` |
| `ToggleShuffleAsync(guildId)` | `shuffle(guildId)` |
| `SetLoopModeAsync(guildId, mode)` | `setLoop(guildId, mode)` |
| `GetNowPlayingAsync(guildId)` | `nowPlaying(guildId)` |
| `GetQueueAsync(guildId)` | `getQueue(guildId)` |

### ModmailService

| C# | TypeScript |
|---|---|
| `ReplyAsync(channel, staff, content)` | `reply(channel, staff, content)` |
| `PlainReplyAsync(channel, staff, content)` | `plainReply(channel, staff, content)` |
| `AnonymousReplyAsync(channel, content)` | `anonymousReply(channel, content)` |
| `PlainAnonymousReplyAsync(channel, content)` | `plainAnonymousReply(channel, content)` |
| `EditReplyAsync(channel, messageId, newContent)` | `editReply(channel, messageId, content)` |
| `DeleteReplyAsync(channel, messageId)` | `deleteReply(channel, messageId)` |
| `CloseTicketAsync(channel, closer, reason, silent)` | `close(channel, closer, reason, silent)` |
| + 45 methods nữa | |
