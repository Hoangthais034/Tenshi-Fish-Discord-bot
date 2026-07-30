import 'reflect-metadata';
import { container } from 'tsyringe';
import { Client, GatewayIntentBits } from 'discord.js';
import { config } from './config.js';

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
  ],
});
container.registerInstance(Client, client);

export { container, client, config };
