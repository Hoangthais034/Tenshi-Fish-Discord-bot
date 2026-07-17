using Discord;
using Discord.Interactions;
using Discord.WebSocket;
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
    [Cooldown(10)]
    public async Task Setup(
        [Summary(description: "Channel dùng làm bẫy")] ITextChannel trapChannel,
        [Summary(description: "Channel để log trigger")] ITextChannel logChannel,
        [Summary(description: "Hành động khi trigger")] HoneypotAction action = HoneypotAction.Kick)
    {
        var settings = _honeypot.GetOrCreate(Context.Guild.Id);
        settings.LogChannelId = logChannel.Id;
        settings.Action = action;

        var existing = settings.TrapChannels.FirstOrDefault(t => t.ChannelId == trapChannel.Id);
        if (existing is null)
        {
            var info = new HoneypotChannelInfo { ChannelId = trapChannel.Id };
            settings.TrapChannels.Add(info);
            await _honeypot.PostWarningMessageAsync(trapChannel, settings, info);
        }

        _honeypot.Save(settings);

        await RespondAsync(
            $"✅ Đã thiết lập: trap = {trapChannel.Mention}, log = {logChannel.Mention}, action = {action}.",
            ephemeral: true);
    }

    [SlashCommand("disable", "Tắt honeypot cho server này")]
    public async Task Disable()
    {
        var settings = _honeypot.GetOrCreate(Context.Guild.Id);
        settings.Action = HoneypotAction.Disabled;
        _honeypot.Save(settings);
        await RespondAsync("✅ Đã tắt honeypot.", ephemeral: true);
    }

    [SlashCommand("messages", "Tùy chỉnh tin nhắn DM và warning")]
    public async Task SetMessages(
        [Summary(description: "Tin nhắn DM gửi tới user khi trigger (để trống = mặc định)")]
        string? dmMessage = null,
        [Summary(description: "Tin nhắn warning trong trap channel (để trống = mặc định)")]
        string? warningMessage = null)
    {
        var settings = _honeypot.GetOrCreate(Context.Guild.Id);
        settings.DmMessage = string.IsNullOrWhiteSpace(dmMessage) ? null : dmMessage;
        settings.WarningMessage = string.IsNullOrWhiteSpace(warningMessage) ? null : warningMessage;
        _honeypot.Save(settings);

        await RespondAsync("✅ Đã cập nhật tin nhắn.", ephemeral: true);
    }

    [SlashCommand("experiment", "Bật/tắt experiment cho honeypot")]
    public async Task Experiment(
        [Summary(description: "Experiment cần bật/tắt")] HoneypotExperiments experiment,
        [Summary(description: "Bật hay tắt")] bool enabled = true)
    {
        var settings = _honeypot.GetOrCreate(Context.Guild.Id);

        if (enabled)
            settings.Experiments |= experiment;
        else
            settings.Experiments &= ~experiment;

        _honeypot.Save(settings);

        var status = _honeypot.GetExperimentStatus(settings.Experiments);
        await RespondAsync($"✅ Experiment `{experiment}` {(enabled ? "bật" : "tắt")}.\nHiện tại: {status}", ephemeral: true);
    }

    [SlashCommand("add-trap", "Thêm channel bẫy mới")]
    public async Task AddTrap(
        [Summary(description: "Channel bẫy mới")] ITextChannel channel)
    {
        var settings = _honeypot.GetOrCreate(Context.Guild.Id);

        if (settings.TrapChannels.Any(t => t.ChannelId == channel.Id))
        {
            await RespondAsync("Channel này đã là trap rồi.", ephemeral: true);
            return;
        }

        var info = new HoneypotChannelInfo { ChannelId = channel.Id };
        settings.TrapChannels.Add(info);
        await _honeypot.PostWarningMessageAsync(channel, settings, info);
        _honeypot.Save(settings);

        await RespondAsync($"✅ Đã thêm {channel.Mention} làm trap channel.", ephemeral: true);
    }

    [SlashCommand("remove-trap", "Xóa channel bẫy")]
    public async Task RemoveTrap(
        [Summary(description: "Channel cần xóa khỏi trap")] ITextChannel channel)
    {
        var settings = _honeypot.GetOrCreate(Context.Guild.Id);
        var removed = settings.TrapChannels.RemoveAll(t => t.ChannelId == channel.Id);
        _honeypot.Save(settings);

        await RespondAsync(removed > 0
            ? $"✅ Đã xóa {channel.Mention} khỏi trap channel."
            : "Channel này không phải trap.", ephemeral: true);
    }
}
