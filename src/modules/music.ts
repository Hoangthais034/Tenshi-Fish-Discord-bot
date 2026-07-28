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
  .setDescription('Lệnh điều khiển nhạc')
  .addSubcommand(sub =>
    sub
      .setName('play')
      .setDescription('Phát nhạc từ tên bài hoặc URL YouTube')
      .addStringOption(opt => opt.setName('query').setDescription('Tên bài hát hoặc URL YouTube').setRequired(true)),
  )
  .addSubcommand(sub => sub.setName('skip').setDescription('Bỏ qua bài đang phát'))
  .addSubcommand(sub => sub.setName('stop').setDescription('Dừng phát nhạc và rời voice channel'))
  .addSubcommand(sub => sub.setName('queue').setDescription('Xem hàng đợi hiện tại'))
  .addSubcommand(sub => sub.setName('pause').setDescription('Tạm dừng phát nhạc'))
  .addSubcommand(sub => sub.setName('resume').setDescription('Tiếp tục phát nhạc'))
  .addSubcommand(sub => sub.setName('nowplaying').setDescription('Xem bài đang phát'))
  .addSubcommand(sub =>
    sub
      .setName('volume')
      .setDescription('Chỉnh âm lượng (0-200)')
      .addNumberOption(opt => opt.setName('volume').setDescription('Âm lượng từ 0 đến 200').setRequired(true)),
  )
  .addSubcommand(sub => sub.setName('shuffle').setDescription('Xáo trộn hàng đợi'))
  .addSubcommand(sub =>
    sub
      .setName('loop')
      .setDescription('Chọn chế độ lặp lại')
      .addStringOption(opt =>
        opt
          .setName('mode')
          .setDescription('Chế độ lặp')
          .addChoices(
            { name: 'None', value: 'none' },
            { name: 'Track', value: 'track' },
            { name: 'Queue', value: 'queue' },
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
    await interaction.editReply('Bạn cần vào voice channel trước.');
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
        const mode = interaction.options.getString('mode', true) as 'none' | 'track' | 'queue';
        result = await musicService.setLoop(guildId, mode);
        break;
      }
      default:
        result = { text: 'Unknown subcommand.' };
    }
  } catch (e) {
    console.error('Music command error:', e);
    result = { text: '❌ Lỗi khi thực hiện lệnh.' };
  }

  await interaction.editReply({ embeds: [buildEmbed(sub, result, member!)] });
}

export const commands: Command[] = [{ data, execute }];
