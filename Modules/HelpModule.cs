using Discord;
using Discord.Interactions;

namespace DiscordBot.Modules;

public sealed class HelpModule : InteractionModuleBase<SocketInteractionContext>
{
    private readonly InteractionService _interactions;

    public HelpModule(InteractionService interactions)
    {
        _interactions = interactions;
    }

    [SlashCommand("help", "Xem danh sách tất cả lệnh")]
    public async Task Help()
    {
        var embed = new EmbedBuilder()
            .WithTitle("📖 Danh sách lệnh")
            .WithColor(Color.Blue)
            .WithCurrentTimestamp();

        foreach (var module in _interactions.Modules.Where(m => m.IsTopLevelGroup && m.SlashGroupName != "help"))
        {
            var lines = new List<string>();
            foreach (var cmd in module.SlashCommands)
                lines.Add($"`/{module.SlashGroupName} {cmd.Name}` — {cmd.Description}");

            foreach (var sub in module.SubModules)
            foreach (var cmd in sub.SlashCommands)
                lines.Add($"`/{module.SlashGroupName} {sub.SlashGroupName} {cmd.Name}` — {cmd.Description}");

            if (lines.Count > 0)
                embed.AddField(module.SlashGroupName ?? module.Name, string.Join('\n', lines.Take(20)), false);
        }

        await RespondAsync(embed: embed.Build(), ephemeral: true);
    }
}
