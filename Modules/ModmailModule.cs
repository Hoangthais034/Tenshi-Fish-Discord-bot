using Discord;
using Discord.Interactions;
using Discord.WebSocket;
using DiscordBot.Services;

namespace DiscordBot.Modules;

[Group("modmail", "Quản lý ticket hỗ trợ")]
public sealed class ModmailModule : InteractionModuleBase<SocketInteractionContext>
{
    private readonly ModmailService _modmail;

    public ModmailModule(ModmailService modmail)
    {
        _modmail = modmail;
    }

    // ─── Core: reply variants ──────────────────────────────────────────────

    [SlashCommand("reply", "Trả lời ticket (embed)")]
    [RequireUserPermission(GuildPermission.ManageChannels)]
    [Cooldown(3)]
    public async Task Reply(
        [Summary(description: "Nội dung tin nhắn")] string message)
    {
        if (Context.Channel is not SocketTextChannel channel)
        {
            await RespondAsync("Lệnh này chỉ dùng được trong text channel.", ephemeral: true);
            return;
        }
        var result = await _modmail.ReplyAsync(channel, (SocketGuildUser)Context.User, message);
        await FollowupAsync(result, ephemeral: true);
    }

    [SlashCommand("preply", "Trả lời dạng text (không embed)")]
    [RequireUserPermission(GuildPermission.ManageChannels)]
    public async Task PlainReply(
        [Summary(description: "Nội dung tin nhắn")] string message)
    {
        if (Context.Channel is not SocketTextChannel channel)
        {
            await RespondAsync("Lệnh này chỉ dùng được trong text channel.", ephemeral: true);
            return;
        }
        var result = await _modmail.PlainReplyAsync(channel, (SocketGuildUser)Context.User, message);
        await FollowupAsync(result, ephemeral: true);
    }

    [SlashCommand("areply", "Trả lời ẩn danh (embed)")]
    [RequireUserPermission(GuildPermission.ManageChannels)]
    public async Task AnonymousReply(
        [Summary(description: "Nội dung tin nhắn")] string message)
    {
        if (Context.Channel is not SocketTextChannel channel)
        {
            await RespondAsync("Lệnh này chỉ dùng được trong text channel.", ephemeral: true);
            return;
        }
        var result = await _modmail.AnonymousReplyAsync(channel, message);
        await FollowupAsync(result, ephemeral: true);
    }

    [SlashCommand("pareply", "Trả lời ẩn danh dạng text")]
    [RequireUserPermission(GuildPermission.ManageChannels)]
    public async Task PlainAnonymousReply(
        [Summary(description: "Nội dung tin nhắn")] string message)
    {
        if (Context.Channel is not SocketTextChannel channel)
        {
            await RespondAsync("Lệnh này chỉ dùng được trong text channel.", ephemeral: true);
            return;
        }
        var result = await _modmail.PlainAnonymousReplyAsync(channel, message);
        await FollowupAsync(result, ephemeral: true);
    }

    // ─── Core: close / edit / delete / move / note ─────────────────────────

    [SlashCommand("close", "Đóng ticket hiện tại")]
    [RequireUserPermission(GuildPermission.ManageChannels)]
    [Cooldown(5)]
    public async Task Close(
        [Summary(description: "Lý do đóng")] string? reason = null,
        [Summary(description: "Không gửi thông báo")] bool silent = false)
    {
        if (Context.Channel is not SocketTextChannel channel)
        {
            await RespondAsync("Lệnh này chỉ dùng được trong text channel.", ephemeral: true);
            return;
        }
        var result = await _modmail.CloseTicketAsync(channel, (SocketGuildUser)Context.User, reason, silent);
        await FollowupAsync(result, ephemeral: true);
    }

