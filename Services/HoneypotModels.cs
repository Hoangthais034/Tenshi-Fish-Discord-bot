using LiteDB;

#pragma warning disable CS8618

namespace DiscordBot.Services;

public sealed class HoneypotGuildSettings
{
    [BsonId] public ObjectId Id { get; set; }
    public ulong GuildId { get; set; }
    public List<HoneypotChannelInfo> TrapChannels { get; set; } = new();
    public ulong LogChannelId { get; set; }
    public HoneypotAction Action { get; set; } = HoneypotAction.Kick;
    public HoneypotExperiments Experiments { get; set; }
    public string? DmMessage { get; set; }
    public string? WarningMessage { get; set; }
}

public sealed class HoneypotChannelInfo
{
    public ulong ChannelId { get; set; }
    public ulong? WarningMessageId { get; set; }
    public int TriggerCount { get; set; }
}

public enum HoneypotAction
{
    Disabled,
    Kick,
    Ban,
    Softban,
}

[Flags]
public enum HoneypotExperiments
{
    None = 0,
    TimeoutFirst = 1,
    NoDm = 2,
    NoWarningMsg = 4,
    RandomChannelName = 8,
}
