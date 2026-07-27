# Tenshi Fish Discord Bot

Discord bot built with discord.js v14, erela.js, better-sqlite3, tsyringe (DI), and NodeLink audio server.

## Stack

- **Runtime:** Node.js + TypeScript
- **Framework:** discord.js v14
- **Audio:** erela.js v2.4.0 + NodeLink (Lavalink v4-compatible)
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
| `NODELINK_HOST` | NodeLink hostname (default: `nodelink`) |
| `NODELINK_PORT` | NodeLink port (default: `2333`) |
| `NODELINK_PASSWORD` | ✅ | NodeLink server password |
| `MODMAIL_GUILD_ID` | ✅ | Guild ID for modmail |
## YouTube Block

NodeLink chạy trên Oracle VPS bị YouTube block ở network level (IP datacenter). Tất cả client (Android, WEB, TV, MUSIC_ANDROID) đều fail resolve URL. OAuth cũng ko hiệu quả vì chính OAuth token exchange request cũng bị chặn.

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
