using Discord;
using Discord.WebSocket;
using LiteDB;
using Microsoft.Extensions.Logging;

namespace DiscordBot.Services;

public sealed class HoneypotService
{
    private readonly DiscordSocketClient _client;
    private readonly LiteDatabase _db;
    private readonly ILogger<HoneypotService> _logger;

    public HoneypotService(DiscordSocketClient client, LiteDatabase db, ILogger<HoneypotService> logger)
    {
        _client = client;
        _db = db;
        _logger = logger;
    }

    private ILiteCollection<HoneypotGuildSettings> Settings =>
        _db.GetCollection<HoneypotGuildSettings>("honeypot_settings");

    public void RegisterHandlers(DiscordSocketClient client)
    {
        _client.MessageReceived += msg =>
        {
            _ = Task.Run(() => OnMessageReceivedAsync(msg));
            return Task.CompletedTask;
        };
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
        if (settings is null || settings.Action == HoneypotAction.Disabled) return;

        var trap = settings.TrapChannels.FirstOrDefault(t => t.ChannelId == channel.Id);
        if (trap is null) return;

        var guildUser = message.Author as SocketGuildUser;
        if (guildUser is null) return;

        if (ShouldSkipUser(guildUser, channel.Guild))
        {
            await NotifyAdminSkip(channel, guildUser, settings);
            return;
        }

        try
        {
            await message.DeleteAsync();

            if (settings.Experiments.HasFlag(HoneypotExperiments.TimeoutFirst))
                await TryTimeoutAsync(guildUser);

            if (!settings.Experiments.HasFlag(HoneypotExperiments.NoDm))
                await TrySendDmAsync(guildUser, channel.Guild.Name, settings);

            if (settings.Action == HoneypotAction.Ban)
                await channel.Guild.AddBanAsync(guildUser, pruneDays: 1, reason: "Honeypot triggered");
            else if (settings.Action == HoneypotAction.Softban)
                await SoftbanAsync(channel.Guild, guildUser);
            else
                await guildUser.KickAsync(reason: "Honeypot triggered");

            trap.TriggerCount++;
            Save(settings);

            _logger.LogWarning("Honeypot {Action} by {User} in guild {Guild}",
                settings.Action, guildUser.Id, channel.Guild.Id);

            await UpdateWarningMessage(channel, settings, trap);
            await LogTrigger(channel, guildUser, settings, null);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Honeypot error in guild {Guild}", channel.Guild.Id);
            await LogTrigger(channel, guildUser, settings, ex.Message);
        }
    }

    private static bool ShouldSkipUser(SocketGuildUser user, SocketGuild guild)
    {
        if (user.Id == guild.OwnerId) return true;
        return user.GuildPermissions.Administrator;
    }

    private static async Task NotifyAdminSkip(ITextChannel channel, SocketGuildUser user, HoneypotGuildSettings settings)
    {
        if (settings.LogChannelId == 0) return;
        if (channel.Guild is not SocketGuild guild) return;
        var log = guild.GetTextChannel(settings.LogChannelId);
        if (log is null) return;

        await log.SendMessageAsync(embed: new EmbedBuilder()
            .WithTitle("Honeypot skipped")
            .WithColor(Color.Orange)
            .WithDescription($"{user.Mention} triggered honeypot but is admin/owner.")
            .WithCurrentTimestamp()
            .Build());
    }

    private static async Task TryTimeoutAsync(SocketGuildUser user)
    {
        try
        {
            await user.SetTimeOutAsync(TimeSpan.FromHours(1));
        }
        catch { }
    }

    private async Task TrySendDmAsync(SocketGuildUser user, string guildName, HoneypotGuildSettings settings)
    {
        try
        {
            var dm = await user.CreateDMChannelAsync();
            var msg = settings.DmMessage ?? $"You triggered the honeypot in {guildName} and have been {settings.Action}.";
            await dm.SendMessageAsync(msg);
        }
        catch { }
    }

    private static async Task SoftbanAsync(SocketGuild guild, SocketGuildUser user)
    {
        await guild.AddBanAsync(user, pruneDays: 1, reason: "Honeypot softban");
        try
        {
            await Task.Delay(250);
            await guild.RemoveBanAsync(user);
        }
        catch { }
    }

    private static async Task UpdateWarningMessage(ITextChannel channel, HoneypotGuildSettings settings, HoneypotChannelInfo trap)
    {
        if (settings.Experiments.HasFlag(HoneypotExperiments.NoWarningMsg)) return;
        if (trap.WarningMessageId is null) return;

        try
        {
            var msg = await channel.GetMessageAsync(trap.WarningMessageId.Value);
            if (msg is IUserMessage um)
            {
                var content = settings.WarningMessage ??
                    $"⚠️ This is a honeypot channel. **{trap.TriggerCount}** users have been caught.";
                await um.ModifyAsync(m => m.Content = content);
            }
        }
        catch { }
    }

    private static async Task LogTrigger(ITextChannel channel, SocketGuildUser user, HoneypotGuildSettings settings, string? error)
    {
        if (settings.LogChannelId == 0) return;
        if (channel.Guild is not SocketGuild guild) return;
        var log = guild.GetTextChannel(settings.LogChannelId);
        if (log is null) return;

        var embed = new EmbedBuilder()
            .WithTitle(error is null ? "Honeypot triggered" : "Honeypot error")
            .WithColor(error is null ? Color.Red : Color.Orange)
            .AddField("User", $"{user.Mention} (`{user.Id}`)", true)
            .AddField("Action", settings.Action.ToString(), true)
            .AddField("Channel", channel.Mention, true);

        if (error is not null)
            embed.AddField("Error", error);

        embed.WithCurrentTimestamp();
        await log.SendMessageAsync(embed: embed.Build());
    }

    public async Task<bool> PostWarningMessageAsync(ITextChannel channel, HoneypotGuildSettings settings, HoneypotChannelInfo trap)
    {
        try
        {
            var content = settings.WarningMessage ?? "⚠️ This is a honeypot channel.";
            var msg = await channel.SendMessageAsync(content);
            trap.WarningMessageId = msg.Id;
            Save(settings);
            return true;
        }
        catch
        {
            return false;
        }
    }

    public string GetExperimentStatus(HoneypotExperiments experiments)
    {
        if (experiments == HoneypotExperiments.None)
            return "Không có experiment nào được bật.";

        var list = new List<string>();
        if (experiments.HasFlag(HoneypotExperiments.TimeoutFirst)) list.Add("TimeoutFirst");
        if (experiments.HasFlag(HoneypotExperiments.NoDm)) list.Add("NoDm");
        if (experiments.HasFlag(HoneypotExperiments.NoWarningMsg)) list.Add("NoWarningMsg");
        if (experiments.HasFlag(HoneypotExperiments.RandomChannelName)) list.Add("RandomChannelName");
        return string.Join(", ", list);
    }
}
