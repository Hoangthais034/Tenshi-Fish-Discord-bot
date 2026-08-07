# Tenshi Fish Discord Bot

Discord bot built with discord.js v14, lavalink-client, better-sqlite3, tsyringe (DI), and Lavalink audio server.

## Features

- **Modmail** — Ticket support system with reply/close/edit/delete/note/snooze/reopen, anonymous replies, snippets, logs, admin tools (block, whitelist, staff roles, categories, greeting, alert role)
- **Music** — Play/skip/stop/queue/pause/resume/nowplaying/volume/shuffle/loop via Lavalink (SoundCloud default, YouTube requires residential proxy)
- **Trap** — Honeypot/spam trap: `/trap setup`, `/trap add-trap`, `/trap remove-trap`, `/trap disable`, `/trap messages`, `/trap experiment`, `/trap stats`
- **i18n** — Bilingual English/Vietnamese via `LOCALE` env var

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

| Variable | Required | Default | Description |
|---|---|---|---|
| `DISCORD_TOKEN` | ✅ | — | Discord bot token |
| `DISCORD_OWNER_ID` | | `0` | Owner Discord user ID |
| `DISCORD_DEV_GUILD_ID` | | `0` | Dev guild for slash command sync |
| `LAVALINK_HOST` | | `localhost` | Lavalink hostname |
| `LAVALINK_PORT` | | `2333` | Lavalink port |
| `LAVALINK_PASSWORD` | ✅ | `youshallnotpass` | Lavalink server password |
| `MODMAIL_GUILD_IDS` | ✅ | — | Comma-separated guild IDs for modmail tickets (multiple servers supported); `MODMAIL_GUILD_ID` still works as a single-value legacy fallback |
| `MODMAIL_CATEGORY_ID` | | `0` | Discord category for ticket channels |
| `LOCALE` | | `en` | Language: `en` or `vi` |

## Sources

- **SoundCloud** (default, fallback) — works from datacenter IPs
- **YouTube** — requires OAuth + TV client (blocked on datacenter IPs)
- **HTTP** — direct URL

## Project Structure

```
src/
├── database/            # SQLite schema + type definitions
├── locales/             # i18n: en.json, vi.json, index.ts (t() loader)
├── modules/             # Slash command builders + handlers
│   ├── help.ts          # /help command
│   ├── honeypot.ts      # /trap command (name: honeypot internally)
│   ├── modmail.ts       # /modmail command
│   └── music.ts         # /music command
├── services/            # Business logic
│   ├── honeypot.ts      # Trap detection + action
│   ├── honeypot-hosted  # Periodic trap cleanup
│   ├── modmail.ts       # Ticket CRUD, DM handling, logs
│   └── music.ts         # Lavalink player management
├── config.ts            # Env configuration
├── index.ts             # Entry point (DI container, command registration)
└── types.ts             # Shared TypeScript interfaces
```

## i18n

- Bot supports English and Vietnamese via `LOCALE` environment variable
- Locale files: `src/locales/{en,vi}.json`
- Use `t('namespace.key', { param })` in code (auto-fallback to `en` if key missing)

## Deployment

```bash
# Pull latest, rebuild, and restart
./deploy.sh
```

Or manually:

```bash
docker compose up -d --build
```

## Code Origins

- **Modmail** — inspired by reference implementations, rewritten from scratch in TypeScript with SQLite + DI
- **Honeypot/Trap** — inspired by reference code, rewritten in TypeScript with configurable actions and experiments
- **Music** — self-built on Lavalink v4 + lavalink-client, with SoundCloud as primary source

## Development

```bash
npm install
npm run dev        # hot-reload via tsx watch
npm run build      # build to dist/
npm start          # run dist/index.cjs
npm run db:init    # initialize database schema
```
