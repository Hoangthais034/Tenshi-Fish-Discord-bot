# Tenshi Fish Discord Bot

Discord bot built with discord.js v14, lavalink-client, better-sqlite3, tsyringe (DI), and Lavalink audio server.

## Features

- **Modmail** — Ticket support system with reply/close/edit/delete/note/snooze/reopen, anonymous replies, snippets, logs, admin tools (block, whitelist, staff roles, categories, greeting, alert role)
- **Music** — Play/skip/stop/queue/pause/resume/nowplaying/volume/shuffle/loop via Lavalink (SoundCloud default; YouTube via OAuth TV client)
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
| `DISCORD_DEV_GUILD_ID` | | `0` | Comma-separated dev guild IDs for slash command sync (empty registers commands globally) |
| `LAVALINK_HOST` | | `localhost` | Lavalink hostname |
| `LAVALINK_PORT` | | `2333` | Lavalink port |
| `LAVALINK_PASSWORD` | ✅ | `youshallnotpass` | Lavalink server password |
| `MODMAIL_GUILD_IDS` | ✅ | — | Comma-separated guild IDs for modmail tickets (multiple servers supported); `MODMAIL_GUILD_ID` still works as a single-value legacy fallback |
| `MODMAIL_CATEGORY_ID` | | `0` | Discord category for ticket channels |
| `LOCALE` | | `en` | Language: `en` or `vi` |
| `YOUTUBE_OAUTH_REFRESH_TOKEN` | | — | Refresh token of a spare Google account, used by the YouTube TV client (see below) |
| `YOUTUBE_CIPHER_PASSWORD` | | — | Shared secret between Lavalink and the `yt-cipher` container |

## Sources

- **SoundCloud** (default, fallback) — works from datacenter IPs
- **YouTube** — OAuth through the TV client + `yt-cipher` remote decipher (anonymous requests are blocked on datacenter IPs)
- **HTTP** — direct URL

### YouTube OAuth setup

1. Use a **spare** Google account, never your main one: YouTube may flag or lock it.
2. Leave `YOUTUBE_OAUTH_REFRESH_TOKEN` empty and run `docker compose up -d --build`.
3. Run `docker compose logs -f lavalink` and wait for `OAUTH INTEGRATION: ... go to https://www.google.com/device and enter code XXXX-XXXX`.
4. Open that page, enter the code, and sign in with the spare account.
5. The log then prints `OAUTH INTEGRATION: Token retrieved successfully. Store your refresh token as this can be reused. (1//...)`. Copy the `1//...` value.
6. Put it in `.env` as `YOUTUBE_OAUTH_REFRESH_TOKEN=1//...` and run `docker compose up -d` again.

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

### Dokploy

The same `docker-compose.yml` runs on [Dokploy](https://dokploy.com) unchanged.

1. **Create Service → Compose**, source **GitHub** (or Git), branch `master`, compose path `./docker-compose.yml`, compose type **Docker Compose** (not Stack: Stack mode can't `build`).
2. **Environment** tab: paste the variables from `.env.example` with real values. Required: `DISCORD_TOKEN`, `LAVALINK_PASSWORD`, `MODMAIL_GUILD_IDS`. Dokploy writes them to a `.env` next to the compose file, and the compose file reads them through `${VAR}` interpolation.
3. **Deploy**. No domain is needed: the bot only makes outbound connections, and Lavalink/yt-cipher stay on the internal network with no published ports.
4. Get the YouTube refresh token as in [YouTube OAuth setup](#youtube-oauth-setup), reading the `lavalink` service in the **Logs** tab. Put the token in **Environment** and redeploy.
5. Optional: enable **AutoDeploy** to redeploy on every push to `master`, and add a **Volume Backup** for the `bot-data` volume (the SQLite database).

Notes:
- Persistent data lives in named volumes (`bot-data`, `lavalink-logs`). Nothing is bind-mounted from the repo, because Dokploy re-clones the repo on deploy.
- Moving from the old `./.data` bind mount: copy `.data/bot-data.db` into the new volume once, for example `docker run --rm -v <project>_bot-data:/data -v $PWD/.data:/old alpine sh -c 'cp /old/bot-data.db /data/ && chown $(stat -c %u:%g /data) /data/bot-data.db'`, using the real volume name from `docker volume ls`.

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
