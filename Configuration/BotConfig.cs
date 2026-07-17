namespace DiscordBot.Configuration;

public sealed class DiscordConfig
{
    public string Token { get; set; } = string.Empty;
    public ulong OwnerId { get; set; }
}

public sealed class LavalinkConfig
{
    public string BaseAddress { get; set; } = "http://localhost:2333";
    public string Password { get; set; } = "youshallnotpass";
}

public sealed class ModmailConfig
{
    public ulong GuildId { get; set; }
    public ulong CategoryId { get; set; }
}
