import { SlashCommandBuilder, type ChatInputCommandInteraction, EmbedBuilder, MessageFlags } from 'discord.js';
import type { Command } from '../types.js';
import { t } from '../locales/index.js';

const data = new SlashCommandBuilder()
  .setName('help')
  .setDescription(t('cmd.help.desc'));

async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const embed = new EmbedBuilder()
    .setTitle(t('help.title'))
    .setColor(0x5865f2)
    .addFields(
      { name: t('help.music_name'), value: t('help.music') },
      { name: t('help.modmail_reply_name'), value: t('help.modmail_reply') },
      { name: t('help.modmail_ticket_name'), value: t('help.modmail_ticket') },
      { name: t('help.modmail_snippet_name'), value: t('help.modmail_snippet') },
      { name: t('help.modmail_logs_name'), value: t('help.modmail_logs') },
      { name: t('help.modmail_admin_name'), value: t('help.modmail_admin') },
      { name: t('help.honeypot_name'), value: t('help.honeypot') },
    )
    .setTimestamp();

  await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}

export const commands: Command[] = [{ data, execute }];
