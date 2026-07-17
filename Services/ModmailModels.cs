#pragma warning disable CS8618
using LiteDB;

namespace DiscordBot.Services;

public sealed class ModmailTicket
{
    [BsonId] public ObjectId Id { get; set; }
    public ulong ChannelId { get; set; }
    public ulong UserId { get; set; }
    public bool Open { get; set; } = true;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? ClosedAt { get; set; }
    public DateTime? SnoozedUntil { get; set; }
    public ulong? ClaimedByStaffId { get; set; }
    public string? Subject { get; set; }
    public string? Title { get; set; }
    public string? CloseReason { get; set; }
    public ulong? ClosedByStaffId { get; set; }
    public ulong? WebhookId { get; set; }
    public string? WebhookToken { get; set; }
    public string UserName { get; set; } = "";
    public bool IsNsfw { get; set; }
    public bool Disabled { get; set; }
    public List<ulong> AddedUserIds { get; set; } = new();
    public List<ulong> SubscriberIds { get; set; } = new();
}

public sealed class ModmailBlock
{
    [BsonId] public ObjectId Id { get; set; }
    public ulong GuildId { get; set; }
    public ulong UserId { get; set; }
    public string? Reason { get; set; }
    public DateTime BlockedAt { get; set; } = DateTime.UtcNow;
    public ulong? BlockedByStaffId { get; set; }
}

public sealed class ModmailWhitelist
{
    [BsonId] public ObjectId Id { get; set; }
    public ulong GuildId { get; set; }
    public ulong UserId { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public ulong? AddedByStaffId { get; set; }
}

public sealed class ModmailMessageLog
{
    [BsonId] public ObjectId Id { get; set; }
    public ulong TicketChannelId { get; set; }
    public ulong AuthorId { get; set; }
    public string AuthorName { get; set; } = "";
    public string Content { get; set; } = "";
    public bool IsStaff { get; set; }
    public bool Anonymous { get; set; }
    public DateTime Timestamp { get; set; } = DateTime.UtcNow;
}

public sealed class ModmailSnippet
{
    [BsonId] public ObjectId Id { get; set; }
    public ulong GuildId { get; set; }
    public string Name { get; set; } = "";
    public string Content { get; set; } = "";
}

public sealed class ModmailGuildConfig
{
    [BsonId] public ObjectId Id { get; set; }
    public ulong GuildId { get; set; }
    public bool DisableNewTickets { get; set; }
    public bool DisableAllTickets { get; set; }
    public List<ulong> DisabledUserIds { get; set; } = new();
}

public sealed class ModmailNotification
{
    [BsonId] public ObjectId Id { get; set; }
    public ulong GuildId { get; set; }
    public ulong UserId { get; set; }
    public ulong TicketChannelId { get; set; }
    public bool NotifyOnReply { get; set; } = true;
}

public sealed class ModmailPersistentNote
{
    [BsonId] public ObjectId Id { get; set; }
    public ulong TicketChannelId { get; set; }
    public string Content { get; set; } = "";
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
    public ulong? LastEditorId { get; set; }
}
