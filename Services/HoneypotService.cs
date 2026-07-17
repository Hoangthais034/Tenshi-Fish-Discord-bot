using Discord;
using Discord.WebSocket;
using DiscordBot.Configuration;
using LiteDB;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace DiscordBot.Services;

public sealed class HoneypotGuildSettings
{
    public ulong GuildId { get; set; }
    public ulong TrapChannelId { get; set; }
    public ulong LogChannelId { get; set; }
    public HoneypotAction Action { get; set; } = HoneypotAction.Kick;
}

public sealed class HoneypotService
{
    private readonly LiteDatabase _db;
    private readonly ILogger<HoneypotService> _logger;

    public HoneypotService(LiteDatabase db, ILogger<HoneypotService> logger)
    {
        _db = db;
        _logger = logger;
    }

    private ILiteCollection<HoneypotGuildSettings> Settings =>
        _db.GetCollection<HoneypotGuildSettings>("honeypot_settings");

    public void RegisterHandlers(DiscordSocketClient client)
    {
        client.MessageReceived += OnMessageReceivedAsync;
    }

    public HoneypotGuildSettings GetOrCreate(ulong guildId)
    {
        var existing = Settings.FindOne(s => s.GuildId == guildId);
        if (existing is not null) return existing;

        var fresh = new HoneypotGuildSettings { GuildId = guildId };
        Settings.Insert(fresh);
        return fresh;
    }

    public void Save(HoneypotGuildSettings settings)
    {
        Settings.Upsert(settings);
    }

    private async Task OnMessageReceivedAsync(SocketMessage message)
    {
        if (message.Author.IsBot) return;
        if (message.Channel is not SocketTextChannel channel) return;

        var settings = Settings.FindOne(s => s.GuildId == channel.Guild.Id);
        if (settings is null || settings.TrapChannelId == 0) return;
        if (channel.Id != settings.TrapChannelId) return;
        if (settings.Action == HoneypotAction.Disabled) return;

        var guildUser = message.Author as SocketGuildUser;
        if (guildUser is null) return;

        try
        {
            await message.DeleteAsync();

            if (settings.Action == HoneypotAction.Ban)
                await channel.Guild.AddBanAsync(guildUser, pruneDays: 1, reason: "Honeypot triggered");
            else
                await guildUser.KickAsync(reason: "Honeypot triggered");

            _logger.LogWarning("Honeypot triggered by {User} in guild {Guild}", guildUser.Id, channel.Guild.Id);

            if (settings.LogChannelId != 0 &&
                channel.Guild.GetTextChannel(settings.LogChannelId) is { } logChannel)
            {
                await logChannel.SendMessageAsync(embed: new EmbedBuilder()
                    .WithTitle("Honeypot triggered")
                    .WithColor(Color.Red)
                    .AddField("User", $"{guildUser.Mention} (`{guildUser.Id}`)", true)
                    .AddField("Action", settings.Action.ToString(), true)
                    .WithTimestamp(DateTimeOffset.UtcNow)
                    .Build());
            }
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Lỗi khi xử lý honeypot trigger trong guild {Guild}", channel.Guild.Id);
        }
    }
}
