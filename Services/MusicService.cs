using Discord.WebSocket;
using Lavalink4NET;
using Lavalink4NET.Players;
using Lavalink4NET.Players.Queued;
using Lavalink4NET.Rest.Entities.Tracks;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace DiscordBot.Services;

public sealed class MusicService
{
    private readonly IAudioService _audio;
    private readonly ILogger<MusicService> _logger;

    public MusicService(IAudioService audio, ILogger<MusicService> logger)
    {
        _audio = audio;
        _logger = logger;
    }

    public void RegisterHandlers(DiscordSocketClient client)
    {
    }

    private static readonly PlayerFactory<QueuedLavalinkPlayer, QueuedLavalinkPlayerOptions> PlayerFactory =
        Lavalink4NET.Players.PlayerFactory.Create<QueuedLavalinkPlayer, QueuedLavalinkPlayerOptions>(
            static props => new QueuedLavalinkPlayer(props));

    private static readonly QueuedLavalinkPlayerOptions DefaultOptions = new()
    {
        DisconnectOnStop = true,
        ClearQueueOnStop = true,
        SelfDeaf = true,
    };

    private static readonly IOptions<QueuedLavalinkPlayerOptions> PlayerOptions =
        Options.Create(DefaultOptions);

    private async ValueTask<QueuedLavalinkPlayer> GetOrCreatePlayerAsync(
        ulong guildId, ulong voiceChannelId)
    {
        var existing = await _audio.Players.GetPlayerAsync<QueuedLavalinkPlayer>(guildId);
        if (existing is not null)
            return existing;

        var player = await _audio.Players.JoinAsync<QueuedLavalinkPlayer, QueuedLavalinkPlayerOptions>(
            guildId, voiceChannelId, PlayerFactory, PlayerOptions);

        return player;
    }

    public async Task<string> PlayAsync(ulong guildId, ulong voiceChannelId, string query)
    {
        var player = await GetOrCreatePlayerAsync(guildId, voiceChannelId);

        var track = await _audio.Tracks.LoadTrackAsync(query, TrackSearchMode.YouTube);
        if (track is null)
            return $"Không tìm thấy kết quả cho `{query}`.";

        var enqueue = player.State is PlayerState.Playing or PlayerState.Paused;
        await player.PlayAsync(track, enqueue: enqueue);

        if (enqueue)
            return $"Đã thêm vào hàng đợi: **{track.Title}**";
        else
            return $"Đang phát: **{track.Title}**";
    }

    public async Task<string> SkipAsync(ulong guildId)
    {
        var player = await _audio.Players.GetPlayerAsync<QueuedLavalinkPlayer>(guildId);
        if (player is null)
            return "Bot không ở trong voice channel nào.";

        if (player.CurrentItem is null)
            return "Không có bài nào đang phát.";

        await player.SkipAsync(1);
        return "Đã skip bài hiện tại.";
    }

    public async Task<string> StopAsync(ulong guildId)
    {
        var player = await _audio.Players.GetPlayerAsync<QueuedLavalinkPlayer>(guildId);
        if (player is null)
            return "Bot không ở trong voice channel nào.";

        await player.StopAsync();
        await player.DisconnectAsync();
        return "Đã dừng và rời voice channel.";
    }

    public async Task<string> PauseAsync(ulong guildId)
    {
        var player = await _audio.Players.GetPlayerAsync<QueuedLavalinkPlayer>(guildId);
        if (player is null)
            return "Bot không ở trong voice channel nào.";

        if (player.IsPaused)
            return "Đã tạm dừng rồi.";

        await player.PauseAsync();
        return "Đã tạm dừng.";
    }

    public async Task<string> ResumeAsync(ulong guildId)
    {
        var player = await _audio.Players.GetPlayerAsync<QueuedLavalinkPlayer>(guildId);
        if (player is null)
            return "Bot không ở trong voice channel nào.";

        if (!player.IsPaused)
            return "Không ở trạng thái tạm dừng.";

        await player.ResumeAsync();
        return "Đã tiếp tục phát.";
    }

    public async Task<string> SetVolumeAsync(ulong guildId, float volume)
    {
        var player = await _audio.Players.GetPlayerAsync<QueuedLavalinkPlayer>(guildId);
        if (player is null)
            return "Bot không ở trong voice channel nào.";

        volume = Math.Clamp(volume, 0, 200);
        await player.SetVolumeAsync(volume / 100f);
        return $"Đã chỉnh volume về {volume}%.";
    }

    public async Task<string> ToggleShuffleAsync(ulong guildId)
    {
        var player = await _audio.Players.GetPlayerAsync<QueuedLavalinkPlayer>(guildId);
        if (player is null)
            return "Bot không ở trong voice channel nào.";

        player.Shuffle = !player.Shuffle;
        return player.Shuffle ? "Đã bật shuffle." : "Đã tắt shuffle.";
    }

    public async Task<string> SetLoopModeAsync(ulong guildId, TrackRepeatMode mode)
    {
        var player = await _audio.Players.GetPlayerAsync<QueuedLavalinkPlayer>(guildId);
        if (player is null)
            return "Bot không ở trong voice channel nào.";

        player.RepeatMode = mode;
        var label = mode switch
        {
            TrackRepeatMode.Queue => "toàn bộ hàng đợi",
            TrackRepeatMode.Track => "bài hiện tại",
            _ => "tắt",
        };
        return $"Đã chọn loop chế độ {label}.";
    }

    public async Task<string> GetNowPlayingAsync(ulong guildId)
    {
        var player = await _audio.Players.GetPlayerAsync<QueuedLavalinkPlayer>(guildId);
        if (player?.CurrentTrack is null)
            return "Không có bài nào đang phát.";

        var track = player.CurrentTrack;
        var position = player.Position?.Position ?? TimeSpan.Zero;
        var duration = track.Duration;
        var progress = duration == TimeSpan.Zero ? "??:??" : $"{FormatTime(position)}/{FormatTime(duration)}";
        var state = player.IsPaused ? "⏸️" : "▶️";

        return $"{state} **{track.Title}** — {track.Author}\n`{progress}`";
    }

    public async Task<string> GetQueueAsync(ulong guildId)
    {
        var player = await _audio.Players.GetPlayerAsync<QueuedLavalinkPlayer>(guildId);
        if (player is null || player.Queue is null)
            return "Hàng đợi trống.";

        var lines = new List<string>();
        var nowPlaying = player.CurrentItem?.Track;
        if (nowPlaying is not null)
            lines.Add($"▶️ **{nowPlaying.Title}** — {nowPlaying.Author}");

        var queue = player.Queue;
        var total = queue.Count;
        var take = Math.Min(total, 20);

        for (int i = 0; i < take; i++)
        {
            var item = queue[i];
            if (item?.Track is not null)
                lines.Add($"  {i + 1}. {item.Track.Title} — {item.Track.Author}");
        }

        if (total > 20)
            lines.Add($"  ... và {total - 20} bài nữa");

        if (lines.Count == 0)
            return "Hàng đợi trống.";

        return string.Join('\n', lines);
    }

    private static string FormatTime(TimeSpan t)
    {
        return t.Hours > 0
            ? $"{t.Hours:D2}:{t.Minutes:D2}:{t.Seconds:D2}"
            : $"{t.Minutes:D2}:{t.Seconds:D2}";
    }
}
