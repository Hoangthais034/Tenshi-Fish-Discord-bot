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

    [SlashCommand("reply", "Trả lời ticket (tin nhắn sẽ gửi tới người dùng qua DM)")]
    [RequireUserPermission(GuildPermission.ManageChannels)]
    public async Task Reply(
        [Summary(description: "Nội dung tin nhắn")] string message)
    {
        if (Context.Channel is not SocketTextChannel channel)
        {
            await RespondAsync("Lệnh này chỉ dùng được trong text channel.", ephemeral: true);
            return;
        }

        await DeferAsync(ephemeral: true);
        var result = await _modmail.ReplyAsync(channel, (SocketGuildUser)Context.User, message);
        await FollowupAsync(result, ephemeral: true);
    }

    [SlashCommand("areply", "Trả lời ticket ẩn danh (người dùng không thấy tên staff)")]
    [RequireUserPermission(GuildPermission.ManageChannels)]
    public async Task AnonymousReply(
        [Summary(description: "Nội dung tin nhắn")] string message)
    {
        if (Context.Channel is not SocketTextChannel channel)
        {
            await RespondAsync("Lệnh này chỉ dùng được trong text channel.", ephemeral: true);
            return;
        }

        await DeferAsync(ephemeral: true);
        var result = await _modmail.AnonymousReplyAsync(channel, message);
        await FollowupAsync(result, ephemeral: true);
    }

    [SlashCommand("close", "Đóng ticket hiện tại")]
    [RequireUserPermission(GuildPermission.ManageChannels)]
    public async Task Close(
        [Summary(description: "Lý do đóng ticket")] string? reason = null,
        [Summary(description: "Không gửi thông báo tới người dùng")] bool silent = false)
    {
        if (Context.Channel is not SocketTextChannel channel)
        {
            await RespondAsync("Lệnh này chỉ dùng được trong text channel.", ephemeral: true);
            return;
        }

        await DeferAsync(ephemeral: true);
        var result = await _modmail.CloseTicketAsync(channel, (SocketGuildUser)Context.User, reason, silent);
        await FollowupAsync(result, ephemeral: true);
    }

    [SlashCommand("block", "Chặn người dùng khỏi dịch vụ hỗ trợ")]
    [RequireUserPermission(GuildPermission.ModerateMembers)]
    public async Task Block(
        [Summary(description: "Người dùng cần chặn")] IUser user,
        [Summary(description: "Lý do chặn")] string? reason = null)
    {
        var result = _modmail.BlockUser(Context.Guild.Id, user.Id, reason, Context.User.Id);
        await RespondAsync(result, ephemeral: true);
    }

    [SlashCommand("unblock", "Bỏ chặn người dùng khỏi dịch vụ hỗ trợ")]
    [RequireUserPermission(GuildPermission.ModerateMembers)]
    public async Task Unblock(
        [Summary(description: "Người dùng cần bỏ chặn")] IUser user)
    {
        var result = _modmail.UnblockUser(Context.Guild.Id, user.Id);
        await RespondAsync(result, ephemeral: true);
    }

    [SlashCommand("logs", "Xem lịch sử ticket của người dùng")]
    [RequireUserPermission(GuildPermission.ManageChannels)]
    public async Task Logs(
        [Summary(description: "Người dùng cần xem lịch sử")] IUser user)
    {
        await DeferAsync(ephemeral: true);
        var result = await _modmail.GetLogsAsync(Context.Guild, user.Id);

        var embed = new EmbedBuilder()
            .WithTitle($"Lịch sử ticket — {user.Username}")
            .WithDescription(result)
            .WithColor(Color.Blue)
            .WithCurrentTimestamp()
            .Build();

        await FollowupAsync(embed: embed, ephemeral: true);
    }

    [SlashCommand("blocked", "Xem danh sách người dùng đang bị chặn")]
    [RequireUserPermission(GuildPermission.ModerateMembers)]
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

        var embed = new EmbedBuilder()
            .WithTitle($"Danh sách chặn ({blocked.Count})")
            .WithDescription(string.Join('\n', lines))
            .WithColor(Color.Red)
            .Build();

        await RespondAsync(embed: embed, ephemeral: true);
    }
}