    [SlashCommand("edit", "Sửa tin nhắn reply đã gửi")]
    [RequireUserPermission(GuildPermission.ManageChannels)]
    public async Task Edit(
        [Summary(description: "ID tin nhắn (lấy từ footer)")] string messageId,
        [Summary(description: "Nội dung mới")] string newContent)
    {
        if (Context.Channel is not SocketTextChannel channel)
        {
            await RespondAsync("Lệnh này chỉ dùng được trong text channel.", ephemeral: true);
            return;
        }
        if (!ulong.TryParse(messageId, out var id))
        {
            await RespondAsync("ID không hợp lệ.", ephemeral: true);
            return;
        }
        var result = await _modmail.EditReplyAsync(channel, id, newContent);
        await FollowupAsync(result, ephemeral: true);
    }

    [SlashCommand("delete", "Xoá tin nhắn reply đã gửi")]
    [RequireUserPermission(GuildPermission.ManageChannels)]
    public async Task Delete(
        [Summary(description: "ID tin nhắn (lấy từ footer)")] string messageId)
    {
        if (Context.Channel is not SocketTextChannel channel)
        {
            await RespondAsync("Lệnh này chỉ dùng được trong text channel.", ephemeral: true);
            return;
        }
        if (!ulong.TryParse(messageId, out var id))
        {
            await RespondAsync("ID không hợp lệ.", ephemeral: true);
            return;
        }
        var result = await _modmail.DeleteReplyAsync(channel, id);
        await FollowupAsync(result, ephemeral: true);
    }

    [SlashCommand("move", "Di chuyển ticket sang category khác")]
    [RequireUserPermission(GuildPermission.ManageChannels)]
    public async Task Move(
        [Summary(description: "Category mới")] ICategoryChannel category)
    {
        if (Context.Channel is not SocketTextChannel channel)
        {
            await RespondAsync("Lệnh này chỉ dùng được trong text channel.", ephemeral: true);
            return;
        }
        var result = await _modmail.MoveTicketAsync(channel, category.Id);
        await FollowupAsync(result, ephemeral: true);
    }

