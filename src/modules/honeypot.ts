import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  type TextChannel,
  type GuildTextBasedChannel,
  Colors,
  EmbedBuilder,
  MessageFlags,
} from 'discord.js';
import { container } from 'tsyringe';
import { HoneypotService } from '../services/honeypot.js';
import type { Command } from '../types.js';

const honeypot = container.resolve(HoneypotService);

const data = new SlashCommandBuilder()
  .setName('honeypot')
  .setDescription('Cấu hình bot bẫy spam')
  .addSubcommand(sub =>
    sub.setName('setup').setDescription('Thiết lập channel bẫy, channel log và action')
      .addChannelOption(opt => opt.setName('trap-channel').setDescription('Channel dùng làm bẫy').setRequired(true))
      .addChannelOption(opt => opt.setName('log-channel').setDescription('Channel để log trigger').setRequired(true))
      .addStringOption(opt => opt.setName('action').setDescription('Hành động khi trigger')
        .addChoices(
          { name: 'Kick', value: 'Kick' },
          { name: 'Ban', value: 'Ban' },
          { name: 'Softban', value: 'Softban' },
        )))
  .addSubcommand(sub =>
    sub.setName('disable').setDescription('Tắt honeypot cho server này'))
  .addSubcommand(sub =>
    sub.setName('messages').setDescription('Tùy chỉnh tin nhắn DM và warning')
      .addStringOption(opt => opt.setName('dm-message').setDescription('Tin nhắn DM gửi tới user khi trigger (để trống = mặc định)'))
      .addStringOption(opt => opt.setName('warning-message').setDescription('Tin nhắn warning trong trap channel (để trống = mặc định)')))
  .addSubcommand(sub =>
    sub.setName('experiment').setDescription('Bật/tắt experiment cho honeypot')
      .addStringOption(opt => opt.setName('experiment').setDescription('Experiment cần bật/tắt').setRequired(true)
        .addChoices(
          { name: 'TimeoutFirst', value: 'TimeoutFirst' },
          { name: 'NoDm', value: 'NoDm' },
          { name: 'NoWarningMsg', value: 'NoWarningMsg' },
          { name: 'RandomChannelName', value: 'RandomChannelName' },
        ))
      .addBooleanOption(opt => opt.setName('enabled').setDescription('Bật hay tắt')))
  .addSubcommand(sub =>
    sub.setName('add-trap').setDescription('Thêm channel bẫy mới')
      .addChannelOption(opt => opt.setName('channel').setDescription('Channel bẫy mới').setRequired(true)))
  .addSubcommand(sub =>
    sub.setName('remove-trap').setDescription('Xóa channel bẫy')
      .addChannelOption(opt => opt.setName('channel').setDescription('Channel cần xóa khỏi trap').setRequired(true)))
  .setDefaultMemberPermissions(0) as unknown as SlashCommandBuilder;

const EXPERIMENT_FLAGS: Record<string, number> = {
  TimeoutFirst: 1,
  NoDm: 2,
  NoWarningMsg: 4,
  RandomChannelName: 8,
};

async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const sub = interaction.options.getSubcommand();
  const settings = honeypot.getOrCreate(interaction.guildId!);

  try {
    switch (sub) {
      case 'setup': {
        const trapChannel = interaction.options.getChannel('trap-channel', true) as TextChannel;
        const logChannel = interaction.options.getChannel('log-channel', true) as TextChannel;
        const action = interaction.options.getString('action') ?? 'Kick';

        settings.log_channel_id = logChannel.id;
        settings.action = action;

        const trapInfo = { channelId: trapChannel.id, warningMessageId: null as string | null, triggerCount: 0 };
        const existing = settings.trapChannels.find(t => t.channelId === trapChannel.id);
        if (!existing) {
          settings.trapChannels.push(trapInfo);
          await honeypot.postWarningMessage(trapChannel, settings as any, trapInfo);
        }

        honeypot.save(settings as any);
        await interaction.reply({ content: `✅ Đã thiết lập: trap = ${trapChannel}, log = ${logChannel}, action = ${action}.`, flags: MessageFlags.Ephemeral });
        break;
      }

      case 'disable':
        settings.action = 'Disabled';
        honeypot.save(settings as any);
        await interaction.reply({ content: '✅ Đã tắt honeypot.', flags: MessageFlags.Ephemeral });
        break;

      case 'messages': {
        const dmMessage = interaction.options.getString('dm-message');
        const warningMessage = interaction.options.getString('warning-message');
        if (dmMessage) settings.dm_message = dmMessage;
        if (warningMessage) settings.warning_message = warningMessage;
        honeypot.save(settings as any);
        await interaction.reply({ content: '✅ Đã cập nhật tin nhắn.', flags: MessageFlags.Ephemeral });
        break;
      }

      case 'experiment': {
        const experiment = interaction.options.getString('experiment', true);
        const enabled = interaction.options.getBoolean('enabled') ?? true;
        const flag = EXPERIMENT_FLAGS[experiment];

        const current = settings.experiments as number;
        settings.experiments = enabled ? current | flag : current & ~flag;

        honeypot.save(settings as any);
        const status = honeypot.getExperimentStatus(settings.experiments);
        await interaction.reply({ content: `✅ Experiment \`${experiment}\` ${enabled ? 'bật' : 'tắt'}.\nHiện tại: ${status}`, flags: MessageFlags.Ephemeral });
        break;
      }

      case 'add-trap': {
        const channel = interaction.options.getChannel('channel', true) as TextChannel;
        if (settings.trapChannels.some(t => t.channelId === channel.id)) {
          await interaction.reply({ content: 'Channel này đã là trap rồi.', flags: MessageFlags.Ephemeral });
          return;
        }

        const info = { channelId: channel.id, warningMessageId: null as string | null, triggerCount: 0 };
        settings.trapChannels.push(info);
        await honeypot.postWarningMessage(channel, settings as any, info);
        honeypot.save(settings as any);
        await interaction.reply({ content: `✅ Đã thêm ${channel} làm trap channel.`, flags: MessageFlags.Ephemeral });
        break;
      }

      case 'remove-trap': {
        const channel = interaction.options.getChannel('channel', true) as TextChannel;
        const before = settings.trapChannels.length;
        settings.trapChannels = settings.trapChannels.filter(t => t.channelId !== channel.id);
        if (settings.trapChannels.length === before) {
          await interaction.reply({ content: 'Channel này không phải trap.', flags: MessageFlags.Ephemeral });
        } else {
          honeypot.save(settings as any);
          await interaction.reply({ content: `✅ Đã xóa ${channel} khỏi trap channel.`, flags: MessageFlags.Ephemeral });
        }
        break;
      }
    }
  } catch (e) {
    console.error('Honeypot command error:', e);
    await interaction.reply({ content: '❌ Lỗi khi thực hiện lệnh.', flags: MessageFlags.Ephemeral });
  }
}

export const commands: Command[] = [{ data, execute }];
