using Discord;
using Discord.Rest;
using Discord.WebSocket;
using DiscordBot.Configuration;
using LiteDB;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace DiscordBot.Services;

public sealed class ModmailService
{
    private readonly DiscordSocketClient _client;
    private readonly LiteDatabase _db;
    private readonly IOptions<ModmailConfig> _config;
    private readonly ILogger<ModmailService> _logger;

    public ModmailService(
        DiscordSocketClient client,
        LiteDatabase db,
        IOptions<ModmailConfig> config,
        ILogger<ModmailService> logger)
    {
        _client = client;
        _db = db;
        _config = config;
        _logger = logger;
    }

    private ILiteCollection<ModmailTicket> Tickets => _db.GetCollection<ModmailTicket>("modmail_tickets");
    private ILiteCollection<ModmailBlock> Blocks => _db.GetCollection<ModmailBlock>("modmail_blocks");
    private ILiteCollection<ModmailMessageLog> MessageLogs => _db.GetCollection<ModmailMessageLog>("modmail_messages");

    public void RegisterHandlers(DiscordSocketClient _)
    {
        _client.MessageReceived += OnMessageReceivedAsync;
    }

    private async Task OnMessageReceivedAsync(SocketMessage message)
    {
        if (message.Author.IsBot) return;

        if (message.Channel is IDMChannel)
            await HandleIncomingDmAsync(message);
    }

    public async Task HandleIncomingDmAsync(SocketMessage message)
    {
        var guild = _client.GetGuild(_config.Value.GuildId);
        if (guild is null)
        {
            _logger.LogWarning("Modmail: GuildId chưa được config đúng.");
            return;
        }

        if (IsBlocked(_config.Value.GuildId, message.Author.Id))
        {
            try { await message.Channel.SendMessageAsync("Bạn đã bị chặn khỏi dịch vụ hỗ trợ."); }
            catch { }
            return;
        }

        var ticket = Tickets.FindOne(t => t.UserId == message.Author.Id && t.Open);
        ITextChannel? channel = null;

        if (ticket is not null)
            channel = guild.GetTextChannel(ticket.ChannelId);

        if (channel is null)
        {
            ticket = new ModmailTicket
            {
                UserId = message.Author.Id,
                UserName = message.Author.Username,
                Open = true,
                CreatedAt = DateTime.UtcNow,
            };

            var restChannel = await guild.CreateTextChannelAsync(
                $"ticket-{message.Author.Username}".ToLowerInvariant(),
                props => props.CategoryId = _config.Value.CategoryId == 0 ? null : _config.Value.CategoryId);

            channel = restChannel;
            ticket.ChannelId = channel.Id;
            Tickets.Insert(ticket);

            try
            {
                var webhook = await restChannel.CreateWebhookAsync("Modmail Forwarder");
                ticket.WebhookId = webhook.Id;
                ticket.WebhookToken = webhook.Token;
                Tickets.Update(ticket);
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Không thể tạo webhook cho ticket channel {Channel}", channel.Id);
            }

            await channel.SendMessageAsync(embed: new EmbedBuilder()
                .WithTitle("Modmail mới")
                .WithDescription($"Từ {message.Author.Mention} (`{message.Author.Id}`)")
                .WithColor(Color.Blue)
                .WithCurrentTimestamp()
                .Build());
        }

        await ForwardUserMessageToChannelAsync(ticket!, channel, message);

        try
        {
            await message.Channel.SendMessageAsync("✅ Tin nhắn của bạn đã được gửi đến đội ngũ hỗ trợ.");
        }
        catch { }
    }

    private async Task ForwardUserMessageToChannelAsync(ModmailTicket ticket, ITextChannel channel, SocketMessage message)
    {
        await channel.SendMessageAsync($"**{message.Author.Username}:** {message.Content}");
        LogMessage(ticket.ChannelId, message.Author.Id, message.Author.Username, message.Content, false, false);
    }

    public async Task<string> ReplyAsync(ITextChannel channel, SocketGuildUser staff, string content)
    {
        var ticket = Tickets.FindOne(t => t.ChannelId == channel.Id && t.Open);
        if (ticket is null) return "Channel này không phải ticket đang mở.";

        var user = await _client.Rest.GetUserAsync(ticket.UserId);
        if (user is null) return "Không thể tìm thấy người dùng.";

        try
        {
            var dm = await user.CreateDMChannelAsync();
            var embed = new EmbedBuilder()
                .WithAuthor(staff.DisplayName, staff.GetAvatarUrl() ?? staff.GetDefaultAvatarUrl())
                .WithDescription(content)
                .WithColor(Color.Green)
                .WithCurrentTimestamp()
                .Build();
            await dm.SendMessageAsync(embed: embed);

            var confirmEmbed = new EmbedBuilder()
                .WithAuthor($"Bạn → {user.Username}", staff.GetAvatarUrl() ?? staff.GetDefaultAvatarUrl())
                .WithDescription(content)
                .WithColor(Color.Green)
                .WithCurrentTimestamp()
                .Build();
            await channel.SendMessageAsync(embed: confirmEmbed);

            LogMessage(ticket.ChannelId, staff.Id, staff.DisplayName, content, true, false);
            return "✅ Đã gửi tin nhắn.";
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Không thể gửi DM cho user {UserId}", ticket.UserId);
            return "❌ Không thể gửi tin nhắn. Người dùng có thể đã tắt DM hoặc chặn bot.";
        }
    }

