import 'reflect-metadata';
import { Events } from 'discord.js';
import { config, client, container } from './di.js';
import { handleInteraction, loadCommandMap } from './handlers/interaction.js';
import { registerCommands } from './handlers/register.js';
import { MusicService } from './services/music.js';
import { ModmailService } from './services/modmail.js';
import { HoneypotService } from './services/honeypot.js';
import { HoneypotHostedService } from './services/honeypot-hosted.js';
import type { Command } from './types.js';

async function main(): Promise<void> {
  const commands: Command[] = [];

  const help = await import('./modules/help.js');
  commands.push(...help.commands);

  const music = await import('./modules/music.js');
  commands.push(...music.commands);

  const modmail = await import('./modules/modmail.js');
  commands.push(...modmail.commands);

  const honeypotMod = await import('./modules/honeypot.js');
  commands.push(...honeypotMod.commands);

  loadCommandMap(commands);

  client.once('clientReady', async () => {
    const musicService = container.resolve(MusicService);
    musicService.init();

    client.on(Events.Raw, (packet: any) => {
      if (packet.t === 'VOICE_SERVER_UPDATE' || packet.t === 'VOICE_STATE_UPDATE') {
        musicService.manager.updateVoiceState(packet);
      }
    });

    const modmailService = container.resolve(ModmailService);
    modmailService.registerHandlers();

    const honeypotService = container.resolve(HoneypotService);
    honeypotService.registerHandlers();

    const honeypotHosted = container.resolve(HoneypotHostedService);
    honeypotHosted.start();

    console.log(`Logged in as ${client.user!.tag}`);
    await registerCommands(commands, client.user!.id);
  });

  client.on('interactionCreate', async interaction => {
    if (interaction.isAutocomplete()) {
      if (interaction.commandName === 'modmail') {
        await modmail.autocomplete(interaction);
      }
      return;
    }
    if (interaction.isChatInputCommand()) {
      await handleInteraction(interaction);
    }
  });

  await client.login(config.discord.token);
}

main().catch(e => {
  console.error('Fatal error:', e);
  process.exit(1);
});
