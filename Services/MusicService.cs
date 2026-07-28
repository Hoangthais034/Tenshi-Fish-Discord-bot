using Discord;
using Discord.WebSocket;
using Lavalink4NET;
using Lavalink4NET.Players;
using Lavalink4NET.Players.Queued;
using Lavalink4NET.Rest.Entities.Tracks;
using Microsoft.Extensions.Logging;

namespace DiscordBot.Services;

public sealed record MusicResult(string Text)
{
    public string? Title { get; init; }
    public string? Author { get; init; }
    public string? ArtworkUrl { get; init; }
    public string? Uri { get; init; }
}

public sealed class MusicService
{
    private readonly IAudioService _audio;
    private readonly DiscordSocketClient _client;
    private readonly ILogger<MusicService> _logger;

    public MusicService(
        IAudioService audio,
        DiscordSocketClient client,
        ILogger<MusicService> logger)
    {
        _audio = audio;
        _client = client;
        _logger = logger;
    }

    public void RegisterHandlers(DiscordSocketClient client) { }

    private async ValueTask<QueuedLavalinkPlayer?> GetPlayerAsync(ulong guildId)
    {
        return await _audio.Players.GetPlayerAsync<QueuedLavalinkPlayer>(guildId);
    }

    private async ValueTask<QueuedLavalinkPlayer?> GetOrCreatePlayerAsync(ulong guildId, ulong voiceChannelId)
    {
        var existing = await GetPlayerAsync(guildId);
        if (existing is not null) return existing;

        try
        {
            return await _audio.JoinAsync<QueuedLavalinkPlayer>(guildId, voiceChannelId);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Không thể join voice channel {VoiceChannelId}", voiceChannelId);
            return null;
        }
    }

    private static string? GetYouTubeThumbnail(Uri? uri)
    {
        if (uri is null) return null;
        if (!uri.Host.Contains("youtube.com") && uri.Host != "youtu.be") return null;

        var parts = uri.Query.TrimStart('?').Split('&');
        var videoId = parts
            .Select(p => p.Split('=', 2))
            .Where(p => p.Length == 2 && p[0] == "v")
            .Select(p => p[1])
            .FirstOrDefault()
            ?? uri.Segments.LastOrDefault()?.Trim('/');

        return videoId?.Length >= 10 ? $"https://i.ytimg.com/vi/{videoId}/mqdefault.jpg" : null;
    }

    private static MusicResult TrackResult(string text, Uri? uri, string? title, string? author)
    {
        return new MusicResult(text)
        {
            Title = title,
            Author = author,
            ArtworkUrl = GetYouTubeThumbnail(uri),
            Uri = uri?.AbsoluteUri
        };
    }

    public async Task<MusicResult> PlayAsync(ulong guildId, ulong voiceChannelId, string query)
    {
        query = CleanUrl(query);

        QueuedLavalinkPlayer? player;
        try { player = await GetOrCreatePlayerAsync(guildId, voiceChannelId); }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Không thể kết nối Lavalink");
            return new MusicResult("Không thể kết nối tới Lavalink server. Vui lòng thử lại sau.");
        }

        if (player is null)
            return new MusicResult("Không thể kết nối tới voice channel.");

        TrackLoadResult result;
        try
        {
            var loadTask = _audio.Tracks.LoadTracksAsync(query, TrackSearchMode.YouTube).AsTask();
            var timeout = await Task.WhenAny(loadTask, Task.Delay(45000)).ConfigureAwait(false);
            if (timeout != loadTask)
                return new MusicResult($"Tải track timeout, vui lòng thử lại. (`{query}`)");
            result = await loadTask.ConfigureAwait(false);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Lỗi khi tải track: {Query}", query);
            return new MusicResult($"Lỗi khi tải track: `{query}`.");
        }

        if (result.IsFailed || !result.HasMatches)
            return new MusicResult($"Lỗi khi tải track: `{query}`.");

        if (result.IsPlaylist)
        {
            var playlist = result.Playlist;
            var tracks = result.Tracks;
            if (tracks.IsDefaultOrEmpty)
                return new MusicResult($"Playlist trống: **{playlist?.Name ?? query}**.");

            var enqueue = player.State is PlayerState.Playing or PlayerState.Paused;
            for (int i = 0; i < tracks.Length; i++)
                await player.PlayAsync(tracks[i], enqueue: enqueue || i > 0);
            var first = tracks[0];
            return TrackResult(
                enqueue
                    ? $"Đã thêm playlist **{playlist?.Name ?? "Unknown"}** ({tracks.Length} bài) vào hàng đợi."
                    : $"Đang phát playlist **{playlist?.Name ?? "Unknown"}** ({tracks.Length} bài).",
                first.Uri, first.Title, first.Author);
        }

        var track = result.Track;
        if (track is null)
            return new MusicResult($"Không tìm thấy kết quả cho `{query}`.");

