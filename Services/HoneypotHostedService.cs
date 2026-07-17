using Discord;
using Discord.WebSocket;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace DiscordBot.Services;

public sealed class HoneypotHostedService : BackgroundService
{
    private readonly DiscordSocketClient _client;
    private readonly HoneypotService _honeypot;
    private readonly ILogger<HoneypotHostedService> _logger;

    public HoneypotHostedService(
        DiscordSocketClient client,
        HoneypotService honeypot,
        ILogger<HoneypotHostedService> logger)
    {
        _client = client;
        _honeypot = honeypot;
        _logger = logger;
    }

    private static readonly string[] RandomNames =
    {
        "welcome", "general", "chat", "talk", "lounge",
        "water-cooler", "random", "discussion", "chit-chat",
        "banter", "gossip", "hangout", "meetup", "coffee-talk",
    };

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            await Task.Delay(TimeSpan.FromHours(1), stoppingToken);

            try
            {
                await RandomizeChannelNamesAsync();
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "HoneypotHostedService error");
            }
        }
    }

    private async Task RandomizeChannelNamesAsync()
    {
        var guilds = _client.Guilds;
        foreach (var guild in guilds)
        {
            var settings = _honeypot.GetOrCreate(guild.Id);
            if (!settings.Experiments.HasFlag(HoneypotExperiments.RandomChannelName))
                continue;

            foreach (var trap in settings.TrapChannels)
            {
                var channel = guild.GetTextChannel(trap.ChannelId);
                if (channel is null) continue;

                var name = RandomNames[Random.Shared.Next(RandomNames.Length)];
                try
                {
                    await channel.ModifyAsync(p => p.Name = name);
                }
                catch (Exception ex)
                {
                    _logger.LogWarning(ex, "Failed to rename trap channel {Channel}", trap.ChannelId);
                }
            }
        }
    }
}
