# Feature Matrix — Music + Honeypot + Modmail

> So sánh tính năng giữa 3 repo nguồn và skeleton C# hiện tại.
> Cập nhật lần cuối: Phase 1

## MusicBot (jagrosh/MusicBot - Java)

| # | Feature | Permission | Có skeleton? | Quyết định | Trạng thái |
|---|---------|-----------|-------------|------------|-----------|
| 1 | `/play <query\|URL>` | User (in VC) | ✅ Có | Giữ | Done |
| 2 | `/skip` (vote) | User (listener) | ✅ Có (immediate) | Mở rộng | Pending |
| 3 | `/stop` | DJ | ✅ Có | Giữ | Done |
| 4 | `/queue [page]` (paginated embed) | User | ✅ Có (plain) | Nâng cấp | Pending |
| 5 | `/pause` `/resume` | DJ | ❌ Không | Port | Pending |
| 6 | `/nowplaying` (progress bar) | User | ❌ Không | Port | Pending |
| 7 | `/volume <0-150>` | DJ | ❌ Không | Port | Pending |
| 8 | `/repeat <off\|all\|single>` | DJ | ❌ Không | Port | Pending |
| 9 | `/shuffle` | User (own songs) | ❌ Không | Port | Pending |
| 10 | `/remove <pos\|ALL>` | User/DJ | ❌ Không | Port | Pending |
| 11 | `/playnext <query>` (insert front) | DJ | ❌ Không | Port | Pending |
| 12 | `/forceskip` | DJ | ❌ Không | Port | Pending |
| 13 | `/search <query>` (pick from 5) | User | ❌ Không | Port | Pending |
| 14 | `/seek <time>` | DJ/Requester | ❌ Không | Port | Pending |
| 15 | `/skipto <pos>` | DJ | ❌ Không | Port | Pending |
| 16 | `/movetrack <from> <to>` | DJ | ❌ Không | Port | Pending |
| 17 | `/lyrics [song]` | User | ❌ Không | Cân nhắc | Pending |
| 18 | `/scsearch` (SoundCloud) | User | ❌ Không | Cân nhắc | Pending |
| 19 | DJ role system | — | ❌ Không | Port | Pending |
| 20 | Auto-leave khi VC trống | — | ❌ Không | Port | Pending |
| 21 | Playlist save/load | Owner | ❌ Không | Cân nhắc | Pending |
| 22 | Fair queue (user rotation) | — | ❌ Không | Port | Pending |
| 23 | Vote skip ratio config | Admin | ❌ Không | Cân nhắc | Pending |
| 24 | Text channel restriction | Admin | ❌ Không | Bỏ | Dùng slash command, không cần |
| 25 | Owner commands (eval, setavatar...) | Owner | ❌ Không | Bỏ | Không cần cho use-case |
| 26 | `npimages` (thumbnail in nowplaying) | Config | ❌ Không | Port | Pending |

## Honeypot (RiskyMH/honeypot - TypeScript)

| # | Feature | Experiment? | Có skeleton? | Quyết định | Trạng thái |
|---|---------|-----------|-------------|------------|-----------|
| 1 | `/honeypot setup` (channel + log + action) | — | ✅ Có | Giữ | Done |
| 2 | `/honeypot disable` | — | ✅ Có | Giữ | Done |
| 3 | `/honeypot-messages` (custom message modal) | — | ❌ Không | Port | Pending |
| 4 | Channel warmer (giữ active) | ✅ | ❌ Không | Port có điều kiện | Pending |
| 5 | Random channel name (200 tên) | ✅ | ❌ Không | Port có điều kiện | Pending |
| 6 | Random channel name chaos (random chars) | ✅ | ❌ Không | Port có điều kiện | Pending |
| 7 | No-warning-msg (ẩn cảnh báo) | ✅ | ❌ Không | Port | Pending |
| 8 | No-DM (không DM khi trigger) | ✅ | ❌ Không | Port | Pending |
| 9 | Reinvite (tạo invite trong DM) | ✅ | ❌ Không | Cân nhắc | Pending |
| 10 | Timeout-first (timeout 1h trước action) | ✅ | ❌ Không | Bỏ | Discord API rate limit |
| 11 | Only-recent-delete (xoá 15ph) | ✅ | ❌ Không | Port | Pending |
| 12 | Many-honeypots (nhiều channel) | ✅ | ❌ Không | Port | Pending |
| 13 | Forward-message (log channel) | ✅ | ❌ Không | Cân nhắc | Pending |
| 14 | Recreate-channel (mới mỗi ngày) | ✅ | ❌ Không | Bỏ | Quá aggressive |
| 15 | Ensure-msg-delete (bulk cleanup) | ✅ | ❌ Không | Bỏ | Phức tạp, ít giá trị |

