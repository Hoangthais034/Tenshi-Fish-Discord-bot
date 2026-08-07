import 'dotenv/config';

export const config = {
  discord: {
    token: process.env.DISCORD_TOKEN!,
    ownerId: process.env.DISCORD_OWNER_ID ?? '0',
    devGuildId: process.env.DISCORD_DEV_GUILD_ID ?? '0',
  },

  lavalink: {
    host: process.env.LAVALINK_HOST ?? 'localhost',
    port: Number(process.env.LAVALINK_PORT) || 2333,
    password: process.env.LAVALINK_PASSWORD ?? 'youshallnotpass',
    secure: false,
  },

  modmail: {
    guildIds: (process.env.MODMAIL_GUILD_IDS ?? process.env.MODMAIL_GUILD_ID ?? '')
      .split(',')
      .map(id => id.trim())
      .filter(Boolean),
    categoryId: process.env.MODMAIL_CATEGORY_ID ?? '0',
  },

  locale: process.env.LOCALE ?? 'en',
};
