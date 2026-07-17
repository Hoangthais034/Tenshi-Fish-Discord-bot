using Discord;
using Discord.Interactions;
using Discord.WebSocket;
using DiscordBot.Configuration;
using DiscordBot.Services;
using DotNetEnv;
using Lavalink4NET.Extensions;
using LiteDB;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

// Load .env file trước khi build config (chứa token, secret — an toàn, đã trong .gitignore)
Env.Load();

var builder = Host.CreateApplicationBuilder(args);

// appsettings.{env}.json + env vars tự động load

builder.Services.Configure<DiscordBot.Configuration.DiscordConfig>(builder.Configuration.GetSection("Discord"));
builder.Services.Configure<LavalinkConfig>(builder.Configuration.GetSection("Lavalink"));
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

builder.Services.AddMemoryCache();
builder.Services.AddSingleton<RateLimitService>();

builder.Services.AddSingleton<HoneypotService>();
builder.Services.AddSingleton<ModmailService>();
builder.Services.AddSingleton<MusicService>();

builder.Services.AddHostedService<BotWorker>();
builder.Services.AddHostedService<HoneypotHostedService>();

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

    private async Task HandleInteractionErrorAsync(ICommandInfo? command, IInteractionContext context, IResult result)
    {
        if (result.IsSuccess) return;

        _logger.LogError("Command {Command} error: {Error} | User: {User} | Guild: {Guild}",
            command?.Name ?? "?",
            result.ErrorReason,
            context.User.Id,
            context.Guild?.Id);

        if (context.Interaction.Type == InteractionType.ApplicationCommandAutocomplete)
            return;

        if (!context.Interaction.HasResponded)
        {
            await context.Interaction.RespondAsync(
                "❌ Có lỗi xảy ra khi thực thi lệnh.", ephemeral: true);
        }
    }

    public async Task StartAsync(CancellationToken cancellationToken)
    {
        _client.Log += msg => { _logger.LogInformation("{Source}: {Message}", msg.Source, msg.Message); return Task.CompletedTask; };

        _client.Ready += async () =>
        {
            try
            {
                // Xoá toàn bộ commands cũ (global + guild-specific)
                await _client.Rest.BulkOverwriteGlobalCommands(Array.Empty<ApplicationCommandProperties>());
                _logger.LogInformation("Đã xoá global commands cũ");

                foreach (var guild in _client.Guilds)
                {
                    await _client.Rest.BulkOverwriteGuildCommands(Array.Empty<ApplicationCommandProperties>(), guild.Id);
                    _logger.LogInformation("Đã xoá guild commands cho {Guild}", guild.Id);
                }

                await _interactions.AddModulesAsync(typeof(Program).Assembly, _services);
                _logger.LogInformation("Đã load {Count} modules", _interactions.Modules.Count);

                await _interactions.RegisterCommandsGloballyAsync();
                _logger.LogInformation("Đã register slash commands global");
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Lỗi khi register slash commands");
            }

            _logger.LogInformation("Bot ready: {User}", _client.CurrentUser);
        };

        _interactions.InteractionExecuted += HandleInteractionErrorAsync;

        _client.InteractionCreated += async interaction =>
        {
            try
            {
                var ctx = new SocketInteractionContext(_client, interaction);
                var result = await _interactions.ExecuteCommandAsync(ctx, _services);

                if (!result.IsSuccess)
                {
                    var cmdName = interaction switch
                    {
                        SocketSlashCommand s => s.CommandName,
                        SocketAutocompleteInteraction a => a.Data.CommandName,
                        SocketMessageCommand m => m.CommandName,
                        SocketUserCommand u => u.CommandName,
                        _ => "?",
                    };

                    _logger.LogWarning(
                        "Không tìm thấy handler: /{Name} | Type: {Type} | User: {User} | Guild: {Guild}",
                        cmdName, interaction.Type, interaction.User.Id, interaction.GuildId);
                }
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Lỗi xử lý interaction /{Name} from {User}",
                    interaction switch
                    {
                        SocketSlashCommand s => s.CommandName,
                        SocketAutocompleteInteraction a => a.Data.CommandName,
                        _ => "?",
                    },
                    interaction.User.Id);
            }
        };

        _honeypot.RegisterHandlers(_client);
        _modmail.RegisterHandlers(_client);
        _music.RegisterHandlers(_client);

        await _client.LoginAsync(TokenType.Bot, _config.Value.Token);
        await _client.StartAsync();
    }

    public async Task StopAsync(CancellationToken cancellationToken)
    {
        try
        {
            _logger.LogInformation("Shutting down...");

            var audio = _services.GetService<Lavalink4NET.IAudioService>();
            if (audio is not null)
                await audio.StopAsync(cancellationToken);

            await _client.LogoutAsync();
            await _client.StopAsync();
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error during shutdown");
        }
    }
}
