using System.Text;
using System.Text.Json;
using Discord;
using Discord.WebSocket;
using DiscordBot.Configuration;
using Lavalink4NET;
using Lavalink4NET.Extensions;
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
    private readonly DiscordSocketClient _client;
    private readonly ILogger<MusicService> _logger;
    private readonly LavalinkConfig _lavalink;

    public MusicService(
        IAudioService audio,
        DiscordSocketClient client,
        IOptions<LavalinkConfig> lavalink,
        ILogger<MusicService> logger)
    {
        _audio = audio;
        _client = client;
        _logger = logger;
        _lavalink = lavalink.Value;
    }

    public void RegisterHandlers(DiscordSocketClient client)
    {
    }

    private async ValueTask<QueuedLavalinkPlayer?> GetPlayerAsync(ulong guildId)
    {
        return await _audio.Players.GetPlayerAsync<QueuedLavalinkPlayer>(guildId);
    }

    private async ValueTask<QueuedLavalinkPlayer?> GetOrCreatePlayerAsync(
        ulong guildId, ulong voiceChannelId)
    {
        var existing = await _audio.Players.GetPlayerAsync<QueuedLavalinkPlayer>(guildId);
        if (existing is not null)
            return existing;

        var guild = _client.GetGuild(guildId);
        var channel = guild?.GetVoiceChannel(voiceChannelId);
        if (channel is null)
            return null;

        var node = _audio.GetNodes().FirstOrDefault();
        if (node?.SessionId is null)
        {
            _logger.LogWarning("Lavalink node chưa sẵn sàng");
            return null;
        }

        var voiceInfo = await JoinVoiceChannelAsync(channel);
        if (voiceInfo is null)
        {
            _logger.LogWarning("Không lấy được voice server info cho guild {GuildId}", guildId);
            return null;
        }

        using var http = new HttpClient { Timeout = TimeSpan.FromSeconds(60) };
        http.BaseAddress = new Uri(_lavalink.BaseAddress.TrimEnd('/') + '/');

        var payload = new
        {
            voice = new
            {
                token = voiceInfo.Value.Token,
                endpoint = voiceInfo.Value.Endpoint,
                sessionId = voiceInfo.Value.SessionId
            }
        };

        try
        {
            var json = JsonSerializer.Serialize(payload);
            var content = new StringContent(json, Encoding.UTF8, "application/json");
            var response = await http.PatchAsync(
                $"v4/sessions/{node.SessionId}/players/{guildId}", content);
            response.EnsureSuccessStatusCode();
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Lỗi khi tạo player qua REST API cho guild {GuildId}", guildId);
            return null;
        }

        for (var deadline = DateTime.UtcNow + TimeSpan.FromSeconds(10);
             DateTime.UtcNow < deadline;)
        {
            var player = await _audio.Players
                .GetPlayerAsync<QueuedLavalinkPlayer>(guildId)
                .ConfigureAwait(false);
            if (player is not null)
                return player;
            await Task.Delay(500).ConfigureAwait(false);
        }

        _logger.LogWarning("Player không xuất hiện sau khi PATCH thành công cho guild {GuildId}", guildId);
        return null;
    }

    private async ValueTask<(string Token, string Endpoint, string SessionId)?> JoinVoiceChannelAsync(
        IVoiceChannel channel)
    {
        var tcs = new TaskCompletionSource<(string Token, string Endpoint, string SessionId)?>();
        using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(30));

        Task OnVoiceServerUpdated(SocketVoiceServer server)
        {
            if (server.Guild.Id == channel.GuildId)
            {
                var guild = _client.GetGuild(channel.GuildId);
                var sessionId = guild?.GetUser(_client.CurrentUser.Id)?.VoiceState?.VoiceSessionId;
                if (sessionId is not null)
                    tcs.TrySetResult((server.Token, server.Endpoint, sessionId));
            }
            return Task.CompletedTask;
        }

        _client.VoiceServerUpdated += OnVoiceServerUpdated;
        try
        {
            using var registration = cts.Token.Register(() => tcs.TrySetResult(null));
            await channel.ConnectAsync();
            return await tcs.Task;
        }
        finally
        {
            _client.VoiceServerUpdated -= OnVoiceServerUpdated;
        }
    }

    public async Task<string> PlayAsync(ulong guildId, ulong voiceChannelId, string query)
    {
        query = CleanUrl(query);

        QueuedLavalinkPlayer? player;
        try
        {
            player = await GetOrCreatePlayerAsync(guildId, voiceChannelId);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Không thể kết nối NodeLink");
            return "Không thể kết nối tới Lavalink server. Vui lòng thử lại sau.";
        }

        if (player is null)
            return "Không thể kết nối tới voice channel.";

        TrackLoadResult result;
        try
        {
            var loadTask = _audio.Tracks.LoadTracksAsync(query, TrackSearchMode.YouTube).AsTask();
            var timeoutTask = Task.Delay(TimeSpan.FromSeconds(45));
            var completed = await Task.WhenAny(loadTask, timeoutTask).ConfigureAwait(false);
            if (completed != loadTask)
            {
                _logger.LogWarning("Tải track timeout sau 45s: {Query}", query);
                return $"Tải track timeout, vui lòng thử lại. (`{query}`)";
            }
            result = await loadTask.ConfigureAwait(false);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Lỗi khi tải track: {Query}", query);
            return $"Lỗi khi tải track: `{query}`.";
        }

        if (result.IsFailed)
            return $"Lỗi khi tải track: `{query}`.";

        if (!result.HasMatches)
            return $"Không tìm thấy kết quả cho `{query}`.";

        if (result.IsPlaylist)
        {
            var playlist = result.Playlist;
            var tracks = result.Tracks;

            if (tracks.IsDefaultOrEmpty)
                return $"Playlist trống: **{playlist?.Name ?? query}**.";

            var enqueue = player.State is PlayerState.Playing or PlayerState.Paused;
            await player.PlayAsync(result);

            var count = tracks.Length;
            return enqueue
                ? $"Đã thêm playlist **{playlist?.Name ?? "Unknown"}** ({count} bài) vào hàng đợi."
                : $"Đang phát playlist **{playlist?.Name ?? "Unknown"}** ({count} bài).";
        }

        var track = result.Track;
        if (track is null)
            return $"Không tìm thấy kết quả cho `{query}`.";

        var enqueueSingle = player.State is PlayerState.Playing or PlayerState.Paused;
        await player.PlayAsync(track, enqueue: enqueueSingle);

        if (enqueueSingle)
            return $"Đã thêm vào hàng đợi: **{track.Title}**";
        else
            return $"Đang phát: **{track.Title}**";
    }

    public async Task<string> SkipAsync(ulong guildId)
    {
        var player = await GetPlayerAsync(guildId);
        if (player is null)
            return "Bot không ở trong voice channel nào.";

        if (player.CurrentItem is null)
            return "Không có bài nào đang phát.";

        await player.SkipAsync(1);
        return "Đã skip bài hiện tại.";
    }

    public async Task<string> StopAsync(ulong guildId)
    {
        var player = await GetPlayerAsync(guildId);
        if (player is null)
            return "Bot không ở trong voice channel nào.";

        await player.StopAsync();
        await player.DisconnectAsync();
        return "Đã dừng và rời voice channel.";
    }

    public async Task<string> PauseAsync(ulong guildId)
    {
        var player = await GetPlayerAsync(guildId);
        if (player is null)
            return "Bot không ở trong voice channel nào.";

        if (player.IsPaused)
            return "Đã tạm dừng rồi.";

        await player.PauseAsync();
        return "Đã tạm dừng.";
    }

    public async Task<string> ResumeAsync(ulong guildId)
    {
        var player = await GetPlayerAsync(guildId);
        if (player is null)
            return "Bot không ở trong voice channel nào.";

        if (!player.IsPaused)
            return "Không ở trạng thái tạm dừng.";

        await player.ResumeAsync();
        return "Đã tiếp tục phát.";
    }

    public async Task<string> SetVolumeAsync(ulong guildId, float volume)
    {
        var player = await GetPlayerAsync(guildId);
        if (player is null)
            return "Bot không ở trong voice channel nào.";

        volume = Math.Clamp(volume, 0, 200);
        await player.SetVolumeAsync(volume / 100f);
        return $"Đã chỉnh volume về {volume}%.";
    }

    public async Task<string> ToggleShuffleAsync(ulong guildId)
    {
        var player = await GetPlayerAsync(guildId);
        if (player is null)
            return "Bot không ở trong voice channel nào.";

        player.Shuffle = !player.Shuffle;
        return player.Shuffle ? "Đã bật shuffle." : "Đã tắt shuffle.";
    }

    public async Task<string> SetLoopModeAsync(ulong guildId, TrackRepeatMode mode)
    {
        var player = await GetPlayerAsync(guildId);
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
        var player = await GetPlayerAsync(guildId);
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
        var player = await GetPlayerAsync(guildId);
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

    private static string CleanUrl(string query)
    {
        if (!Uri.TryCreate(query, UriKind.Absolute, out var uri))
            return query;

        if (!uri.Host.Contains("youtube.com") && uri.Host != "youtu.be")
            return query;

        var parts = uri.Query.TrimStart('?')
            .Split('&', StringSplitOptions.RemoveEmptyEntries)
            .Where(p => !p.StartsWith("si=") && !p.StartsWith("feature="))
            .ToArray();

        var cleanQuery = parts.Length > 0 ? "?" + string.Join("&", parts) : "";
        var clean = uri.GetLeftPart(UriPartial.Path) + cleanQuery;
        return clean;
    }

    private static string FormatTime(TimeSpan t)
    {
        return t.Hours > 0
            ? $"{t.Hours:D2}:{t.Minutes:D2}:{t.Seconds:D2}"
            : $"{t.Minutes:D2}:{t.Seconds:D2}";
    }
}
