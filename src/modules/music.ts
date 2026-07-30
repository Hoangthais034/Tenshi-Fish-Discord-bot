import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  type GuildMember,
  EmbedBuilder,
  Colors,
} from 'discord.js';
import { container } from 'tsyringe';
import { MusicService, type MusicResult } from '../services/music.js';
import type { Command } from '../types.js';
import { t } from '../locales/index.js';

const musicService = container.resolve(MusicService);

const embedColors: Record<string, number> = {
  play: Colors.Green,
  skip: Colors.Orange,
  stop: Colors.Red,
  queue: Colors.Blue,
  pause: Colors.Yellow,
  resume: Colors.Green,
  nowplaying: Colors.Purple,
  volume: Colors.Aqua,
  shuffle: Colors.DarkPurple,
  loop: Colors.Gold,
};

function buildEmbed(sub: string, result: MusicResult, user: GuildMember): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setColor(embedColors[sub] ?? Colors.Default)
    .setDescription(result.text)
    .setFooter({ text: user.displayName, iconURL: user.displayAvatarURL() })
    .setTimestamp();

  if (result.track?.artworkUrl) {
    embed.setThumbnail(result.track.artworkUrl);
  }

  return embed;
}

const builder = new SlashCommandBuilder()
  .setName('music')
  .setDescription(t('cmd.music.desc'))
  .addSubcommand(sub =>
    sub
      .setName('play')
      .setDescription(t('cmd.music.play.desc'))
      .addStringOption(opt => opt.setName('query').setDescription(t('cmd.music.play.opt_query')).setRequired(true)),
  )
  .addSubcommand(sub => sub.setName('skip').setDescription(t('cmd.music.skip.desc')))
  .addSubcommand(sub => sub.setName('stop').setDescription(t('cmd.music.stop.desc')))
  .addSubcommand(sub => sub.setName('queue').setDescription(t('cmd.music.queue.desc')))
  .addSubcommand(sub => sub.setName('pause').setDescription(t('cmd.music.pause.desc')))
  .addSubcommand(sub => sub.setName('resume').setDescription(t('cmd.music.resume.desc')))
  .addSubcommand(sub => sub.setName('nowplaying').setDescription(t('cmd.music.nowplaying.desc')))
  .addSubcommand(sub =>
    sub
      .setName('volume')
      .setDescription(t('cmd.music.volume.desc'))
      .addNumberOption(opt => opt.setName('volume').setDescription(t('cmd.music.volume.opt_volume')).setRequired(true)),
  )
  .addSubcommand(sub => sub.setName('shuffle').setDescription(t('cmd.music.shuffle.desc')))
  .addSubcommand(sub =>
    sub
      .setName('loop')
      .setDescription(t('cmd.music.loop.desc'))
      .addStringOption(opt =>
        opt
          .setName('mode')
          .setDescription(t('cmd.music.loop.opt_mode'))
          .addChoices(
            { name: t('cmd.music.loop.choice_off'), value: 'off' },
            { name: t('cmd.music.loop.choice_track'), value: 'track' },
            { name: t('cmd.music.loop.choice_queue'), value: 'queue' },
          )
          .setRequired(true),
      ),
  ) as unknown as SlashCommandBuilder;

const data = builder;

async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply();

  const member = interaction.member as GuildMember | null;
  const voiceChannel = member?.voice.channel;
  if (!voiceChannel) {
    await interaction.editReply(t('music.voice_required'));
    return;
  }

  const sub = interaction.options.getSubcommand();
  const guildId = interaction.guildId!;
  let result: MusicResult;

  try {
    switch (sub) {
      case 'play': {
        const query = interaction.options.getString('query', true);
        result = await musicService.play(guildId, voiceChannel.id, query, interaction.channelId ?? undefined);
        break;
      }
      case 'skip':
        result = await musicService.skip(guildId);
        break;
      case 'stop':
        result = await musicService.stop(guildId);
        break;
      case 'queue':
        result = await musicService.getQueue(guildId);
        break;
      case 'pause':
        result = await musicService.pause(guildId);
        break;
      case 'resume':
        result = await musicService.resume(guildId);
        break;
      case 'nowplaying':
        result = await musicService.nowPlaying(guildId);
        break;
      case 'volume': {
        const volume = interaction.options.getNumber('volume', true);
        result = await musicService.setVolume(guildId, volume);
        break;
      }
      case 'shuffle':
        result = await musicService.shuffle(guildId);
        break;
      case 'loop': {
        const mode = interaction.options.getString('mode', true) as 'off' | 'track' | 'queue';
        result = await musicService.setLoop(guildId, mode);
        break;
      }
      default:
        result = { text: t('modmail.errors.unknown_command') };
    }
  } catch (e) {
    console.error('Music command error:', e);
    result = { text: t('errors.command_error') };
  }

  await interaction.editReply({ embeds: [buildEmbed(sub, result, member!)] });
}

export const commands: Command[] = [{ data, execute }];