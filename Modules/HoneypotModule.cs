using Discord;
using Discord.Interactions;
using DiscordBot.Configuration;
using DiscordBot.Services;

namespace DiscordBot.Modules;

[RequireUserPermission(GuildPermission.Administrator)]
[Group("honeypot", "Cấu hình bot bẫy spam")]
public sealed class HoneypotModule : InteractionModuleBase<SocketInteractionContext>
{
    private readonly HoneypotService _honeypot;

    public HoneypotModule(HoneypotService honeypot)
    {
        _honeypot = honeypot;
    }

    [SlashCommand("setup", "Thiết lập channel bẫy, channel log và action")]
    public async Task Setup(
        [Summary(description: "Channel dùng làm bẫy")] ITextChannel trapChannel,
        [Summary(description: "Channel để log các lần trigger")] ITextChannel logChannel,
        [Summary(description: "Kick hoặc Ban")] HoneypotAction action = HoneypotAction.Kick)
    {
        var settings = _honeypot.GetOrCreate(Context.Guild.Id);
        settings.TrapChannelId = trapChannel.Id;
        settings.LogChannelId = logChannel.Id;
        settings.Action = action;
        _honeypot.Save(settings);

        await RespondAsync(
            $"Đã thiết lập honeypot: trap = {trapChannel.Mention}, log = {logChannel.Mention}, action = {action}.",
            ephemeral: true);
    }

    [SlashCommand("disable", "Tắt honeypot cho server này")]
    public async Task Disable()
    {
        var settings = _honeypot.GetOrCreate(Context.Guild.Id);
        settings.Action = HoneypotAction.Disabled;
        _honeypot.Save(settings);
        await RespondAsync("Đã tắt honeypot.", ephemeral: true);
    }
}
