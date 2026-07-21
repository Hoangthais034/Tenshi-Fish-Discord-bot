# Discord Bot (C# / Discord.Net) — Music + Honeypot + Modmail

Gộp 3 tính năng, lấy cảm hứng từ:
- Music: [jagrosh/MusicBot](https://github.com/jagrosh/MusicBot) (Java) → viết lại bằng Discord.Net + NodeLink
- Honeypot: [RiskyMH/honeypot](https://github.com/RiskyMH/honeypot) (TS/Bun) → viết lại logic kick/ban theo channel bẫy
- Modmail: [modmail-dev/Modmail](https://github.com/modmail-dev/Modmail) (Python) → viết lại DM↔ticket-channel forwarding

## Phát triển theo phase

| Phase | Tính năng | Trạng thái |
|-------|-----------|------------|
| 1 | Modmail core (reply/close/block/logs) | ✅ Hoàn thành |
| 2 | Music (NodeLink: 10 slash commands) | ✅ Hoàn thành |
| 3 | Honeypot (multi-trap, experiments, custom messages, timer) | ✅ Hoàn thành |
| 4 | Hardening (global error handler, rate limit, graceful shutdown) | ✅ Hoàn thành |

## 1. Yêu cầu

- .NET 6 SDK
- Một server **NodeLink** đang chạy (bắt buộc cho Music, API-compatible với Lavalink v4)
- Node.js + **Yarn 4** (dùng làm task runner)

### Chạy NodeLink local

```bash
docker rm -f nodelink & docker run -d --name nodelink -p 2333:2333 \
  -e NODELINK_SERVER_PORT=2333 \
  -e NODELINK_SERVER_PASSWORD=youshallnotpass \
  performanc/nodelink:latest
```

## 2. Cấu hình

### Dev (local)

Copy `appsettings.Development.json` và điền token thật:

```bash
# appsettings.Development.json (đã có trong .gitignore)
{
  "Discord": { "Token": "NDc...", "OwnerId": 123456789012345678 },
  "NodeLink": { "BaseAddress": "http://localhost:2333", "Password": "youshallnotpass" },
  "Modmail": { "GuildId": 123456789012345678, "CategoryId": 0 }
}
```

### Production (Docker)

Dùng file `.env` hoặc set trực tiếp trong docker-compose:

```bash
DISCORD_TOKEN=NDc...
DISCORD_OWNER_ID=123456789012345678
NODELINK_PASSWORD=youshallnotpass
MODMAIL_GUILD_ID=123456789012345678
MODMAIL_CATEGORY_ID=0
```

Config hierarchy: env var → `appsettings.{env}.json` → `appsettings.json`

## 3. Chạy

### Dev (hot reload)

```bash
yarn install   # tạo .yarn/releases nếu chưa có
yarn dev       # dotnet watch run --environment Development
```

### Build

```bash
yarn build
```

### Production (Docker)

```bash
docker compose up -d
```

Slash command tự đăng ký global khi bot `Ready`.

## 4. Music Commands (Phase 2)

| Command | Mô tả |
|---------|-------|
| `/music play <query>` | Phát nhạc từ YouTube (tên hoặc URL) |
| `/music skip` | Bỏ qua bài đang phát |
| `/music stop` | Dừng + rời voice channel |
| `/music queue` | Xem hàng đợi |
| `/music pause` | Tạm dừng |
| `/music resume` | Tiếp tục |
| `/music nowplaying` | Bài đang phát + tiến trình |
| `/music volume <0-200>` | Chỉnh âm lượng |
| `/music shuffle` | Bật/tắt phát ngẫu nhiên |
| `/music loop <mode>` | Lặp None / Track / Queue |

## 5. Honeypot Commands (Phase 3)

| Command | Quyền | Mô tả |
|---------|-------|-------|
| `/honeypot setup <trap> <log> [action]` | Admin | Thiết lập trap channel, log channel, action (Kick/Ban/Softban) |
| `/honeypot disable` | Admin | Tắt honeypot |
| `/honeypot add-trap <channel>` | Admin | Thêm trap channel |
| `/honeypot remove-trap <channel>` | Admin | Xóa trap channel |
| `/honeypot messages [dm] [warning]` | Admin | Tùy chỉnh DM & warning message |
| `/honeypot experiment <name> [on/off]` | Admin | Bật/tắt experiment (TimeoutFirst, NoDm, NoWarningMsg, RandomChannelName) |

**Experiments:**
- `TimeoutFirst` — timeout 1h trước khi kick/ban
- `NoDm` — không gửi DM cho user
- `NoWarningMsg` — không post/edit warning message trong trap channel
- `RandomChannelName` — tự động đổi tên trap channel mỗi giờ (random từ danh sách) |

## 4. Cần Intent gì trên Developer Portal

Vào https://discord.com/developers/applications → app → Bot → bật:
- MESSAGE CONTENT INTENT
- SERVER MEMBERS INTENT

## 5. Modmail Commands (Phase 1)

Dùng trong ticket channel (sau khi user gửi DM):

| Command | Quyền | Mô tả |
|---------|-------|-------|
| `/modmail reply <message>` | ManageChannels | Trả lời user kèm tên staff |
| `/modmail areply <message>` | ManageChannels | Trả lời ẩn danh |
| `/modmail close [reason] [silent]` | ManageChannels | Đóng + xoá ticket channel |
| `/modmail block <user> [reason]` | ManageChannels | Chặn user khỏi modmail |
| `/modmail unblock <user>` | ManageChannels | Bỏ chặn |
| `/modmail blocked` | ManageChannels | Xem danh sách chặn |
| `/modmail logs <user>` | ManageChannels | Lịch sử ticket của user |

## 6. Việc còn thiếu / gợi ý mở rộng

- Modmail: webhook forwarding (hiện tại đang fallback text plain), attachment forwarding, canned responses, log channel riêng
- Music: `/play`, `/skip`, `/stop`, `/queue`
- Honeypot: re-enable command + setup flow
- Nên tách LiteDB → Postgres/SQLite qua EF Core nếu multi-guild

## 7. Deploy lên VPS (Oracle Linux 9)

### Cài đặt

```bash
# 1. Cài .NET 10 SDK
sudo dnf install -y dotnet-sdk-10.0

# 2. Cài Docker
sudo dnf config-manager --add-repo https://download.docker.com/linux/centos/docker-ce.repo
sudo dnf install -y docker-ce docker-ce-cli containerd.io
sudo systemctl enable --now docker
sudo usermod -aG docker $USER
# Logout rồi login lại (hoặc chạy: newgrp docker)

# 3. Cài Docker Compose plugin
sudo dnf install -y docker-compose-plugin

# 4. Clone code
git clone <repo-url> && cd DiscordBot

# 5. Tạo file .env với token thật
cp .env.example .env
nano .env
# Điền DISCORD_TOKEN, DISCORD_OWNER_ID, DISCORD_DEV_GUILD_ID, MODMAIL_GUILD_ID, ...
```

### Chạy

```bash
# Build + start bot + nodelink
docker compose up -d --build

# Xem log
docker compose logs -f

# Dừng
docker compose down
```

### Hoặc chạy không Docker (direct)

```bash
# Chạy NodeLink bằng Docker riêng
docker run -d --name nodelink -p 2333:2333 \
  -e NODELINK_SERVER_PORT=2333 \
  -e NODELINK_SERVER_PASSWORD=youshallnotpass \
  performanc/nodelink:latest

# Build bot
dotnet publish -c Release -o dist

# Chạy
DOTNET_ENVIRONMENT=Production dotnet dist/DiscordBot.dll
```

### Cập nhật code mới

```bash
git pull
docker compose up -d --build
```

Xem thêm: `docs/FEATURE_MATRIX.md`
