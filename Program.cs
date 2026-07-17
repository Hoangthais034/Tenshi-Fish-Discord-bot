using Discord;
using Discord.Interactions;
using Discord.WebSocket;
using DiscordBot.Configuration;
using DiscordBot.Services;
using Lavalink4NET.Extensions;
using LiteDB;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

var builder = Host.CreateApplicationBuilder(args);

// appsettings.{env}.json + env vars (Discord__Token) tự động load
// Thứ tự ưu tiên: env var > appsettings.{env}.json > appsettings.json

builder.Services.Configure<DiscordBot.Configuration.DiscordConfig>(builder.Configuration.GetSection("Discord"));
builder.Services.Configure<LavalinkConfig>(builder.Configuration.GetSection("Lavalink"));
builder.Services.Configure<HoneypotConfig>(builder.Configuration.GetSection("Honeypot"));
builder.Services.Configure<ModmailConfig>(builder.Configuration.GetSection("Modmail"));

builder.Services.AddSingleton(new DiscordSocketConfig
{
    GatewayIntents = GatewayIntents.AllUnprivileged
        | GatewayIntents.MessageContent
        | GatewayIntents.GuildMembers,
    AlwaysDownloadUsers = true
});
builder.Services.AddSingleton<DiscordSocketClient>();
builder.Services.AddSingleton(sp =>
    new InteractionService(sp.GetRequiredService<DiscordSocketClient>()));

builder.Services.AddLavalink();
builder.Services.AddSingleton<LiteDatabase>(_ => new LiteDatabase("bot-data.db"));

builder.Services.AddSingleton<HoneypotService>();
builder.Services.AddSingleton<ModmailService>();
builder.Services.AddSingleton<MusicService>();

builder.Services.AddHostedService<BotWorker>();

var app = builder.Build();
await app.RunAsync();

public sealed class BotWorker : IHostedService
{
    private readonly DiscordSocketClient _client;
    private readonly InteractionService _interactions;
    private readonly IServiceProvider _services;
    private readonly IOptions<DiscordBot.Configuration.DiscordConfig> _config;
    private readonly MusicService _music;
    private readonly HoneypotService _honeypot;
    private readonly ModmailService _modmail;
    private readonly ILogger<BotWorker> _logger;

    public BotWorker(
        DiscordSocketClient client,
        InteractionService interactions,
        IServiceProvider services,
        IOptions<DiscordBot.Configuration.DiscordConfig> config,
        MusicService music,
        HoneypotService honeypot,
        ModmailService modmail,
        ILogger<BotWorker> logger)
    {
        _client = client;
        _interactions = interactions;
        _services = services;
        _config = config;
        _music = music;
        _honeypot = honeypot;
        _modmail = modmail;
        _logger = logger;
    }

    public async Task StartAsync(CancellationToken cancellationToken)
    {
        _client.Log += msg => { _logger.LogInformation("{Source}: {Message}", msg.Source, msg.Message); return Task.CompletedTask; };

        _client.Ready += async () =>
        {
            await _interactions.AddModulesAsync(typeof(Program).Assembly, _services);
            await _interactions.RegisterCommandsGloballyAsync();
            _logger.LogInformation("Bot ready: {User}", _client.CurrentUser);
        };

        _client.InteractionCreated += async interaction =>
        {
            var ctx = new SocketInteractionContext(_client, interaction);
            await _interactions.ExecuteCommandAsync(ctx, _services);
        };

        _honeypot.RegisterHandlers(_client);
        _modmail.RegisterHandlers(_client);
        _music.RegisterHandlers(_client);

        await _client.LoginAsync(TokenType.Bot, _config.Value.Token);
        await _client.StartAsync();
    }

    public async Task StopAsync(CancellationToken cancellationToken)
    {
        await _client.LogoutAsync();
        await _client.StopAsync();
    }
}
