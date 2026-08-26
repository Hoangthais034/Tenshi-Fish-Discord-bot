import 'reflect-metadata';
import { config, client, container } from './di.js';
import { handleInteraction, loadCommandMap } from './handlers/interaction.js';
import { registerCommands } from './handlers/register.js';
import { MusicService } from './services/music.js';
import { ModmailService } from './services/modmail.js';
import { HoneypotService } from './services/honeypot.js';
import { HoneypotHostedService } from './services/honeypot-hosted.js';
import { TouchGrassSchedulerService } from './services/touch-grass-scheduler.js';
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

  const touchGrass = await import('./modules/touch-grass.js');
  commands.push(...touchGrass.commands);

  loadCommandMap(commands);

  client.on('error', (e: Error) => {
    console.error('Client error:', e);
  });

  client.once('clientReady', async () => {
    const musicService = container.resolve(MusicService);
    musicService.init();

    musicService.forwardVoiceEvents();

    const modmailService = container.resolve(ModmailService);
    modmailService.registerHandlers();

    const honeypotService = container.resolve(HoneypotService);
    honeypotService.registerHandlers();

    const honeypotHosted = container.resolve(HoneypotHostedService);
    honeypotHosted.start();

    const touchGrassScheduler = container.resolve(TouchGrassSchedulerService);
    touchGrassScheduler.start();

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
      return;
    }
    if (interaction.isModalSubmit() && touchGrass.isTouchGrassModal(interaction.customId)) {
      await touchGrass.modalSubmit(interaction).catch(e => console.error('Touch-grass modal error:', e));
      return;
    }
    if (interaction.isButton() && touchGrass.isTouchGrassButton(interaction.customId)) {
      await touchGrass.button(interaction).catch(e => console.error('Touch-grass button error:', e));
      return;
    }
    if (interaction.isStringSelectMenu() && touchGrass.isTouchGrassStringSelect(interaction.customId)) {
      await touchGrass.stringSelect(interaction).catch(e => console.error('Touch-grass select error:', e));
      return;
    }
    if (interaction.isChannelSelectMenu() && touchGrass.isTouchGrassChannelSelect(interaction.customId)) {
      await touchGrass.channelSelect(interaction).catch(e => console.error('Touch-grass select error:', e));
      return;
    }
  });

  await client.login(config.discord.token);
}

main().catch(e => {
  console.error('Fatal error:', e);
  process.exit(1);
});