    [SlashCommand("note", "Thêm ghi chú nội bộ")]
    [RequireUserPermission(GuildPermission.ManageChannels)]
    public async Task Note(
        [Summary(description: "Nội dung ghi chú")] string message,
        [Summary(description: "Ghim vĩnh viễn")] bool persistent = false)
    {
        if (Context.Channel is not SocketTextChannel channel)
        {
            await RespondAsync("Lệnh này chỉ dùng được trong text channel.", ephemeral: true);
            return;
        }
        if (persistent)
        {
                var presult = await _modmail.PersistentNoteAsync(channel, (SocketGuildUser)Context.User, message);
            await FollowupAsync(presult, ephemeral: true);
            return;
        }
        var result = await _modmail.NoteAsync(channel, (SocketGuildUser)Context.User, message);
        await FollowupAsync(result, ephemeral: true);
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  Sub-group: /modmail snippet ...
    // ═══════════════════════════════════════════════════════════════════════

    [Group("snippet", "Quản lý câu trả lời mẫu")]
    [RequireUserPermission(GuildPermission.ManageChannels)]
    public sealed class SnippetGroup : InteractionModuleBase<SocketInteractionContext>
    {
        private readonly ModmailService _modmail;

        public SnippetGroup(ModmailService modmail)
        {
            _modmail = modmail;
        }

        [SlashCommand("send", "Gửi snippet vào ticket")]
        public async Task Send(
            [Summary(description: "Tên snippet")][Autocomplete] string name)
        {
            if (Context.Channel is not SocketTextChannel channel)
            {
                await RespondAsync("Lệnh này chỉ dùng được trong text channel.", ephemeral: true);
                return;
            }
                var result = await _modmail.ReplyWithSnippetAsync(channel, (SocketGuildUser)Context.User, name);
            await FollowupAsync(result, ephemeral: true);
        }

        [SlashCommand("raw", "Xem nội dung gốc")]
        public async Task Raw(
            [Summary(description: "Tên snippet")][Autocomplete] string name)
        {
            var content = _modmail.GetSnippetRaw(Context.Guild.Id, name);
            if (content is null)
            {
                await RespondAsync($"Không tìm thấy snippet `{name}`.", ephemeral: true);
                return;
            }
            await RespondAsync($"```\n{content}\n```", ephemeral: true);
        }

        [SlashCommand("add", "Thêm snippet mới")]
        public async Task Add(
            [Summary(description: "Tên snippet")] string name,
            [Summary(description: "Nội dung")] string content)
        {
            var result = _modmail.CreateSnippet(Context.Guild.Id, name, content);
            await RespondAsync(result, ephemeral: true);
        }

        [SlashCommand("edit", "Sửa nội dung snippet")]
        public async Task Edit(
            [Summary(description: "Tên snippet")][Autocomplete] string name,
            [Summary(description: "Nội dung mới")] string content)
        {
            var result = _modmail.EditSnippet(Context.Guild.Id, name, content);
            await RespondAsync(result, ephemeral: true);
        }

        [SlashCommand("remove", "Xoá snippet")]
        public async Task Remove(
            [Summary(description: "Tên snippet")][Autocomplete] string name)
        {
            var result = _modmail.DeleteSnippet(Context.Guild.Id, name);
            await RespondAsync(result, ephemeral: true);
        }

        [SlashCommand("list", "Danh sách snippet")]
        public async Task List()
        {
            var snippets = _modmail.GetSnippets(Context.Guild.Id);
            if (snippets.Count == 0)
            {
                await RespondAsync("Chưa có snippet nào.", ephemeral: true);
                return;
            }
            var desc = string.Join('\n', snippets.Select(s => $"`{s.Name}`"));
            await RespondAsync(embed: new EmbedBuilder()
                .WithTitle($"Snippets ({snippets.Count})")
                .WithDescription(desc)
                .WithColor(Color.Blue)
                .Build(), ephemeral: true);
        }

        [AutocompleteCommand("send", "name")]
        public async Task AutocompleteSendName()
        {
            await AutocompleteSnippetNameAsync();
        }

        [AutocompleteCommand("raw", "name")]
        public async Task AutocompleteRawName()
        {
            await AutocompleteSnippetNameAsync();
        }

        [AutocompleteCommand("edit", "name")]
        public async Task AutocompleteEditName()
        {
            await AutocompleteSnippetNameAsync();
        }

        [AutocompleteCommand("remove", "name")]
        public async Task AutocompleteRemoveName()
        {
            await AutocompleteSnippetNameAsync();
        }

        private async Task AutocompleteSnippetNameAsync()
        {
            var focused = Context.Interaction as SocketAutocompleteInteraction;
            var input = focused?.Data.Current?.Value as string;
            var names = _modmail.AutocompleteSnippets(Context.Guild.Id, input);
            var results = names.Select(n => new AutocompleteResult(n, n));
            await focused?.RespondAsync(results.ToArray());
        }
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  Sub-group: /modmail logs ...
    // ═══════════════════════════════════════════════════════════════════════

    [Group("logs", "Tra cứu log")]
    [RequireUserPermission(GuildPermission.ManageChannels)]
    public sealed class LogsGroup : InteractionModuleBase<SocketInteractionContext>
    {
        private readonly ModmailService _modmail;

        public LogsGroup(ModmailService modmail)
        {
            _modmail = modmail;
        }

        [SlashCommand("user", "Xem lịch sử ticket của người dùng")]
        public async Task User(
            [Summary(description: "Người dùng")] IUser user)
        {
                var result = await _modmail.GetLogsAsync(Context.Guild, user.Id);
            await FollowupAsync(embed: new EmbedBuilder()
                .WithTitle($"Lịch sử — {user.Username}")
                .WithDescription(result)
                .WithColor(Color.Blue)
                .Build(), ephemeral: true);
        }

        [SlashCommand("closed-by", "Tìm ticket đã đóng bởi staff")]
        public async Task ClosedBy(
            [Summary(description: "Staff đã đóng")] IGuildUser staff)
        {
            var result = _modmail.GetLogsClosedBy(Context.Guild.Id, staff.Id);
            await RespondAsync(result, ephemeral: true);
        }

        [SlashCommand("key", "Tìm ticket theo từ khoá")]
        public async Task Key(
            [Summary(description: "Từ khoá")] string keyword)
        {
            var result = _modmail.GetLogsByKeyword(Context.Guild.Id, keyword);
            await RespondAsync(embed: new EmbedBuilder()
                .WithTitle($"Kết quả: \"{keyword}\"")
                .WithDescription(result)
                .WithColor(Color.Blue)
                .Build(), ephemeral: true);
        }

        [SlashCommand("responded", "Kiểm tra staff đã trả lời chưa")]
        public async Task Responded()
        {
            var result = _modmail.GetLogsResponded(Context.Channel.Id);
            await RespondAsync(result, ephemeral: true);
        }

        [SlashCommand("search", "Tìm kiếm nội dung log")]
        public async Task Search(
            [Summary(description: "Từ khoá")] string keyword)
        {
            var result = _modmail.SearchLogs(keyword);
            await RespondAsync(embed: new EmbedBuilder()
                .WithTitle($"Kết quả log: \"{keyword}\"")
                .WithDescription(result)
                .WithColor(Color.Blue)
                .Build(), ephemeral: true);
        }
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  Sub-group: /modmail admin ...
    // ═══════════════════════════════════════════════════════════════════════

    [Group("admin", "Quản trị modmail")]
    [RequireUserPermission(GuildPermission.ModerateMembers)]
    public sealed class AdminGroup : InteractionModuleBase<SocketInteractionContext>
    {
        private readonly ModmailService _modmail;

        public AdminGroup(ModmailService modmail)
        {
            _modmail = modmail;
        }

        [SlashCommand("block", "Chặn người dùng khỏi modmail")]
        public async Task Block(
            [Summary(description: "Người dùng")] IUser user,
            [Summary(description: "Lý do")] string? reason = null)
        {
            var result = _modmail.BlockUser(Context.Guild.Id, user.Id, reason, Context.User.Id);
            await RespondAsync(result, ephemeral: true);
        }

        [SlashCommand("unblock", "Bỏ chặn người dùng")]
        public async Task Unblock(
            [Summary(description: "Người dùng")] IUser user)
        {
            var result = _modmail.UnblockUser(Context.Guild.Id, user.Id);
            await RespondAsync(result, ephemeral: true);
        }

        [SlashCommand("blocked", "Danh sách người dùng bị chặn")]
        public async Task Blocked()
        {
            var blocked = _modmail.GetBlockedUsers(Context.Guild.Id);
            if (blocked.Count == 0)
            {
                await RespondAsync("Không có người dùng nào bị chặn.", ephemeral: true);
                return;
            }
            var lines = blocked.Select(b =>
                $"<@{b.UserId}> — {b.Reason ?? "Không có lý do"} (bởi <@{b.BlockedByStaffId}>)");
            await RespondAsync(embed: new EmbedBuilder()
                .WithTitle($"Danh sách chặn ({blocked.Count})")
                .WithDescription(string.Join('\n', lines))
                .WithColor(Color.Red)
                .Build(), ephemeral: true);
        }

        [SlashCommand("whitelist", "Thêm/xoá whitelist")]
        public async Task Whitelist(
            [Summary(description: "Người dùng")] IUser user,
            [Summary(description: "add hoặc remove")] string action = "add")
        {
            var result = action.ToLowerInvariant() switch
            {
                "add" => _modmail.WhitelistUser(Context.Guild.Id, user.Id, Context.User.Id),
                "remove" => _modmail.UnwhitelistUser(Context.Guild.Id, user.Id),
                _ => "Hành động không hợp lệ.",
            };
            await RespondAsync(result, ephemeral: true);
        }

        [SlashCommand("contact", "Tạo ticket chủ động")]
        [RequireUserPermission(GuildPermission.ManageChannels)]
        public async Task Contact(
            [Summary(description: "Người dùng")] IUser user)
        {
                var result = await _modmail.ContactAsync(Context.Guild.Id, user);
            await FollowupAsync(result, ephemeral: true);
        }

        [SlashCommand("selfcontact", "Tạo ticket (hiện tên staff)")]
        [RequireUserPermission(GuildPermission.ManageChannels)]
        public async Task SelfContact(
            [Summary(description: "Người dùng")] IUser user)
        {
                var result = await _modmail.SelfContactAsync((SocketGuildUser)Context.User, user);
            await FollowupAsync(result, ephemeral: true);
        }

        [SlashCommand("enable", "Bật modmail")]
        [RequireUserPermission(GuildPermission.Administrator)]
        public async Task Enable(
            [Summary(description: "Người dùng (bỏ trống = bật tất cả)")] IUser? user = null)
        {
            var result = _modmail.EnableModmail(Context.Guild.Id, user?.Id);
            await RespondAsync(result, ephemeral: true);
        }

        [SlashCommand("disable", "Tắt modmail")]
        [RequireUserPermission(GuildPermission.Administrator)]
        public async Task Disable(
            [Summary(description: "Chế độ: new / all / user")] string mode = "all",
            [Summary(description: "Người dùng (với mode=user)")] IUser? user = null)
        {
            var result = mode.ToLowerInvariant() switch
            {
                "new" => _modmail.DisableModmail(Context.Guild.Id, true, false),
                "all" => _modmail.DisableModmail(Context.Guild.Id, false, true),
                "user" when user is not null => _modmail.DisableModmail(Context.Guild.Id, false, false, user.Id),
                _ => "Chế độ không hợp lệ.",
            };
            await RespondAsync(result, ephemeral: true);
        }

        [SlashCommand("isenable", "Kiểm tra trạng thái modmail")]
        public async Task IsEnable(
            [Summary(description: "Người dùng (bỏ trống = kiểm tra chung)")] IUser? user = null)
        {
            var result = _modmail.IsModmailEnabled(Context.Guild.Id, user?.Id);
            await RespondAsync(result, ephemeral: true);
        }
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  Sub-group: /modmail ticket ...
    // ═══════════════════════════════════════════════════════════════════════

    [Group("ticket", "Quản lý ticket")]
    [RequireUserPermission(GuildPermission.ManageChannels)]
    public sealed class TicketGroup : InteractionModuleBase<SocketInteractionContext>
    {
        private readonly ModmailService _modmail;

        public TicketGroup(ModmailService modmail)
        {
            _modmail = modmail;
        }

        [SlashCommand("title", "Đặt tiêu đề ticket")]
        public async Task Title(
            [Summary(description: "Tiêu đề mới")] string title)
        {
            if (Context.Channel is not SocketTextChannel channel)
            {
                await RespondAsync("Lệnh này chỉ dùng được trong text channel.", ephemeral: true);
                return;
            }
                var result = await _modmail.SetTicketTitleAsync(channel, (SocketGuildUser)Context.User, title);
            await FollowupAsync(result, ephemeral: true);
        }

        [SlashCommand("adduser", "Thêm người dùng vào ticket")]
        public async Task AddUser(
            [Summary(description: "Người dùng")] IGuildUser user)
        {
            if (Context.Channel is not SocketTextChannel channel)
            {
                await RespondAsync("Lệnh này chỉ dùng được trong text channel.", ephemeral: true);
                return;
            }
                var result = await _modmail.AddUserToTicketAsync(channel, user);
            await FollowupAsync(result, ephemeral: true);
        }

        [SlashCommand("removeuser", "Xoá người dùng khỏi ticket")]
        public async Task RemoveUser(
            [Summary(description: "Người dùng")] IGuildUser user)
        {
            if (Context.Channel is not SocketTextChannel channel)
            {
                await RespondAsync("Lệnh này chỉ dùng được trong text channel.", ephemeral: true);
                return;
            }
                var result = await _modmail.RemoveUserFromTicketAsync(channel, user);
            await FollowupAsync(result, ephemeral: true);
        }

        [SlashCommand("repair", "Sửa ticket (webhook, permissions)")]
        public async Task Repair()
        {
            if (Context.Channel is not SocketTextChannel channel)
            {
                await RespondAsync("Lệnh này chỉ dùng được trong text channel.", ephemeral: true);
                return;
            }
                var result = await _modmail.RepairTicketAsync(channel);
            await FollowupAsync(result, ephemeral: true);
        }

        [SlashCommand("snooze", "Tạm gác ticket")]
        public async Task Snooze(
            [Summary(description: "Số phút")] int minutes = 60)
        {
            if (Context.Channel is not SocketTextChannel channel)
            {
                await RespondAsync("Lệnh này chỉ dùng được trong text channel.", ephemeral: true);
                return;
            }
                var result = await _modmail.SnoozeTicketAsync(channel, TimeSpan.FromMinutes(minutes));
            await FollowupAsync(result, ephemeral: true);
        }

        [SlashCommand("unsnooze", "Mở lại ticket")]
        public async Task Unsnooze()
        {
            if (Context.Channel is not SocketTextChannel channel)
            {
                await RespondAsync("Lệnh này chỉ dùng được trong text channel.", ephemeral: true);
                return;
            }
                var result = await _modmail.UnsnoozeTicketAsync(channel);
            await FollowupAsync(result, ephemeral: true);
        }

        [SlashCommand("snoozed", "Danh sách ticket đang gác")]
        public async Task Snoozed()
        {
                var result = await _modmail.GetSnoozedTicketsAsync(Context.Guild);
            await FollowupAsync(result, ephemeral: true);
        }

        [SlashCommand("clearsnoozed", "Xoá gác tất cả ticket")]
        public async Task ClearSnoozed()
        {
            var result = _modmail.ClearSnoozedTickets();
            await RespondAsync(result, ephemeral: true);
        }

        [SlashCommand("nsfw", "Đánh dấu NSFW")]
        public async Task Nsfw()
        {
            if (Context.Channel is not SocketTextChannel channel)
            {
                await RespondAsync("Lệnh này chỉ dùng được trong text channel.", ephemeral: true);
                return;
            }
                var result = await _modmail.SetNsfwAsync(channel);
            await FollowupAsync(result, ephemeral: true);
        }

        [SlashCommand("sfw", "Đánh dấu SFW")]
        public async Task Sfw()
        {
            if (Context.Channel is not SocketTextChannel channel)
            {
                await RespondAsync("Lệnh này chỉ dùng được trong text channel.", ephemeral: true);
                return;
            }
                var result = await _modmail.SetSfwAsync(channel);
            await FollowupAsync(result, ephemeral: true);
        }

        [SlashCommand("notify", "Bật/tắt thông báo reply")]
        public async Task Notify()
        {
            if (Context.Channel is not SocketTextChannel channel)
            {
                await RespondAsync("Lệnh này chỉ dùng được trong text channel.", ephemeral: true);
                return;
            }
            var result = _modmail.ToggleNotify(Context.Guild.Id, Context.User.Id, channel.Id);
            await RespondAsync(result, ephemeral: true);
        }

        [SlashCommand("subscribe", "Nhận DM khi user trả lời")]
        public async Task Subscribe()
        {
            if (Context.Channel is not SocketTextChannel channel)
            {
                await RespondAsync("Lệnh này chỉ dùng được trong text channel.", ephemeral: true);
                return;
            }
            var result = _modmail.ToggleSubscribe(channel.Id, Context.User.Id);
            await RespondAsync(result, ephemeral: true);
        }

        [SlashCommand("msglink", "Link tới tin nhắn reply")]
        public async Task MsgLink(
            [Summary(description: "ID tin nhắn (từ footer)")] string messageId)
        {
            if (!ulong.TryParse(messageId, out var id))
            {
                await RespondAsync("ID không hợp lệ.", ephemeral: true);
                return;
            }
            var link = _modmail.GetMessageLink(Context.Guild.Id, Context.Channel.Id, id);
            await RespondAsync(link, ephemeral: true);
        }

        [SlashCommand("loglink", "Link tới channel ticket")]
        public async Task LogLink()
        {
            var link = _modmail.GetLogLink(Context.Guild.Id, Context.Channel.Id);
            await RespondAsync(link, ephemeral: true);
        }
    }
}