    public async Task<string> AnonymousReplyAsync(ITextChannel channel, string content)
    {
        var ticket = Tickets.FindOne(t => t.ChannelId == channel.Id && t.Open);
        if (ticket is null) return "Channel này không phải ticket đang mở.";

        var user = await _client.Rest.GetUserAsync(ticket.UserId);
        if (user is null) return "Không thể tìm thấy người dùng.";

        try
        {
            var dm = await user.CreateDMChannelAsync();
            var embed = new EmbedBuilder()
                .WithAuthor("Staff (Anonymous)")
                .WithDescription(content)
                .WithColor(Color.LightGrey)
                .WithCurrentTimestamp()
                .Build();
            await dm.SendMessageAsync(embed: embed);

            var confirmEmbed = new EmbedBuilder()
                .WithAuthor("Staff (Anonymous) → " + user.Username)
                .WithDescription(content)
                .WithColor(Color.LightGrey)
                .WithCurrentTimestamp()
                .Build();
            await channel.SendMessageAsync(embed: confirmEmbed);

            LogMessage(ticket.ChannelId, 0, "Staff (Anonymous)", content, true, true);
            return "✅ Đã gửi tin nhắn ẩn danh.";
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Không thể gửi anonymous reply cho user {UserId}", ticket.UserId);
            return "❌ Không thể gửi tin nhắn.";
        }
    }

    public async Task<string> CloseTicketAsync(ITextChannel channel, SocketGuildUser closer, string? reason, bool silent)
    {
        var ticket = Tickets.FindOne(t => t.ChannelId == channel.Id && t.Open);
        if (ticket is null) return "Channel này không phải ticket đang mở.";

        ticket.Open = false;
        ticket.ClosedAt = DateTime.UtcNow;
        ticket.CloseReason = reason;
        ticket.ClosedByStaffId = closer.Id;
        Tickets.Update(ticket);

        if (!silent)
        {
            var user = await _client.Rest.GetUserAsync(ticket.UserId);
            if (user is not null)
            {
                try
                {
                    var dm = await user.CreateDMChannelAsync();
                    var embed = new EmbedBuilder()
                        .WithTitle("Ticket đã đóng")
                        .WithDescription(reason ?? "Cảm ơn bạn đã liên hệ.")
                        .WithColor(Color.Red)
                        .WithCurrentTimestamp()
                        .Build();
                    await dm.SendMessageAsync(embed: embed);
                }
                catch { }
            }
        }

        var logEmbed = new EmbedBuilder()
            .WithTitle("Ticket đã đóng")
            .AddField("Người dùng", $"<@{ticket.UserId}> (`{ticket.UserId}`)", true)
            .AddField("Đóng bởi", closer.Mention, true)
            .AddField("Lý do", reason ?? "Không có", true)
            .WithColor(Color.Red)
            .WithCurrentTimestamp()
            .Build();

        await channel.SendMessageAsync(embed: logEmbed);
        await channel.DeleteAsync();

        return "✅ Đã đóng ticket.";
    }

    public bool IsBlocked(ulong guildId, ulong userId)
    {
        return Blocks.FindOne(b => b.GuildId == guildId && b.UserId == userId) is not null;
    }

    public string BlockUser(ulong guildId, ulong userId, string? reason, ulong? staffId)
    {
        if (IsBlocked(guildId, userId))
            return "Người dùng này đã bị chặn rồi.";

        Blocks.Insert(new ModmailBlock
        {
            GuildId = guildId,
            UserId = userId,
            Reason = reason,
            BlockedAt = DateTime.UtcNow,
            BlockedByStaffId = staffId,
        });

        return $"✅ Đã chặn <@{userId}> khỏi modmail.";
    }

    public string UnblockUser(ulong guildId, ulong userId)
    {
        var block = Blocks.FindOne(b => b.GuildId == guildId && b.UserId == userId);
        if (block is null) return "Người dùng này không bị chặn.";

        Blocks.Delete(block.Id);
        return $"✅ Đã bỏ chặn <@{userId}>.";
    }

    public List<ModmailBlock> GetBlockedUsers(ulong guildId)
    {
        return Blocks.Find(b => b.GuildId == guildId).ToList();
    }

    public Task<string> GetLogsAsync(SocketGuild guild, ulong userId)
    {
        var tickets = Tickets.Find(t => t.UserId == userId).OrderByDescending(t => t.CreatedAt).ToList();
        if (tickets.Count == 0)
            return Task.FromResult("Người dùng này chưa có ticket nào.");

        var lines = new List<string>();
        foreach (var t in tickets)
        {
            var status = t.Open ? "🟢 Đang mở" : "🔴 Đã đóng";
            var closedBy = t.ClosedByStaffId.HasValue ? $" bởi <@{t.ClosedByStaffId}>" : "";
            var reason = t.CloseReason is not null ? $" — {t.CloseReason}" : "";
            var subject = t.Subject is not null ? $" **{t.Subject}**" : "";
            var created = t.CreatedAt.ToString("dd/MM/yyyy HH:mm");
            lines.Add($"`{created}` {status}{subject}{closedBy}{reason}");
        }

        return Task.FromResult(string.Join('\n', lines.Take(20)));
    }

    private void LogMessage(ulong channelId, ulong authorId, string authorName, string content, bool isStaff, bool anonymous)
    {
        MessageLogs.Insert(new ModmailMessageLog
        {
            TicketChannelId = channelId,
            AuthorId = authorId,
            AuthorName = authorName,
            Content = content,
            IsStaff = isStaff,
            Anonymous = anonymous,
            Timestamp = DateTime.UtcNow,
        });
    }
}
