using Discord;
using Discord.Interactions;
using Discord.WebSocket;
using DiscordBot.Services;
using Lavalink4NET.Players.Queued;

namespace DiscordBot.Modules;

[Group("music", "Lệnh điều khiển nhạc")]
public sealed class MusicModule : InteractionModuleBase<SocketInteractionContext>
{
    private readonly MusicService _music;

    public MusicModule(MusicService music)
    {
        _music = music;
    }

    [SlashCommand("play", "Phát nhạc từ tên bài hoặc URL YouTube", runMode: RunMode.Async)]
    public async Task Play(
        [Summary(description: "Tên bài hát hoặc URL YouTube")] string query)
    {
        await DeferAsync();

        var user = Context.User as SocketGuildUser;
        var voiceChannel = user?.VoiceState?.VoiceChannel;
        if (voiceChannel is null)
        {
            await FollowupAsync("Bạn cần vào voice channel trước.");
            return;
        }

        var result = await _music.PlayAsync(Context, query);
        await FollowupAsync(result);
    }

    [SlashCommand("skip", "Bỏ qua bài đang phát", runMode: RunMode.Async)]
    public async Task Skip()
    {
        await DeferAsync();
        var result = await _music.SkipAsync(Context.Guild.Id);
        await FollowupAsync(result);
    }

    [SlashCommand("stop", "Dừng phát nhạc và rời voice channel", runMode: RunMode.Async)]
    public async Task Stop()
    {
        await DeferAsync();
        var result = await _music.StopAsync(Context.Guild.Id);
        await FollowupAsync(result);
    }

    [SlashCommand("queue", "Xem hàng đợi hiện tại", runMode: RunMode.Async)]
    public async Task Queue()
    {
        await DeferAsync();
        var result = await _music.GetQueueAsync(Context.Guild.Id);
        await FollowupAsync(embed: new EmbedBuilder()
            .WithTitle("Hàng đợi nhạc")
            .WithDescription(result)
            .Build());
    }

    [SlashCommand("pause", "Tạm dừng phát nhạc", runMode: RunMode.Async)]
    public async Task Pause()
    {
        await DeferAsync();
        var result = await _music.PauseAsync(Context.Guild.Id);
        await FollowupAsync(result);
    }

    [SlashCommand("resume", "Tiếp tục phát nhạc", runMode: RunMode.Async)]
    public async Task Resume()
    {
        await DeferAsync();
        var result = await _music.ResumeAsync(Context.Guild.Id);
        await FollowupAsync(result);
    }

    [SlashCommand("nowplaying", "Xem bài đang phát", runMode: RunMode.Async)]
    public async Task NowPlaying()
    {
        await DeferAsync();
        var result = await _music.GetNowPlayingAsync(Context.Guild.Id);
        await FollowupAsync(result);
    }

    [SlashCommand("volume", "Chỉnh âm lượng (0-200)", runMode: RunMode.Async)]
    public async Task Volume(
        [Summary(description: "Âm lượng từ 0 đến 200")] float volume)
    {
        await DeferAsync();
        var result = await _music.SetVolumeAsync(Context.Guild.Id, volume);
        await FollowupAsync(result);
    }

    [SlashCommand("shuffle", "Bật/tắt phát ngẫu nhiên", runMode: RunMode.Async)]
    public async Task Shuffle()
    {
        await DeferAsync();
        var result = await _music.ToggleShuffleAsync(Context.Guild.Id);
        await FollowupAsync(result);
    }

    [SlashCommand("loop", "Chọn chế độ lặp lại", runMode: RunMode.Async)]
    public async Task Loop(
        [Summary(description: "Chế độ lặp")] LoopMode mode)
    {
        await DeferAsync();
        var repeatMode = mode switch
        {
            LoopMode.Track => TrackRepeatMode.Track,
            LoopMode.Queue => TrackRepeatMode.Queue,
            _ => TrackRepeatMode.None,
        };
        var result = await _music.SetLoopModeAsync(Context.Guild.Id, repeatMode);
        await FollowupAsync(result);
    }

    public enum LoopMode
    {
        [ChoiceDisplay("None")]
        None,
        [ChoiceDisplay("Track")]
        Track,
        [ChoiceDisplay("Queue")]
        Queue,
    }
}
