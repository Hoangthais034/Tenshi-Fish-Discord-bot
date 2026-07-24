import { REST, Routes, type RESTPostAPIApplicationCommandsJSONBody } from 'discord.js';
import { config } from '../config.js';
import type { Command } from '../types.js';

export async function registerCommands(commands: Command[], clientId: string): Promise<void> {
  const rest = new REST().setToken(config.discord.token);

  const body: RESTPostAPIApplicationCommandsJSONBody[] = commands.map(c => c.data.toJSON());

  try {
    if (config.discord.devGuildId !== '0') {
      await rest.put(
        Routes.applicationGuildCommands(clientId, config.discord.devGuildId),
        { body },
      );
    } else {
      await rest.put(
        Routes.applicationCommands(clientId),
        { body },
      );
    }
  } catch (e) {
    console.error('Failed to register commands:', e);
  }
}
