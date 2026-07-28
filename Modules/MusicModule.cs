using Discord;
using Discord.Interactions;
using Discord.WebSocket;
using DiscordBot.Services;
using Lavalink4NET.Players.Queued;

namespace DiscordBot.Modules;

public enum LoopMode
{
    [ChoiceDisplay("None")]
    None,
    [ChoiceDisplay("Track")]
    Track,
    [ChoiceDisplay("Queue")]
    Queue,
}

[Group("music", "Lệnh điều khiển nhạc")]
public sealed class MusicModule : InteractionModuleBase<SocketInteractionContext>
{
    private static readonly Dictionary<string, Color> EmbedColors = new()
    {
        ["play"] = Color.Green,
        ["skip"] = Color.Orange,
        ["stop"] = Color.Red,
        ["queue"] = Color.Blue,
        ["pause"] = Color.LightOrange,
        ["resume"] = Color.Green,
        ["nowplaying"] = Color.Purple,
        ["volume"] = Color.Teal,
        ["shuffle"] = Color.DarkPurple,
        ["loop"] = Color.Gold,
    };

    private readonly MusicService _music;

    public MusicModule(MusicService music)
    {
        _music = music;
    }

    private Embed BuildEmbed(string sub, MusicResult result)
    {
        var user = Context.User;
        var embed = new EmbedBuilder()
            .WithColor(EmbedColors.GetValueOrDefault(sub, Color.Default))
            .WithDescription(result.Text)
            .WithFooter(new EmbedFooterBuilder
            {
                Text = user.Username,
                IconUrl = user.GetAvatarUrl()
            })
            .WithCurrentTimestamp();

        if (result.ArtworkUrl is not null)
            embed.WithThumbnailUrl(result.ArtworkUrl);

        return embed.Build();
    }

    private async Task RespondAsync(string sub, MusicResult result)
    {
        var embed = BuildEmbed(sub, result);
        if (Context.Interaction.HasResponded)
            await Context.Interaction.ModifyOriginalResponseAsync(m => m.Embed = embed);
        else
            await Context.Interaction.RespondAsync(embed: embed);
    }

    [SlashCommand("play", "Phát nhạc từ tên bài hoặc URL YouTube", runMode: RunMode.Async)]
    public async Task Play(
        [Summary(description: "Tên bài hát hoặc URL YouTube")] string query)
    {
        var user = Context.User as SocketGuildUser;
        var voiceChannel = user?.VoiceState?.VoiceChannel;
        if (voiceChannel is null)
        {
            await RespondAsync("play", new MusicResult("Bạn cần vào voice channel trước."));
            return;
        }

        var result = await _music.PlayAsync(Context.Guild.Id, voiceChannel.Id, query);
        await RespondAsync("play", result);
    }

    [SlashCommand("skip", "Bỏ qua bài đang phát", runMode: RunMode.Async)]
    public async Task Skip()
    {
        var result = await _music.SkipAsync(Context.Guild.Id);
        await RespondAsync("skip", result);
    }

    [SlashCommand("stop", "Dừng phát nhạc và rời voice channel", runMode: RunMode.Async)]
    public async Task Stop()
    {
        var result = await _music.StopAsync(Context.Guild.Id);
        await RespondAsync("stop", result);
    }

    [SlashCommand("queue", "Xem hàng đợi hiện tại", runMode: RunMode.Async)]
    public async Task Queue()
    {
        var result = await _music.GetQueueAsync(Context.Guild.Id);
        await RespondAsync("queue", result);
    }

    [SlashCommand("pause", "Tạm dừng phát nhạc", runMode: RunMode.Async)]
    public async Task Pause()
    {
        var result = await _music.PauseAsync(Context.Guild.Id);
        await RespondAsync("pause", result);
    }

    [SlashCommand("resume", "Tiếp tục phát nhạc", runMode: RunMode.Async)]
    public async Task Resume()
    {
        var result = await _music.ResumeAsync(Context.Guild.Id);
        await RespondAsync("resume", result);
    }

    [SlashCommand("nowplaying", "Xem bài đang phát", runMode: RunMode.Async)]
    public async Task NowPlaying()
    {
        var result = await _music.GetNowPlayingAsync(Context.Guild.Id);
        await RespondAsync("nowplaying", result);
    }

    [SlashCommand("volume", "Chỉnh âm lượng (0-200)", runMode: RunMode.Async)]
    public async Task Volume(
        [Summary(description: "Âm lượng từ 0 đến 200")] float volume)
    {
        var result = await _music.SetVolumeAsync(Context.Guild.Id, volume);
        await RespondAsync("volume", result);
    }

    [SlashCommand("shuffle", "Bật/tắt phát ngẫu nhiên", runMode: RunMode.Async)]
    public async Task Shuffle()
    {
        var result = await _music.ToggleShuffleAsync(Context.Guild.Id);
        await RespondAsync("shuffle", result);
    }

    [SlashCommand("loop", "Chọn chế độ lặp lại", runMode: RunMode.Async)]
    public async Task Loop(
        [Summary(description: "Chế độ lặp")] LoopMode mode)
    {
        var repeatMode = mode switch
        {
            LoopMode.Track => TrackRepeatMode.Track,
            LoopMode.Queue => TrackRepeatMode.Queue,
            _ => TrackRepeatMode.None,
        };
        var result = await _music.SetLoopModeAsync(Context.Guild.Id, repeatMode);
        await RespondAsync("loop", result);
    }
}