## Modmail (modmail-dev/Modmail - Python)

| # | Feature | Permission | Có skeleton? | Quyết định | Trạng thái |
|---|---------|-----------|-------------|------------|-----------|
| 1 | DM → ticket channel auto-create | — | ✅ Có | Giữ | Done |
| 2 | Staff reply → DM forward (plain text) | — | ✅ Có | Thay thế | Done (chuyển sang webhook) |
| 3 | `/close [reason] [silent]` | Supporter | ✅ Có (basic) | Mở rộng | **Phase 1** |
| 4 | `/reply <message>` (webhook) | Supporter | ❌ Không | Port | **Phase 1** |
| 5 | `/areply <message>` (anonymous webhook) | Supporter | ❌ Không | Port | **Phase 1** |
| 6 | `/block <user> [reason]` | Moderator | ❌ Không | Port | **Phase 1** |
| 7 | `/unblock <user>` | Moderator | ❌ Không | Port | **Phase 1** |
| 8 | `/logs [user]` | Supporter | ❌ Không | Port | **Phase 1** |
| 9 | `/snippet` (canned response) | Supporter | ❌ Không | Port | Pending |
| 10 | `/move <category>` (chuyển thread) | Moderator | ❌ Không | Port | Pending |
| 11 | `/contact <user>` (staff tạo thread) | Supporter | ❌ Không | Port | Pending |
| 12 | `/note <message>` | Supporter | ❌ Không | Port | Pending |
| 13 | `/title <name>` (set thread title) | Supporter | ❌ Không | Cân nhắc | Pending |
| 14 | `/snooze` `/unsnooze` | Supporter | ❌ Không | Cân nhắc | Pending |
| 15 | `/edit <id> <message>` (sửa reply) | Supporter | ❌ Không | Cân nhắc | Pending |
| 16 | `/delete <id>` (xoá reply) | Supporter | ❌ Không | Cân nhắc | Pending |
| 17 | `/disable new\|all` / `/enable` | Admin | ❌ Không | Cân nhắc | Pending |
| 18 | Thread creation menu (dropdown) | Admin | ❌ Không | Cân nhắc | Pending |
| 19 | Permission levels (Owner/Admin/Mod/Supporter) | — | ❌ Không | Thay thế | Dùng Discord permission |
| 20 | Webhook message format (staff name + avatar) | — | ❌ Không | Port | **Phase 1** |
| 21 | Plugin system | — | ❌ Không | Bỏ | Không tương đương C# |
| 22 | Alias system | — | ❌ Không | Bỏ | Slash command không cần |
| 23 | `/adduser` `/removeuser` (group thread) | Supporter | ❌ Không | Bỏ | Phức tạp, ít use-case |
| 24 | Log viewing (web UI) | — | ❌ Không | Bỏ | Cần web server riêng |

## Ghi chú quyết định

- **Port**: Giữ nguyên ý tưởng, implement bằng C# idiom
- **Port có điều kiện**: Giữ nhưng đơn giản hoá hoặc để opt-in
- **Bỏ**: Không hợp DI/LiteDB/slash-command pattern hoặc trùng Discord native
- **Thay thế**: Giữ mục tiêu nhưng đổi cách làm cho hợp .NET
- **Cân nhắc**: Nice-to-have, làm sau khi core ổn
