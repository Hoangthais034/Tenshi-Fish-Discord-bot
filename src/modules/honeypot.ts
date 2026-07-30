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
import { t } from '../locales/index.js';

const honeypot = container.resolve(HoneypotService);

const data = new SlashCommandBuilder()
  .setName('trap')
  .setDescription(t('cmd.honeypot.desc'))
  .addSubcommand(sub =>
    sub.setName('setup').setDescription(t('cmd.honeypot.setup.desc'))
      .addChannelOption(opt => opt.setName('trap-channel').setDescription(t('cmd.honeypot.setup.opt_trap_channel')).setRequired(true))
      .addChannelOption(opt => opt.setName('log-channel').setDescription(t('cmd.honeypot.setup.opt_log_channel')).setRequired(true))
      .addStringOption(opt => opt.setName('action').setDescription(t('cmd.honeypot.setup.opt_action'))
        .addChoices(
          { name: t('cmd.honeypot.setup.choice_kick'), value: 'Kick' },
          { name: t('cmd.honeypot.setup.choice_ban'), value: 'Ban' },
          { name: t('cmd.honeypot.setup.choice_softban'), value: 'Softban' },
        )))
  .addSubcommand(sub =>
    sub.setName('disable').setDescription(t('cmd.honeypot.disable.desc')))
  .addSubcommand(sub =>
    sub.setName('messages').setDescription(t('cmd.honeypot.messages.desc'))
      .addStringOption(opt => opt.setName('dm-message').setDescription(t('cmd.honeypot.messages.opt_dm_message')))
      .addStringOption(opt => opt.setName('warning-message').setDescription(t('cmd.honeypot.messages.opt_warning_message'))))
  .addSubcommand(sub =>
    sub.setName('experiment').setDescription(t('cmd.honeypot.experiment.desc'))
      .addStringOption(opt => opt.setName('experiment').setDescription(t('cmd.honeypot.experiment.opt_experiment')).setRequired(true)
        .addChoices(
          { name: t('cmd.honeypot.experiment.choice_timeout_first'), value: 'TimeoutFirst' },
          { name: t('cmd.honeypot.experiment.choice_no_dm'), value: 'NoDm' },
          { name: t('cmd.honeypot.experiment.choice_no_warning_msg'), value: 'NoWarningMsg' },
          { name: t('cmd.honeypot.experiment.choice_random_channel_name'), value: 'RandomChannelName' },
        ))
      .addBooleanOption(opt => opt.setName('enabled').setDescription(t('cmd.honeypot.experiment.opt_enabled'))))
  .addSubcommand(sub =>
    sub.setName('add-trap').setDescription(t('cmd.honeypot.add_trap.desc'))
      .addChannelOption(opt => opt.setName('channel').setDescription(t('cmd.honeypot.add_trap.opt_channel')).setRequired(true)))
  .addSubcommand(sub =>
    sub.setName('remove-trap').setDescription(t('cmd.honeypot.remove_trap.desc'))
      .addChannelOption(opt => opt.setName('channel').setDescription(t('cmd.honeypot.remove_trap.opt_channel')).setRequired(true)))
  .addSubcommand(sub =>
    sub.setName('stats').setDescription(t('cmd.honeypot.stats.desc')))
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
        await interaction.reply({ content: t('honeypot.setup_done', { channel: String(trapChannel), logChannel: String(logChannel), action }), flags: MessageFlags.Ephemeral });
        break;
      }

      case 'disable':
        settings.action = 'Disabled';
        honeypot.save(settings as any);
        await interaction.reply({ content: t('honeypot.disabled'), flags: MessageFlags.Ephemeral });
        break;

      case 'messages': {
        const dmMessage = interaction.options.getString('dm-message');
        const warningMessage = interaction.options.getString('warning-message');
        if (dmMessage) settings.dm_message = dmMessage;
        if (warningMessage) settings.warning_message = warningMessage;
        honeypot.save(settings as any);
        await interaction.reply({ content: t('honeypot.messages_updated'), flags: MessageFlags.Ephemeral });
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
        await interaction.reply({ content: t('honeypot.experiment_toggle', { experiment, status: enabled ? t('honeypot.enabled') : t('honeypot.disabled_label'), experiments: status }), flags: MessageFlags.Ephemeral });
        break;
      }

      case 'add-trap': {
        const channel = interaction.options.getChannel('channel', true) as TextChannel;
        if (settings.trapChannels.some(t => t.channelId === channel.id)) {
          await interaction.reply({ content: t('honeypot.already_trap'), flags: MessageFlags.Ephemeral });
          return;
        }

        const info = { channelId: channel.id, warningMessageId: null as string | null, triggerCount: 0 };
        settings.trapChannels.push(info);
        await honeypot.postWarningMessage(channel, settings as any, info);
        honeypot.save(settings as any);
        await interaction.reply({ content: t('honeypot.trap_added', { channel: String(channel) }), flags: MessageFlags.Ephemeral });
        break;
      }

      case 'remove-trap': {
        const channel = interaction.options.getChannel('channel', true) as TextChannel;
        const before = settings.trapChannels.length;
        settings.trapChannels = settings.trapChannels.filter(t => t.channelId !== channel.id);
        if (settings.trapChannels.length === before) {
          await interaction.reply({ content: t('honeypot.not_trap'), flags: MessageFlags.Ephemeral });
        } else {
          honeypot.save(settings as any);
          await interaction.reply({ content: t('honeypot.trap_removed', { channel: String(channel) }), flags: MessageFlags.Ephemeral });
        }
        break;
      }

      case 'stats': {
        const totalTriggers = settings.trapChannels.reduce((s, t) => s + t.triggerCount, 0);
        const trapList = settings.trapChannels.map(tr => `<#${tr.channelId}> — ${t('honeypot.trigger_count', { count: tr.triggerCount })}`).join('\n') || t('honeypot.stats_no_traps');
        const embed = new EmbedBuilder()
          .setTitle(t('honeypot.stats_title'))
          .setColor(Colors.Blue)
          .addFields(
            { name: t('honeypot.stats_status'), value: settings.action, inline: true },
            { name: t('honeypot.stats_trap_count'), value: String(settings.trapChannels.length), inline: true },
            { name: t('honeypot.stats_trigger_total'), value: String(totalTriggers), inline: true },
            { name: t('honeypot.stats_traps'), value: trapList },
            { name: t('honeypot.stats_experiments'), value: honeypot.getExperimentStatus(settings.experiments) },
          );
        if (settings.log_channel_id) {
          embed.addFields({ name: t('honeypot.stats_log'), value: `<#${settings.log_channel_id}>` });
        }
        await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
        break;
      }
    }
  } catch (e) {
    console.error('Honeypot command error:', e);
    await interaction.reply({ content: t('errors.command_error'), flags: MessageFlags.Ephemeral });
  }
}

export const commands: Command[] = [{ data, execute }];
