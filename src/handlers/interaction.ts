import type { ChatInputCommandInteraction } from 'discord.js';
import type { Command } from '../types.js';

const commandMap = new Map<string, Command>();

export function loadCommandMap(commands: Command[]): void {
  for (const cmd of commands) {
    commandMap.set(cmd.data.name, cmd);
  }
}

export async function handleInteraction(interaction: ChatInputCommandInteraction): Promise<void> {
  const command = commandMap.get(interaction.commandName);

  if (!command) {
    await interaction.reply({ content: 'Command not found.', ephemeral: true });
    return;
  }

  try {
    await command.execute(interaction);
  } catch (e) {
    console.error(`Error executing ${interaction.commandName}:`, e);

    const reply = { content: 'An error occurred while executing this command.', ephemeral: true };

    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(reply);
    } else {
      await interaction.reply(reply);
    }
  }
}
