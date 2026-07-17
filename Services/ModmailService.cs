using Discord;
using Discord.Rest;
using Discord.WebSocket;
using Discord.Webhook;
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
    private ILiteCollection<ModmailWhitelist> Whitelist => _db.GetCollection<ModmailWhitelist>("modmail_whitelist");
    private ILiteCollection<ModmailMessageLog> MessageLogs => _db.GetCollection<ModmailMessageLog>("modmail_messages");
    private ILiteCollection<ModmailSnippet> Snippets => _db.GetCollection<ModmailSnippet>("modmail_snippets");
    private ILiteCollection<ModmailGuildConfig> GuildConfigs => _db.GetCollection<ModmailGuildConfig>("modmail_guild_configs");
    private ILiteCollection<ModmailNotification> Notifications => _db.GetCollection<ModmailNotification>("modmail_notifications");
    private ILiteCollection<ModmailPersistentNote> PersistentNotes => _db.GetCollection<ModmailPersistentNote>("modmail_persistent_notes");

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

        var cfg = GetGuildConfig(_config.Value.GuildId);
        if (cfg.DisableAllTickets || cfg.DisabledUserIds.Contains(message.Author.Id))
        {
            try { await message.Channel.SendMessageAsync("Modmail hiện đang tạm tắt."); }
            catch { }
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
        {
            if (ticket.Disabled)
            {
                try { await message.Channel.SendMessageAsync("Ticket của bạn đã bị tắt nhận tin nhắn."); }
                catch { }
                return;
            }

            if (ticket.SnoozedUntil is not null && ticket.SnoozedUntil > DateTime.UtcNow)
            {
                try
                {
                    await message.Channel.SendMessageAsync(
                        $"Ticket của bạn đang tạm gác, vui lòng đợi đến <t:{(long)ticket.SnoozedUntil.Value.Subtract(DateTime.UnixEpoch).TotalSeconds}:R>.");
                }
                catch { }
                return;
            }

            channel = guild.GetTextChannel(ticket.ChannelId);
        }

        if (channel is null)
        {
            if (cfg.DisableNewTickets)
            {
                try { await message.Channel.SendMessageAsync("Hiện không thể tạo ticket mới."); }
                catch { }
                return;
            }

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

        if (ticket is not null)
            await ForwardUserMessageToChannelAsync(ticket, channel, message);

        try
        {
            await message.Channel.SendMessageAsync("✅ Tin nhắn của bạn đã được gửi đến đội ngũ hỗ trợ.");
        }
        catch { }

        await NotifySubscribersAsync(ticket);
    }

    private async Task NotifySubscribersAsync(ModmailTicket? ticket)
    {
        if (ticket is null || ticket.SubscriberIds.Count == 0) return;

        var channel = _client.GetChannel(ticket.ChannelId) as ITextChannel;
        if (channel is null) return;

        foreach (var sid in ticket.SubscriberIds)
        {
            var user = _client.GetUser(sid);
            if (user is null) continue;
            try
            {
                var dm = await user.CreateDMChannelAsync();
                await dm.SendMessageAsync($"📩 Tin nhắn mới trong ticket <#{ticket.ChannelId}> (người dùng: {ticket.UserName})");
            }
            catch { }
        }
    }

    private async Task ForwardUserMessageToChannelAsync(ModmailTicket ticket, ITextChannel channel, SocketMessage message)
    {
        if (ticket.WebhookId is not null && ticket.WebhookToken is not null)
        {
            try
            {
                var whClient = new DiscordWebhookClient(ticket.WebhookId.Value, ticket.WebhookToken);
                await whClient.SendMessageAsync(
                    message.Content,
                    username: message.Author.Username,
                    avatarUrl: message.Author.GetAvatarUrl() ?? message.Author.GetDefaultAvatarUrl());
                LogMessage(ticket.ChannelId, message.Author.Id, message.Author.Username, message.Content, false, false);
                return;
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Webhook send failed, fallback to plain text");
            }
        }

        await channel.SendMessageAsync($"**{message.Author.Username}:** {message.Content}");
        LogMessage(ticket.ChannelId, message.Author.Id, message.Author.Username, message.Content, false, false);
    }

    private ModmailGuildConfig GetGuildConfig(ulong guildId)
    {
        var cfg = GuildConfigs.FindOne(c => c.GuildId == guildId);
        if (cfg is null)
        {
            cfg = new ModmailGuildConfig { GuildId = guildId };
            GuildConfigs.Insert(cfg);
        }
        return cfg;
    }

    // ─── Reply ─────────────────────────────────────────────────────────────────

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
            var dmMsg = await dm.SendMessageAsync(embed: embed);

            var confirmEmbed = new EmbedBuilder()
                .WithAuthor($"Bạn → {user.Username}", staff.GetAvatarUrl() ?? staff.GetDefaultAvatarUrl())
                .WithDescription(content)
                .WithColor(Color.Green)
                .WithCurrentTimestamp()
                .WithFooter($"ID: {dmMsg.Id}")
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

    public async Task<string> PlainReplyAsync(ITextChannel channel, SocketGuildUser staff, string content)
    {
        var ticket = Tickets.FindOne(t => t.ChannelId == channel.Id && t.Open);
        if (ticket is null) return "Channel này không phải ticket đang mở.";

        var user = await _client.Rest.GetUserAsync(ticket.UserId);
        if (user is null) return "Không thể tìm thấy người dùng.";

        try
        {
            var dm = await user.CreateDMChannelAsync();
            var dmMsg = await dm.SendMessageAsync($"**{staff.DisplayName}:** {content}");

            await channel.SendMessageAsync($"📨 **Bạn → {user.Username}:** {content}");
            LogMessage(ticket.ChannelId, staff.Id, staff.DisplayName, content, true, false);
            return "✅ Đã gửi tin nhắn dạng text.";
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Không thể gửi plain reply cho user {UserId}", ticket.UserId);
            return "❌ Không thể gửi tin nhắn.";
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
            var dmMsg = await dm.SendMessageAsync(embed: embed);

            var confirmEmbed = new EmbedBuilder()
                .WithAuthor("Staff (Anonymous) → " + user.Username)
                .WithDescription(content)
                .WithColor(Color.LightGrey)
                .WithCurrentTimestamp()
                .WithFooter($"ID: {dmMsg.Id}")
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

    public async Task<string> PlainAnonymousReplyAsync(ITextChannel channel, string content)
    {
        var ticket = Tickets.FindOne(t => t.ChannelId == channel.Id && t.Open);
        if (ticket is null) return "Channel này không phải ticket đang mở.";

        var user = await _client.Rest.GetUserAsync(ticket.UserId);
        if (user is null) return "Không thể tìm thấy người dùng.";

        try
        {
            var dm = await user.CreateDMChannelAsync();
            var dmMsg = await dm.SendMessageAsync($"**Staff (Anonymous):** {content}");

            await channel.SendMessageAsync($"📨 **Staff (Anonymous) → {user.Username}:** {content}");
            LogMessage(ticket.ChannelId, 0, "Staff (Anonymous)", content, true, true);
            return "✅ Đã gửi tin nhắn ẩn danh dạng text.";
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Không thể gửi plain anonymous reply cho user {UserId}", ticket.UserId);
            return "❌ Không thể gửi tin nhắn.";
        }
    }

    public async Task<string> ReplyWithSnippetAsync(ITextChannel channel, SocketGuildUser staff, string snippetName)
    {
        var snippet = Snippets.FindOne(s => s.GuildId == channel.Guild.Id && s.Name == snippetName);
        if (snippet is null) return $"Không tìm thấy snippet `{snippetName}`.";
        return await ReplyAsync(channel, staff, snippet.Content);
    }

    // ─── Edit / Delete ──────────────────────────────────────────────────────────

    public async Task<string> EditReplyAsync(ITextChannel channel, ulong messageId, string newContent)
    {
        var ticket = Tickets.FindOne(t => t.ChannelId == channel.Id && t.Open);
        if (ticket is null) return "Channel này không phải ticket đang mở.";

        var user = await _client.Rest.GetUserAsync(ticket.UserId);
        if (user is null) return "Không thể tìm thấy người dùng.";

        try
        {
            var dm = await user.CreateDMChannelAsync();
            var msg = await dm.GetMessageAsync(messageId);
            if (msg is not IUserMessage um)
                return "Không tìm thấy tin nhắn với ID này.";

            var embed = um.Embeds.FirstOrDefault()?.ToEmbedBuilder();
            if (embed is null) return "Tin nhắn không có embed để sửa.";

            embed.WithDescription(newContent);
            embed.WithFooter("Đã sửa");
            await um.ModifyAsync(m => m.Embed = embed.Build());

            LogMessage(ticket.ChannelId, 0, "System", $"Edited message {messageId}: {newContent}", true, false);
            return "✅ Đã sửa tin nhắn.";
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Không thể sửa reply {MessageId}", messageId);
            return "❌ Không thể sửa tin nhắn.";
        }
    }

    public async Task<string> DeleteReplyAsync(ITextChannel channel, ulong messageId)
    {
        var ticket = Tickets.FindOne(t => t.ChannelId == channel.Id && t.Open);
        if (ticket is null) return "Channel này không phải ticket đang mở.";

        var user = await _client.Rest.GetUserAsync(ticket.UserId);
        if (user is null) return "Không thể tìm thấy người dùng.";

        try
        {
            var dm = await user.CreateDMChannelAsync();
            var msg = await dm.GetMessageAsync(messageId);
            if (msg is not null)
                await msg.DeleteAsync();

            LogMessage(ticket.ChannelId, 0, "System", $"Deleted message {messageId}", true, false);
            return "✅ Đã xoá tin nhắn.";
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Không thể xoá reply {MessageId}", messageId);
            return "❌ Không thể xoá tin nhắn.";
        }
    }

    // ─── Ticket management ──────────────────────────────────────────────────────

    public async Task<string> SetTicketTitleAsync(ITextChannel channel, SocketGuildUser staff, string title)
    {
        var ticket = Tickets.FindOne(t => t.ChannelId == channel.Id && t.Open);
        if (ticket is null) return "Channel này không phải ticket đang mở.";

        ticket.Title = title;
        Tickets.Update(ticket);

        await channel.SendMessageAsync(embed: new EmbedBuilder()
            .WithTitle("Tiêu đề đã được cập nhật")
            .WithDescription($"\"{title}\"")
            .WithColor(Color.Blue)
            .WithCurrentTimestamp()
            .Build());

        return $"✅ Đã đặt tiêu đề: \"{title}\"";
    }

    public async Task<string> AddUserToTicketAsync(ITextChannel channel, IGuildUser target)
    {
        var ticket = Tickets.FindOne(t => t.ChannelId == channel.Id && t.Open);
        if (ticket is null) return "Channel này không phải ticket đang mở.";

        if (ticket.AddedUserIds.Contains(target.Id))
            return "Người dùng này đã được thêm.";

        ticket.AddedUserIds.Add(target.Id);
        Tickets.Update(ticket);

        try
        {
            await channel.AddPermissionOverwriteAsync(target, OverwritePermissions.InheritAll.Modify(
                viewChannel: PermValue.Allow, sendMessages: PermValue.Allow, readMessageHistory: PermValue.Allow));
        }
        catch { }

        return $"✅ Đã thêm {target.Mention} vào ticket.";
    }

    public async Task<string> RemoveUserFromTicketAsync(ITextChannel channel, IGuildUser target)
    {
        var ticket = Tickets.FindOne(t => t.ChannelId == channel.Id && t.Open);
        if (ticket is null) return "Channel này không phải ticket đang mở.";

        if (!ticket.AddedUserIds.Contains(target.Id))
            return "Người dùng này không có trong ticket.";

        ticket.AddedUserIds.Remove(target.Id);
        Tickets.Update(ticket);

        try
        {
            await channel.AddPermissionOverwriteAsync(target, OverwritePermissions.InheritAll.Modify(
                viewChannel: PermValue.Deny));
        }
        catch { }

        return $"✅ Đã xoá {target.Mention} khỏi ticket.";
    }

    public async Task<string> RepairTicketAsync(ITextChannel channel)
    {
        var ticket = Tickets.FindOne(t => t.ChannelId == channel.Id);
        if (ticket is null) return "Channel này không phải ticket.";

        var fixedItems = new List<string>();

        if (ticket.WebhookId is null || ticket.WebhookToken is null)
        {
            try
            {
                var webhook = await channel.CreateWebhookAsync("Modmail Forwarder");
                ticket.WebhookId = webhook.Id;
                ticket.WebhookToken = webhook.Token;
                fixedItems.Add("webhook");
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Không thể tạo webhook repair cho {Channel}", channel.Id);
            }
        }

        var guild = _client.GetGuild(_config.Value.GuildId);
        if (guild is not null)
        {
            var user = guild.GetUser(ticket.UserId);
            if (user is not null)
            {
                var perms = channel.GetPermissionOverwrite(user);
                if (perms is null)
                {
                    await channel.AddPermissionOverwriteAsync(user, OverwritePermissions.InheritAll.Modify(
                        viewChannel: PermValue.Allow, readMessageHistory: PermValue.Allow));
                    fixedItems.Add("permissions");
                }
            }
        }

        Tickets.Update(ticket);

        if (fixedItems.Count == 0)
            return "✅ Ticket không cần sửa chữa.";
        return $"✅ Đã sửa: {string.Join(", ", fixedItems)}.";
    }

    public ModmailTicket? GetTicketByChannel(ulong channelId)
    {
        return Tickets.FindOne(t => t.ChannelId == channelId);
    }

    // ─── Move ───────────────────────────────────────────────────────────────────

    public async Task<string> MoveTicketAsync(ITextChannel channel, ulong categoryId)
    {
        var ticket = Tickets.FindOne(t => t.ChannelId == channel.Id && t.Open);
        if (ticket is null) return "Channel này không phải ticket đang mở.";

        try
        {
            await channel.ModifyAsync(p => p.CategoryId = categoryId);
            return "✅ Đã di chuyển ticket sang category mới.";
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Không thể move ticket {Channel}", channel.Id);
            return "❌ Không thể di chuyển ticket.";
        }
    }

    // ─── Close ──────────────────────────────────────────────────────────────────

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

    // ─── Block / Whitelist ──────────────────────────────────────────────────────

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

        var whitelistEntry = Whitelist.FindOne(w => w.GuildId == guildId && w.UserId == userId);
        if (whitelistEntry is not null)
            Whitelist.Delete(whitelistEntry.Id);

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

    public bool IsWhitelisted(ulong guildId, ulong userId)
    {
        return Whitelist.FindOne(w => w.GuildId == guildId && w.UserId == userId) is not null;
    }

    public string WhitelistUser(ulong guildId, ulong userId, ulong? staffId)
    {
        if (IsWhitelisted(guildId, userId))
            return "Người dùng này đã có trong whitelist.";

        Whitelist.Insert(new ModmailWhitelist
        {
            GuildId = guildId,
            UserId = userId,
            AddedByStaffId = staffId,
        });

        var block = Blocks.FindOne(b => b.GuildId == guildId && b.UserId == userId);
        if (block is not null)
        {
            Blocks.Delete(block.Id);
            return $"✅ Đã whitelist <@{userId}> và bỏ chặn.";
        }

        return $"✅ Đã whitelist <@{userId}>.";
    }

    public string UnwhitelistUser(ulong guildId, ulong userId)
    {
        var entry = Whitelist.FindOne(w => w.GuildId == guildId && w.UserId == userId);
        if (entry is null) return "Người dùng này không có trong whitelist.";

        Whitelist.Delete(entry.Id);
        return $"✅ Đã xoá <@{userId}> khỏi whitelist.";
    }

    public List<ModmailWhitelist> GetWhitelistedUsers(ulong guildId)
    {
        return Whitelist.Find(w => w.GuildId == guildId).ToList();
    }

    // ─── Contact ────────────────────────────────────────────────────────────────

    public async Task<string> ContactAsync(ulong guildId, IUser user)
    {
        var guild = _client.GetGuild(guildId);
        if (guild is null) return "Không tìm thấy guild.";

        if (IsBlocked(guildId, user.Id))
            return "Người dùng này đã bị chặn.";

        var existing = Tickets.FindOne(t => t.UserId == user.Id && t.Open);
        if (existing is not null)
            return $"Người dùng đã có ticket mở tại <#{existing.ChannelId}>.";

        var ticket = new ModmailTicket
        {
            UserId = user.Id,
            UserName = user.Username,
            Open = true,
            CreatedAt = DateTime.UtcNow,
        };

        var restChannel = await guild.CreateTextChannelAsync(
            $"ticket-{user.Username}".ToLowerInvariant(),
            props => props.CategoryId = _config.Value.CategoryId == 0 ? null : _config.Value.CategoryId);

        ticket.ChannelId = restChannel.Id;
        Tickets.Insert(ticket);

        try
        {
            var webhook = await restChannel.CreateWebhookAsync("Modmail Forwarder");
            ticket.WebhookId = webhook.Id;
            ticket.WebhookToken = webhook.Token;
            Tickets.Update(ticket);
        }
        catch { }

        await restChannel.SendMessageAsync(embed: new EmbedBuilder()
            .WithTitle("Ticket được tạo bởi staff")
            .WithDescription($"Liên hệ {user.Mention} (`{user.Id}`)")
            .WithColor(Color.Green)
            .WithCurrentTimestamp()
            .Build());

        return $"✅ Đã tạo ticket cho {user.Mention} tại {restChannel.Mention}.";
    }

    public async Task<string> SelfContactAsync(SocketGuildUser staff, IUser target)
    {
        var guild = _client.GetGuild(_config.Value.GuildId);
        if (guild is null) return "Không tìm thấy guild.";

        var existing = Tickets.FindOne(t => t.UserId == target.Id && t.Open);
        if (existing is not null) return $"Người dùng đã có ticket mở tại <#{existing.ChannelId}>.";

        var ticket = new ModmailTicket
        {
            UserId = target.Id,
            UserName = target.Username,
            Open = true,
            CreatedAt = DateTime.UtcNow,
        };

        var restChannel = await guild.CreateTextChannelAsync(
            $"ticket-{target.Username}".ToLowerInvariant(),
            props => props.CategoryId = _config.Value.CategoryId == 0 ? null : _config.Value.CategoryId);

        ticket.ChannelId = restChannel.Id;
        Tickets.Insert(ticket);

        try
        {
            var webhook = await restChannel.CreateWebhookAsync("Modmail Forwarder");
            ticket.WebhookId = webhook.Id;
            ticket.WebhookToken = webhook.Token;
            Tickets.Update(ticket);
        }
        catch { }

        await restChannel.SendMessageAsync(embed: new EmbedBuilder()
            .WithTitle("Staff tự liên hệ")
            .WithDescription($"{staff.Mention} đã tạo ticket để liên hệ {target.Mention}")
            .WithColor(Color.Green)
            .WithCurrentTimestamp()
            .Build());

        return $"✅ Đã tạo ticket cho {target.Mention} tại {restChannel.Mention}.";
    }

    // ─── Note ───────────────────────────────────────────────────────────────────

    public async Task<string> NoteAsync(ITextChannel channel, SocketGuildUser staff, string content)
    {
        var ticket = Tickets.FindOne(t => t.ChannelId == channel.Id);
        if (ticket is null) return "Channel này không phải ticket.";

        await channel.SendMessageAsync(embed: new EmbedBuilder()
            .WithAuthor($"📝 Note — {staff.DisplayName}", staff.GetAvatarUrl() ?? staff.GetDefaultAvatarUrl())
            .WithDescription(content)
            .WithColor(Color.DarkGrey)
            .WithCurrentTimestamp()
            .Build());

        LogMessage(ticket.ChannelId, staff.Id, staff.DisplayName, $"[NOTE] {content}", true, false);
        return "✅ Đã thêm note.";
    }

    public async Task<string> PersistentNoteAsync(ITextChannel channel, SocketGuildUser staff, string content)
    {
        var ticket = Tickets.FindOne(t => t.ChannelId == channel.Id);
        if (ticket is null) return "Channel này không phải ticket.";

        var existing = PersistentNotes.FindOne(p => p.TicketChannelId == channel.Id);
        if (existing is not null)
        {
            existing.Content = content;
            existing.UpdatedAt = DateTime.UtcNow;
            existing.LastEditorId = staff.Id;
            PersistentNotes.Update(existing);
        }
        else
        {
            PersistentNotes.Insert(new ModmailPersistentNote
            {
                TicketChannelId = channel.Id,
                Content = content,
                LastEditorId = staff.Id,
            });
        }

        var msg = await channel.SendMessageAsync(embed: new EmbedBuilder()
            .WithAuthor($"📌 Persistent Note — {staff.DisplayName}", staff.GetAvatarUrl() ?? staff.GetDefaultAvatarUrl())
            .WithDescription(content)
            .WithColor(Color.DarkGrey)
            .WithFooter("Note này sẽ hiển thị lại khi có tin nhắn mới")
            .WithCurrentTimestamp()
            .Build());

        if (existing is null)
        {
            await channel.SendMessageAsync("💡 Persistent note đã được ghim. Dùng `/modmail note persistent` để cập nhật.");
        }

        LogMessage(ticket.ChannelId, staff.Id, staff.DisplayName, $"[PERSISTENT NOTE] {content}", true, false);
        return "✅ Đã thêm persistent note.";
    }

    // ─── Snooze ─────────────────────────────────────────────────────────────────

    public async Task<string> SnoozeTicketAsync(ITextChannel channel, TimeSpan duration)
    {
        var ticket = Tickets.FindOne(t => t.ChannelId == channel.Id && t.Open);
        if (ticket is null) return "Channel này không phải ticket đang mở.";

        ticket.SnoozedUntil = DateTime.UtcNow + duration;
        Tickets.Update(ticket);

        await channel.SendMessageAsync(embed: new EmbedBuilder()
            .WithTitle("Ticket tạm gác")
            .WithDescription($"Ticket sẽ tự động mở lại sau <t:{(long)ticket.SnoozedUntil.Value.Subtract(DateTime.UnixEpoch).TotalSeconds}:R>.")
            .WithColor(Color.Orange)
            .WithCurrentTimestamp()
            .Build());

        return $"✅ Đã gác ticket đến {ticket.SnoozedUntil:HH:mm} UTC.";
    }

    public async Task<string> UnsnoozeTicketAsync(ITextChannel channel)
    {
        var ticket = Tickets.FindOne(t => t.ChannelId == channel.Id && t.Open);
        if (ticket is null) return "Channel này không phải ticket đang mở.";

        if (ticket.SnoozedUntil is null)
            return "Ticket này không đang gác.";

        ticket.SnoozedUntil = null;
        Tickets.Update(ticket);

        await channel.SendMessageAsync("✅ Đã mở lại ticket.");
        return "✅ Đã mở lại ticket.";
    }

    public Task<string> GetSnoozedTicketsAsync(SocketGuild guild)
    {
        var snoozed = Tickets.Find(t => t.Open && t.SnoozedUntil != null && t.SnoozedUntil > DateTime.UtcNow).ToList();
        if (snoozed.Count == 0)
            return Task.FromResult("Không có ticket nào đang gác.");

        var lines = snoozed.Select(t =>
        {
            var remaining = (int)(t.SnoozedUntil!.Value - DateTime.UtcNow).TotalMinutes;
            var channel = guild.GetTextChannel(t.ChannelId);
            return $"• {(channel is not null ? MentionUtils.MentionChannel(channel.Id) : $"`{t.ChannelId}`")} — {t.UserName} — còn {remaining}ph";
        });

        return Task.FromResult(string.Join('\n', lines));
    }

    public string ClearSnoozedTickets()
    {
        var snoozed = Tickets.Find(t => t.Open && t.SnoozedUntil != null && t.SnoozedUntil > DateTime.UtcNow).ToList();
        foreach (var t in snoozed)
        {
            t.SnoozedUntil = null;
            Tickets.Update(t);
        }
        return $"✅ Đã xoá gác cho {snoozed.Count} ticket(s).";
    }

    // ─── Notifications ──────────────────────────────────────────────────────────

    public string ToggleNotify(ulong guildId, ulong staffId, ulong channelId)
    {
        var existing = Notifications.FindOne(n => n.GuildId == guildId && n.UserId == staffId && n.TicketChannelId == channelId);
        if (existing is not null)
        {
            Notifications.Delete(existing.Id);
            return "✅ Đã tắt thông báo cho ticket này.";
        }

        Notifications.Insert(new ModmailNotification
        {
            GuildId = guildId,
            UserId = staffId,
            TicketChannelId = channelId,
        });
        return "✅ Đã bật thông báo cho ticket này.";
    }

    // ─── Subscribe (subscriber gets DM when user replies) ───────────────────────

    public string ToggleSubscribe(ulong channelId, ulong userId)
    {
        var ticket = Tickets.FindOne(t => t.ChannelId == channelId);
        if (ticket is null) return "Không tìm thấy ticket.";

        if (ticket.SubscriberIds.Contains(userId))
        {
            ticket.SubscriberIds.Remove(userId);
            Tickets.Update(ticket);
            return "✅ Đã huỷ đăng ký nhận thông báo.";
        }

        ticket.SubscriberIds.Add(userId);
        Tickets.Update(ticket);
        return "✅ Đã đăng ký nhận thông báo khi người dùng trả lời.";
    }

    // ─── NSFW / SFW ─────────────────────────────────────────────────────────────

    public async Task<string> SetNsfwAsync(ITextChannel channel)
    {
        var ticket = Tickets.FindOne(t => t.ChannelId == channel.Id && t.Open);
        if (ticket is null) return "Channel này không phải ticket đang mở.";

        ticket.IsNsfw = true;
        Tickets.Update(ticket);

        try { await channel.ModifyAsync(p => p.IsNsfw = true); }
        catch { }

        return "✅ Đã đánh dấu ticket là NSFW.";
    }

    public async Task<string> SetSfwAsync(ITextChannel channel)
    {
        var ticket = Tickets.FindOne(t => t.ChannelId == channel.Id && t.Open);
        if (ticket is null) return "Channel này không phải ticket đang mở.";

        ticket.IsNsfw = false;
        Tickets.Update(ticket);

        try { await channel.ModifyAsync(p => p.IsNsfw = false); }
        catch { }

        return "✅ Đã đánh dấu ticket là SFW.";
    }

    // ─── Links ──────────────────────────────────────────────────────────────────

    public string GetMessageLink(ulong guildId, ulong channelId, ulong messageId)
    {
        return $"https://discord.com/channels/{guildId}/{channelId}/{messageId}";
    }

    public string GetLogLink(ulong guildId, ulong channelId)
    {
        return $"https://discord.com/channels/{guildId}/{channelId}";
    }

    // ─── Enable / Disable ───────────────────────────────────────────────────────

    public string IsModmailEnabled(ulong guildId, ulong? userId = null)
    {
        var cfg = GetGuildConfig(guildId);
        if (userId is null)
        {
            if (cfg.DisableAllTickets) return "Modmail đang tắt hoàn toàn.";
            if (cfg.DisableNewTickets) return "Không thể tạo ticket mới.";
            return "Modmail đang bật.";
        }

        if (cfg.DisabledUserIds.Contains(userId.Value)) return "Người dùng này đã bị tắt modmail.";
        return "Người dùng này có thể dùng modmail.";
    }

    public string EnableModmail(ulong guildId, ulong? userId = null)
    {
        var cfg = GetGuildConfig(guildId);

        if (userId is null)
        {
            cfg.DisableAllTickets = false;
            cfg.DisableNewTickets = false;
            GuildConfigs.Update(cfg);
            return "✅ Đã bật modmail.";
        }

        cfg.DisabledUserIds.Remove(userId.Value);
        GuildConfigs.Update(cfg);

        var ticket = Tickets.FindOne(t => t.UserId == userId.Value && t.Open);
        if (ticket is not null)
        {
            ticket.Disabled = false;
            Tickets.Update(ticket);
        }

        return $"✅ Đã bật modmail cho <@{userId}>.";
    }

    public string DisableModmail(ulong guildId, bool disableNew, bool disableAll, ulong? userId = null)
    {
        var cfg = GetGuildConfig(guildId);

        if (userId is not null)
        {
            if (!cfg.DisabledUserIds.Contains(userId.Value))
                cfg.DisabledUserIds.Add(userId.Value);
            GuildConfigs.Update(cfg);

            var ticket = Tickets.FindOne(t => t.UserId == userId.Value && t.Open);
            if (ticket is not null)
            {
                ticket.Disabled = true;
                Tickets.Update(ticket);
            }

            return $"✅ Đã tắt modmail cho <@{userId}>.";
        }

        if (disableAll) cfg.DisableAllTickets = true;
        if (disableNew) cfg.DisableNewTickets = true;
        GuildConfigs.Update(cfg);
        return "✅ Đã tắt modmail.";
    }

    // ─── Logs ───────────────────────────────────────────────────────────────────

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
            var snoozed = t.SnoozedUntil is not null && t.SnoozedUntil > DateTime.UtcNow ? " ⏸️" : "";
            lines.Add($"`{created}` {status}{snoozed}{subject}{closedBy}{reason}");
        }

        return Task.FromResult(string.Join('\n', lines.Take(20)));
    }

    public string GetLogsClosedBy(ulong guildId, ulong staffId)
    {
        var tickets = Tickets.Find(t => t.ClosedByStaffId == staffId).OrderByDescending(t => t.ClosedAt).ToList();
        if (tickets.Count == 0)
            return "Staff này chưa đóng ticket nào.";

        var lines = tickets.Select(t =>
            $"• <@{t.UserId}> — {t.CloseReason ?? "Không có lý do"} — {t.ClosedAt:dd/MM/yyyy HH:mm}");
        return string.Join('\n', lines.Take(20));
    }

    public string GetLogsByKeyword(ulong guildId, string keyword)
    {
        var tickets = Tickets.Find(t => true).ToList()
            .Where(t =>
                t.CloseReason?.Contains(keyword, StringComparison.OrdinalIgnoreCase) == true ||
                t.Subject?.Contains(keyword, StringComparison.OrdinalIgnoreCase) == true ||
                t.UserName?.Contains(keyword, StringComparison.OrdinalIgnoreCase) == true)
            .OrderByDescending(t => t.CreatedAt)
            .ToList();

        if (tickets.Count == 0)
            return $"Không tìm thấy ticket nào với từ khoá \"{keyword}\".";

        var lines = tickets.Select(t =>
            $"• <@{t.UserId}> — {t.UserName} — {t.CreatedAt:dd/MM/yyyy HH:mm}");
        return string.Join('\n', lines.Take(20));
    }

    public string DeleteLogEntry(ulong guildId, ObjectId logId)
    {
        var log = MessageLogs.FindById(logId);
        if (log is null) return "Không tìm thấy log.";

        MessageLogs.Delete(logId);
        return "✅ Đã xoá log entry.";
    }

    public string GetLogsResponded(ulong channelId)
    {
        var responded = MessageLogs.Find(l => l.TicketChannelId == channelId && l.IsStaff).Any();
        return responded ? "✅ Staff đã trả lời trong ticket này." : "❌ Chưa có staff nào trả lời.";
    }

    public string SearchLogs(string keyword)
    {
        var logs = MessageLogs.FindAll().ToList()
            .Where(l => l.Content.Contains(keyword, StringComparison.OrdinalIgnoreCase))
            .OrderByDescending(l => l.Timestamp)
            .Take(20)
            .ToList();

        if (logs.Count == 0)
            return $"Không tìm thấy log nào với từ khoá \"{keyword}\".";

        var lines = logs.Select(l =>
            $"• {l.Timestamp:dd/MM HH:mm} — {l.AuthorName}: {l.Content[..Math.Min(l.Content.Length, 100)]}");
        return string.Join('\n', lines);
    }

    // ─── Snippets ───────────────────────────────────────────────────────────────

    public string CreateSnippet(ulong guildId, string name, string content)
    {
        var existing = Snippets.FindOne(s => s.GuildId == guildId && s.Name == name);
        if (existing is not null)
        {
            existing.Content = content;
            Snippets.Update(existing);
            return $"✅ Đã cập nhật snippet `{name}`.";
        }

        Snippets.Insert(new ModmailSnippet
        {
            GuildId = guildId,
            Name = name,
            Content = content,
        });

        return $"✅ Đã tạo snippet `{name}`.";
    }

    public string EditSnippet(ulong guildId, string name, string newContent)
    {
        var snippet = Snippets.FindOne(s => s.GuildId == guildId && s.Name == name);
        if (snippet is null) return $"Không tìm thấy snippet `{name}`.";

        snippet.Content = newContent;
        Snippets.Update(snippet);
        return $"✅ Đã cập nhật snippet `{name}`.";
    }

    public string DeleteSnippet(ulong guildId, string name)
    {
        var snippet = Snippets.FindOne(s => s.GuildId == guildId && s.Name == name);
        if (snippet is null) return $"Không tìm thấy snippet `{name}`.";

        Snippets.Delete(snippet.Id);
        return $"✅ Đã xoá snippet `{name}`.";
    }

    public string? GetSnippetRaw(ulong guildId, string name)
    {
        return Snippets.FindOne(s => s.GuildId == guildId && s.Name == name)?.Content;
    }

    public List<ModmailSnippet> GetSnippets(ulong guildId)
    {
        return Snippets.Find(s => s.GuildId == guildId).ToList();
    }

    public string[] AutocompleteSnippets(ulong guildId, string? startsWith = null)
    {
        var query = Snippets.Find(s => s.GuildId == guildId);
        if (!string.IsNullOrWhiteSpace(startsWith))
            query = query.Where(s => s.Name.StartsWith(startsWith, StringComparison.OrdinalIgnoreCase));
        return query.OrderBy(s => s.Name).Take(10).Select(s => s.Name).ToArray();
    }

    // ─── Message logs ───────────────────────────────────────────────────────────

    public List<ModmailMessageLog> GetMessageLogs(ulong channelId, int limit = 50)
    {
        return MessageLogs.Find(l => l.TicketChannelId == channelId)
            .OrderByDescending(l => l.Timestamp)
            .Take(limit)
            .ToList();
    }

    public ulong? GetTicketUserIdByChannel(ulong channelId)
    {
        return Tickets.FindOne(t => t.ChannelId == channelId)?.UserId;
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
