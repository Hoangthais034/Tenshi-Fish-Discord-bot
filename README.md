# Tenshi Fish Discord Bot

Discord bot built with discord.js v14, lavalink-client, better-sqlite3, tsyringe (DI), and Lavalink audio server.

## Stack

- **Runtime:** Node.js + TypeScript
- **Framework:** discord.js v14
- **Audio:** lavalink-client + Lavalink v4
- **Database:** better-sqlite3
- **DI:** tsyringe
- **Build:** tsup

## Quick Start (Docker)

```bash
cp .env.example .env
# Edit .env with your tokens
docker compose up -d
```

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `DISCORD_TOKEN` | ✅ | Discord bot token |
| `DISCORD_OWNER_ID` | Owner Discord user ID |
| `LAVALINK_HOST` | Lavalink hostname (default: `lavalink`) |
| `LAVALINK_PORT` | Lavalink port (default: `2333`) |
| `LAVALINK_PASSWORD` | ✅ | Lavalink server password |
| `MODMAIL_GUILD_ID` | ✅ | Guild ID for modmail |
## YouTube Block

Host VPS bị YouTube block ở network level (IP datacenter). Tất cả client đều fail resolve URL.

Giải pháp:

- **SoundCloud** (đã bật, hoạt động) — `/music play <tên bài>` hoặc dán link SoundCloud
- **HTTP source** — link nhạc trực tiếp (.mp3, .ogg, .wav)
- **Residential proxy** — trả phí ~$1-3/GB, YouTube hoạt động trở lại

## Sources

- **SoundCloud** (mặc định, fallback) — chạy từ datacenter IP
- **YouTube** — cần OAuth + TV client (Oracle VPS block datacenter IP)
- **HTTP** — URL trực tiếp

## Development

```bash
npm install
npm run dev        # hot-reload via tsx watch
npm run build      # build to dist/
npm start          # run dist/index.js
npm run db:init    # init database schema
```