        var enqueueSingle = player.State is PlayerState.Playing or PlayerState.Paused;
        await player.PlayAsync(track, enqueue: enqueueSingle);
        return TrackResult(
            enqueueSingle
                ? $"Đã thêm vào hàng đợi: **{track.Title}**"
                : $"Đang phát: **{track.Title}**",
            track.Uri, track.Title, track.Author);
    }

    public async Task<MusicResult> SkipAsync(ulong guildId)
    {
        var p = await GetPlayerAsync(guildId);
        if (p is null) return new MusicResult("Bot không ở trong voice channel nào.");
        if (p.CurrentItem is null) return new MusicResult("Không có bài nào đang phát.");
        await p.SkipAsync(1);
        return new MusicResult("Đã skip bài hiện tại.");
    }

    public async Task<MusicResult> StopAsync(ulong guildId)
    {
        var p = await GetPlayerAsync(guildId);
        if (p is null) return new MusicResult("Bot không ở trong voice channel nào.");
        await p.StopAsync();
        await p.DisconnectAsync();
        return new MusicResult("Đã dừng và rời voice channel.");
    }

    public async Task<MusicResult> PauseAsync(ulong guildId)
    {
        var p = await GetPlayerAsync(guildId);
        if (p is null) return new MusicResult("Bot không ở trong voice channel nào.");
        if (p.IsPaused) return new MusicResult("Đã tạm dừng rồi.");
        await p.PauseAsync();
        return new MusicResult("Đã tạm dừng.");
    }

    public async Task<MusicResult> ResumeAsync(ulong guildId)
    {
        var p = await GetPlayerAsync(guildId);
        if (p is null) return new MusicResult("Bot không ở trong voice channel nào.");
        if (!p.IsPaused) return new MusicResult("Không ở trạng thái tạm dừng.");
        await p.ResumeAsync();
        return new MusicResult("Đã tiếp tục phát.");
    }

    public async Task<MusicResult> SetVolumeAsync(ulong guildId, float volume)
    {
        var p = await GetPlayerAsync(guildId);
        if (p is null) return new MusicResult("Bot không ở trong voice channel nào.");
        volume = Math.Clamp(volume, 0, 200);
        await p.SetVolumeAsync(volume / 100f);
        return new MusicResult($"Đã chỉnh volume về {volume}%.");
    }

    public async Task<MusicResult> ToggleShuffleAsync(ulong guildId)
    {
        var p = await GetPlayerAsync(guildId);
        if (p is null) return new MusicResult("Bot không ở trong voice channel nào.");
        p.Shuffle = !p.Shuffle;
        return new MusicResult(p.Shuffle ? "Đã bật shuffle." : "Đã tắt shuffle.");
    }

    public async Task<MusicResult> SetLoopModeAsync(ulong guildId, TrackRepeatMode mode)
    {
        var p = await GetPlayerAsync(guildId);
        if (p is null) return new MusicResult("Bot không ở trong voice channel nào.");
        p.RepeatMode = mode;
        var label = mode switch
        {
            TrackRepeatMode.Queue => "toàn bộ hàng đợi",
            TrackRepeatMode.Track => "bài hiện tại",
            _ => "tắt",
        };
        return new MusicResult($"Đã chọn loop chế độ {label}.");
    }

    public async Task<MusicResult> GetNowPlayingAsync(ulong guildId)
    {
        var p = await GetPlayerAsync(guildId);
        if (p?.CurrentTrack is null) return new MusicResult("Không có bài nào đang phát.");

        var track = p.CurrentTrack;
        var pos = p.Position?.Position ?? TimeSpan.Zero;
        var dur = track.Duration;
        var progress = dur == TimeSpan.Zero ? "??:??" : $"{FormatTime(pos)}/{FormatTime(dur)}";
        return TrackResult($"{(p.IsPaused ? "⏸️" : "▶️")} **{track.Title}** — {track.Author}\n`{progress}`", track.Uri, track.Title, track.Author);
    }

    public async Task<MusicResult> GetQueueAsync(ulong guildId)
    {
        var p = await GetPlayerAsync(guildId);
        if (p is null || p.Queue is null) return new MusicResult("Hàng đợi trống.");

        var lines = new List<string>();
        var current = p.CurrentItem?.Track;
        if (current is not null)
            lines.Add($"▶️ **{current.Title}** — {current.Author}");

        var queue = p.Queue;
        var total = queue.Count;
        for (int i = 0; i < Math.Min(total, 20); i++)
        {
            var item = queue[i]?.Track;
            if (item is not null)
                lines.Add($"  {i + 1}. {item.Title} — {item.Author}");
        }
        if (total > 20) lines.Add($"  ... và {total - 20} bài nữa");

        return lines.Count > 0
            ? TrackResult(string.Join('\n', lines), current?.Uri, current?.Title, current?.Author)
            : new MusicResult("Hàng đợi trống.");
    }

    private static string CleanUrl(string query)
    {
        if (!Uri.TryCreate(query, UriKind.Absolute, out var uri)) return query;
        if (!uri.Host.Contains("youtube.com") && uri.Host != "youtu.be") return query;

        var clean = string.Join('&',
            uri.Query.TrimStart('?').Split('&', StringSplitOptions.RemoveEmptyEntries)
            .Where(p => !p.StartsWith("si=") && !p.StartsWith("feature=")));
        return uri.GetLeftPart(UriPartial.Path) + (clean.Length > 0 ? "?" + clean : "");
    }

    private static string FormatTime(TimeSpan t) =>
        t.Hours > 0 ? $"{t.Hours:D2}:{t.Minutes:D2}:{t.Seconds:D2}" : $"{t.Minutes:D2}:{t.Seconds:D2}";
}