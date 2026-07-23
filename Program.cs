using Discord;
using Discord.Interactions;
using Discord.WebSocket;
using DiscordBot.Configuration;
using DiscordBot.Services;
using DotNetEnv;
using Lavalink4NET;
using Lavalink4NET.Extensions;
using LiteDB;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

Env.Load();

var builder = Host.CreateApplicationBuilder(args);

// Map DISCORD_TOKEN -> Discord:Token (DotNetEnv load thành env var, nhưng config cần key dạng Section:Key)
var discordToken = Environment.GetEnvironmentVariable("DISCORD_TOKEN");
if (!string.IsNullOrEmpty(discordToken))
    builder.Configuration["Discord:Token"] = discordToken;

var devGuildId = Environment.GetEnvironmentVariable("DISCORD_DEV_GUILD_ID");
if (!string.IsNullOrEmpty(devGuildId))
    builder.Configuration["Discord:DevGuildId"] = devGuildId;

builder.Services.Configure<DiscordBot.Configuration.DiscordConfig>(builder.Configuration.GetSection("Discord"));
builder.Services.Configure<LavalinkConfig>(builder.Configuration.GetSection("Lavalink"));
builder.Services.Configure<ModmailConfig>(builder.Configuration.GetSection("Modmail"));

builder.Services.AddSingleton(new DiscordSocketConfig
{
    GatewayIntents = GatewayIntents.AllUnprivileged
        | GatewayIntents.MessageContent
        | GatewayIntents.GuildMembers
        | GatewayIntents.GuildVoiceStates,
    AlwaysDownloadUsers = true,
    ResponseInternalTimeCheck = false
});
builder.Services.AddSingleton<DiscordSocketClient>();
builder.Services.AddSingleton(sp =>
    new InteractionService(sp.GetRequiredService<DiscordSocketClient>(), new InteractionServiceConfig
    {
        DefaultRunMode = RunMode.Async
    }));

builder.Services.AddLavalink();
builder.Services.ConfigureLavalink(options =>
{
    var lavalinkSection = builder.Configuration.GetSection("Lavalink");
    var baseAddress = lavalinkSection["BaseAddress"] ?? "http://localhost:2333";
    options.BaseAddress = new Uri(baseAddress);
    options.Passphrase = lavalinkSection["Password"] ?? "youshallnotpass";
});
builder.Services.AddSingleton<LiteDatabase>(_ => new LiteDatabase("/data/bot-data.db"));

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
    private bool _registered;

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

        if (result is ExecuteResult { Exception: not null } er)
            _logger.LogError(er.Exception, "Command {Command} error: {Error} | User: {User} | Guild: {Guild}",
                command?.Name ?? "?",
                result.ErrorReason,
                context.User.Id,
                context.Guild?.Id);
        else
            _logger.LogError("Command {Command} error: {Error} | User: {User} | Guild: {Guild}",
                command?.Name ?? "?",
                result.ErrorReason,
                context.User.Id,
                context.Guild?.Id);

        if (context.Interaction.Type == InteractionType.ApplicationCommandAutocomplete)
            return;

        try
        {
            if (!context.Interaction.HasResponded)
            {
                await context.Interaction.RespondAsync(
                    "❌ Có lỗi xảy ra khi thực thi lệnh.", ephemeral: true);
            }
            else
            {
                await context.Interaction.FollowupAsync(
                    "❌ Có lỗi xảy ra khi thực thi lệnh.", ephemeral: true);
            }
        }
        catch
        {
            // Interaction may have expired or become invalid; nothing we can do
        }
    }

    public async Task StartAsync(CancellationToken cancellationToken)
    {
        _client.Log += msg => { _logger.LogInformation("{Source}: {Message}", msg.Source, msg.Message); return Task.CompletedTask; };

        _client.Ready += () =>
        {
            if (_registered) return Task.CompletedTask;
            _registered = true;

            _ = Task.Run(async () =>
            {
                try
                {
                    var devId = _config.Value.DevGuildId;
                    if (devId == 0)
                    {
                        _logger.LogWarning("DevGuildId chưa được set, bỏ qua register commands");
                        return;
                    }

                    await _interactions.AddModulesAsync(typeof(Program).Assembly, _services);
                    _logger.LogInformation("Đã load {Count} modules", _interactions.Modules.Count);

                    await _interactions.RegisterCommandsToGuildAsync(devId);
                    _logger.LogInformation("Đã register guild commands cho {Guild}", devId);
                }
                catch (Exception ex)
                {
                    _logger.LogError(ex, "Lỗi khi register slash commands");
                }
            });

            return Task.CompletedTask;
        };

        _interactions.InteractionExecuted += HandleInteractionErrorAsync;

        _client.InteractionCreated += async interaction =>
        {
            if (interaction is SocketSlashCommand cmd && !cmd.HasResponded)
                _ = DeferOrFallbackAsync(cmd);

            await Task.Delay(200);

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
        };

        _honeypot.RegisterHandlers(_client);
        _modmail.RegisterHandlers(_client);
        _music.RegisterHandlers(_client);

        await _client.LoginAsync(TokenType.Bot, _config.Value.Token);
        await _client.StartAsync();
    }

    private static async Task DeferOrFallbackAsync(SocketSlashCommand cmd)
    {
        try
        {
            using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(5));
            await cmd.DeferAsync(options: new RequestOptions { CancelToken = cts.Token });
        }
        catch (OperationCanceledException)
        {
            if (!cmd.HasResponded)
            {
                try { await cmd.RespondAsync("⏳ Đang xử lý...", ephemeral: true); }
                catch { /* interaction may have expired */ }
            }
        }
        catch
        {
            if (!cmd.HasResponded)
            {
                try { await cmd.RespondAsync("⏳ Đang xử lý...", ephemeral: true); }
                catch { }
            }
        }
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
