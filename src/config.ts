import 'dotenv/config';

export const config = {
  discord: {
    token: process.env.DISCORD_TOKEN!,
    ownerId: process.env.DISCORD_OWNER_ID ?? '0',
    devGuildId: process.env.DISCORD_DEV_GUILD_ID ?? '0',
  },

  nodelink: {
    host: process.env.NODELINK_HOST ?? 'localhost',
    port: Number(process.env.NODELINK_PORT) || 2333,
    password: process.env.NODELINK_PASSWORD ?? 'youshallnotpass',
    secure: false,
  },

  modmail: {
    guildId: process.env.MODMAIL_GUILD_ID ?? '',
    categoryId: process.env.MODMAIL_CATEGORY_ID ?? '0',
  },
};
