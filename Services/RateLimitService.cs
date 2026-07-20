using System.Collections.Concurrent;
using Discord;
using Discord.Interactions;
using Discord.WebSocket;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.DependencyInjection;

namespace DiscordBot.Services;

public sealed class RateLimitService
{
    private readonly IMemoryCache _cache;

    public RateLimitService(IMemoryCache cache)
    {
        _cache = cache;
    }

    public bool IsRateLimited(ulong userId, string commandKey, int seconds)
    {
        var key = $"{userId}:{commandKey}";
        if (_cache.TryGetValue(key, out _))
            return true;

        _cache.Set(key, true, TimeSpan.FromSeconds(seconds));
        return false;
    }

    public int GetRemainingSeconds(ulong userId, string commandKey)
    {
        var key = $"{userId}:{commandKey}";
        if (_cache.TryGetValue<DateTime>(key, out var expiry))
            return (int)(expiry - DateTime.UtcNow).TotalSeconds;
        return 0;
    }
}

[AttributeUsage(AttributeTargets.Method, AllowMultiple = false)]
public sealed class CooldownAttribute : PreconditionAttribute
{
    private readonly int _seconds;
    private readonly string _commandKey;

    public CooldownAttribute(int seconds, string? commandKey = null)
    {
        _seconds = seconds;
        _commandKey = commandKey ?? string.Empty;
    }

    public override async Task<PreconditionResult> CheckRequirementsAsync(
        IInteractionContext context,
        ICommandInfo commandInfo,
        IServiceProvider services)
    {
        var rateLimit = services.GetRequiredService<RateLimitService>();
        var key = string.IsNullOrEmpty(_commandKey)
            ? commandInfo.Name
            : _commandKey;

        if (rateLimit.IsRateLimited(context.User.Id, key, _seconds))
        {
            var remaining = rateLimit.GetRemainingSeconds(context.User.Id, key);
            await context.Interaction.FollowupAsync(
                $"⏳ Vui lòng đợi {remaining}s trước khi dùng lại lệnh này.",
                ephemeral: true);
            return PreconditionResult.FromError("Rate limited");
        }

        return PreconditionResult.FromSuccess();
    }
}
