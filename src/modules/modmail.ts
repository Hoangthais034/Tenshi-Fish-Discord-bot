import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  type AutocompleteInteraction,
  type TextChannel,
  type GuildMember,
  type GuildTextBasedChannel,
  EmbedBuilder,
  Colors,
  MessageFlags,
} from 'discord.js';
import { container } from 'tsyringe';
import { ModmailService } from '../services/modmail.js';
import type { Command } from '../types.js';
import { t } from '../locales/index.js';

const modmail = container.resolve(ModmailService);

function isTextChannel(channel: GuildTextBasedChannel | null): channel is TextChannel {
  return channel !== null && 'guild' in channel;
}

const data = new SlashCommandBuilder()
  .setName('modmail')
  .setDescription(t('cmd.modmail.desc'))

  // ─── Top-level commands ─────────────────────────────────────────────────
  .addSubcommand(sub =>
    sub.setName('reply').setDescription(t('cmd.modmail.reply.desc'))
      .addStringOption(opt => opt.setName('message').setDescription(t('cmd.modmail.reply.opt_message')).setRequired(true)))
  .addSubcommand(sub =>
    sub.setName('preply').setDescription(t('cmd.modmail.preply.desc'))
      .addStringOption(opt => opt.setName('message').setDescription(t('cmd.modmail.preply.opt_message')).setRequired(true)))
  .addSubcommand(sub =>
    sub.setName('areply').setDescription(t('cmd.modmail.areply.desc'))
      .addStringOption(opt => opt.setName('message').setDescription(t('cmd.modmail.areply.opt_message')).setRequired(true)))
  .addSubcommand(sub =>
    sub.setName('pareply').setDescription(t('cmd.modmail.pareply.desc'))
      .addStringOption(opt => opt.setName('message').setDescription(t('cmd.modmail.pareply.opt_message')).setRequired(true)))
  .addSubcommand(sub =>
    sub.setName('close').setDescription(t('cmd.modmail.close.desc'))
      .addStringOption(opt => opt.setName('reason').setDescription(t('cmd.modmail.close.opt_reason')))
      .addBooleanOption(opt => opt.setName('silent').setDescription(t('cmd.modmail.close.opt_silent'))))
  .addSubcommand(sub =>
    sub.setName('edit').setDescription(t('cmd.modmail.edit.desc'))
      .addStringOption(opt => opt.setName('message-id').setDescription(t('cmd.modmail.edit.opt_message_id')).setRequired(true))
      .addStringOption(opt => opt.setName('new-content').setDescription(t('cmd.modmail.edit.opt_new_content')).setRequired(true)))
  .addSubcommand(sub =>
    sub.setName('delete').setDescription(t('cmd.modmail.delete.desc'))
      .addStringOption(opt => opt.setName('message-id').setDescription(t('cmd.modmail.delete.opt_message_id')).setRequired(true)))
  .addSubcommand(sub =>
    sub.setName('move').setDescription(t('cmd.modmail.move.desc'))
      .addChannelOption(opt => opt.setName('category').setDescription(t('cmd.modmail.move.opt_category')).setRequired(true)))
  .addSubcommand(sub =>
    sub.setName('note').setDescription(t('cmd.modmail.note.desc'))
      .addStringOption(opt => opt.setName('message').setDescription(t('cmd.modmail.note.opt_message')).setRequired(true))
      .addBooleanOption(opt => opt.setName('persistent').setDescription(t('cmd.modmail.note.opt_persistent'))))

  // ─── Snippet group ──────────────────────────────────────────────────────
  .addSubcommandGroup(group =>
    group.setName('snippet').setDescription(t('cmd.modmail.snippet.desc'))
      .addSubcommand(sub =>
        sub.setName('send').setDescription(t('cmd.modmail.snippet.send.desc'))
          .addStringOption(opt => opt.setName('name').setDescription(t('cmd.modmail.snippet.send.opt_name')).setRequired(true).setAutocomplete(true)))
      .addSubcommand(sub =>
        sub.setName('raw').setDescription(t('cmd.modmail.snippet.raw.desc'))
          .addStringOption(opt => opt.setName('name').setDescription(t('cmd.modmail.snippet.raw.opt_name')).setRequired(true).setAutocomplete(true)))
      .addSubcommand(sub =>
        sub.setName('add').setDescription(t('cmd.modmail.snippet.add.desc'))
          .addStringOption(opt => opt.setName('name').setDescription(t('cmd.modmail.snippet.add.opt_name')).setRequired(true))
          .addStringOption(opt => opt.setName('content').setDescription(t('cmd.modmail.snippet.add.opt_content')).setRequired(true)))
      .addSubcommand(sub =>
        sub.setName('edit').setDescription(t('cmd.modmail.snippet.edit.desc'))
          .addStringOption(opt => opt.setName('name').setDescription(t('cmd.modmail.snippet.edit.opt_name')).setRequired(true).setAutocomplete(true))
          .addStringOption(opt => opt.setName('content').setDescription(t('cmd.modmail.snippet.edit.opt_content')).setRequired(true)))
      .addSubcommand(sub =>
        sub.setName('remove').setDescription(t('cmd.modmail.snippet.remove.desc'))
          .addStringOption(opt => opt.setName('name').setDescription(t('cmd.modmail.snippet.remove.opt_name')).setRequired(true).setAutocomplete(true)))
      .addSubcommand(sub =>
        sub.setName('list').setDescription(t('cmd.modmail.snippet.list.desc'))))

  // ─── Logs group ─────────────────────────────────────────────────────────
  .addSubcommandGroup(group =>
    group.setName('logs').setDescription(t('cmd.modmail.logs.desc'))
      .addSubcommand(sub =>
        sub.setName('user').setDescription(t('cmd.modmail.logs.user.desc'))
          .addUserOption(opt => opt.setName('user').setDescription(t('cmd.modmail.logs.user.opt_user')).setRequired(true)))
      .addSubcommand(sub =>
        sub.setName('closed-by').setDescription(t('cmd.modmail.logs.closed_by.desc'))
          .addUserOption(opt => opt.setName('staff').setDescription(t('cmd.modmail.logs.closed_by.opt_staff')).setRequired(true)))
      .addSubcommand(sub =>
        sub.setName('key').setDescription(t('cmd.modmail.logs.key.desc'))
          .addStringOption(opt => opt.setName('keyword').setDescription(t('cmd.modmail.logs.key.opt_keyword')).setRequired(true)))
      .addSubcommand(sub =>
        sub.setName('responded').setDescription(t('cmd.modmail.logs.responded.desc')))
      .addSubcommand(sub =>
        sub.setName('search').setDescription(t('cmd.modmail.logs.search.desc'))
          .addStringOption(opt => opt.setName('keyword').setDescription(t('cmd.modmail.logs.search.opt_keyword')).setRequired(true))))

  // ─── Admin group ────────────────────────────────────────────────────────
  .addSubcommandGroup(group =>
    group.setName('admin').setDescription(t('cmd.modmail.admin.desc'))
      .addSubcommand(sub =>
        sub.setName('block').setDescription(t('cmd.modmail.admin.block.desc'))
          .addUserOption(opt => opt.setName('user').setDescription(t('cmd.modmail.admin.block.opt_user')).setRequired(true))
          .addStringOption(opt => opt.setName('reason').setDescription(t('cmd.modmail.admin.block.opt_reason'))))
      .addSubcommand(sub =>
        sub.setName('unblock').setDescription(t('cmd.modmail.admin.unblock.desc'))
          .addUserOption(opt => opt.setName('user').setDescription(t('cmd.modmail.admin.unblock.opt_user')).setRequired(true)))
      .addSubcommand(sub =>
        sub.setName('blocked').setDescription(t('cmd.modmail.admin.blocked.desc')))
      .addSubcommand(sub =>
        sub.setName('whitelist').setDescription(t('cmd.modmail.admin.whitelist.desc'))
          .addUserOption(opt => opt.setName('user').setDescription(t('cmd.modmail.admin.whitelist.opt_user')).setRequired(true))
          .addStringOption(opt => opt.setName('action').setDescription(t('cmd.modmail.admin.whitelist.opt_action'))
            .addChoices(
              { name: t('cmd.modmail.admin.whitelist.choice_add'), value: 'add' },
              { name: t('cmd.modmail.admin.whitelist.choice_remove'), value: 'remove' },
            )))
      .addSubcommand(sub =>
        sub.setName('contact').setDescription(t('cmd.modmail.admin.contact.desc'))
          .addUserOption(opt => opt.setName('user').setDescription(t('cmd.modmail.admin.contact.opt_user')).setRequired(true)))
      .addSubcommand(sub =>
        sub.setName('selfcontact').setDescription(t('cmd.modmail.admin.selfcontact.desc'))
          .addUserOption(opt => opt.setName('user').setDescription(t('cmd.modmail.admin.selfcontact.opt_user')).setRequired(true)))
      .addSubcommand(sub =>
        sub.setName('enable').setDescription(t('cmd.modmail.admin.enable.desc'))
          .addUserOption(opt => opt.setName('user').setDescription(t('cmd.modmail.admin.enable.opt_user'))))
      .addSubcommand(sub =>
        sub.setName('disable').setDescription(t('cmd.modmail.admin.disable.desc'))
          .addStringOption(opt => opt.setName('mode').setDescription(t('cmd.modmail.admin.disable.opt_mode'))
            .addChoices(
              { name: t('cmd.modmail.admin.disable.choice_new'), value: 'new' },
              { name: t('cmd.modmail.admin.disable.choice_all'), value: 'all' },
              { name: t('cmd.modmail.admin.disable.choice_user'), value: 'user' },
            ))
          .addUserOption(opt => opt.setName('user').setDescription(t('cmd.modmail.admin.disable.opt_user'))))
      .addSubcommand(sub =>
        sub.setName('isenable').setDescription(t('cmd.modmail.admin.isenable.desc'))
          .addUserOption(opt => opt.setName('user').setDescription(t('cmd.modmail.admin.isenable.opt_user'))))
      .addSubcommand(sub =>
        sub.setName('setup-log').setDescription(t('cmd.modmail.admin.setup_log.desc'))
          .addChannelOption(opt => opt.setName('channel').setDescription(t('cmd.modmail.admin.setup_log.opt_channel'))))
      .addSubcommand(sub =>
        sub.setName('alert-role').setDescription(t('cmd.modmail.admin.alert_role.desc'))
          .addRoleOption(opt => opt.setName('role').setDescription(t('cmd.modmail.admin.alert_role.opt_role'))))
      .addSubcommand(sub =>
        sub.setName('greeting').setDescription(t('cmd.modmail.admin.greeting.desc'))
          .addStringOption(opt => opt.setName('message').setDescription(t('cmd.modmail.admin.greeting.opt_message'))))
      .addSubcommand(sub =>
        sub.setName('staff-role').setDescription(t('cmd.modmail.admin.staff_role.desc'))
          .addStringOption(opt => opt.setName('action').setDescription(t('cmd.modmail.admin.staff_role.opt_action')).setRequired(true)
            .addChoices(
              { name: t('cmd.modmail.admin.staff_role.choice_add'), value: 'add' },
              { name: t('cmd.modmail.admin.staff_role.choice_remove'), value: 'remove' },
              { name: t('cmd.modmail.admin.staff_role.choice_list'), value: 'list' },
            ))
          .addRoleOption(opt => opt.setName('role').setDescription(t('cmd.modmail.admin.staff_role.opt_role'))))
      .addSubcommand(sub =>
        sub.setName('category').setDescription(t('cmd.modmail.admin.category.desc'))
          .addStringOption(opt => opt.setName('action').setDescription(t('cmd.modmail.admin.category.opt_action')).setRequired(true)
            .addChoices(
              { name: t('cmd.modmail.admin.category.choice_add'), value: 'add' },
              { name: t('cmd.modmail.admin.category.choice_remove'), value: 'remove' },
              { name: t('cmd.modmail.admin.category.choice_list'), value: 'list' },
            ))
          .addStringOption(opt => opt.setName('name').setDescription(t('cmd.modmail.admin.category.opt_name')))
          .addChannelOption(opt => opt.setName('parent').setDescription(t('cmd.modmail.admin.category.opt_parent')))))

  // ─── Ticket group ───────────────────────────────────────────────────────
  .addSubcommandGroup(group =>
    group.setName('ticket').setDescription(t('cmd.modmail.ticket.desc'))
      .addSubcommand(sub =>
        sub.setName('title').setDescription(t('cmd.modmail.ticket.title.desc'))
          .addStringOption(opt => opt.setName('title').setDescription(t('cmd.modmail.ticket.title.opt_title')).setRequired(true)))
      .addSubcommand(sub =>
        sub.setName('adduser').setDescription(t('cmd.modmail.ticket.adduser.desc'))
          .addUserOption(opt => opt.setName('user').setDescription(t('cmd.modmail.ticket.adduser.opt_user')).setRequired(true)))
      .addSubcommand(sub =>
        sub.setName('removeuser').setDescription(t('cmd.modmail.ticket.removeuser.desc'))
          .addUserOption(opt => opt.setName('user').setDescription(t('cmd.modmail.ticket.removeuser.opt_user')).setRequired(true)))
      .addSubcommand(sub =>
        sub.setName('repair').setDescription(t('cmd.modmail.ticket.repair.desc')))
      .addSubcommand(sub =>
        sub.setName('snooze').setDescription(t('cmd.modmail.ticket.snooze.desc'))
          .addIntegerOption(opt => opt.setName('minutes').setDescription(t('cmd.modmail.ticket.snooze.opt_minutes'))))
      .addSubcommand(sub =>
        sub.setName('unsnooze').setDescription(t('cmd.modmail.ticket.unsnooze.desc')))
      .addSubcommand(sub =>
        sub.setName('snoozed').setDescription(t('cmd.modmail.ticket.snoozed.desc')))
      .addSubcommand(sub =>
        sub.setName('clearsnoozed').setDescription(t('cmd.modmail.ticket.clearsnoozed.desc')))
      .addSubcommand(sub =>
        sub.setName('nsfw').setDescription(t('cmd.modmail.ticket.nsfw.desc')))
      .addSubcommand(sub =>
        sub.setName('sfw').setDescription(t('cmd.modmail.ticket.sfw.desc')))
      .addSubcommand(sub =>
        sub.setName('notify').setDescription(t('cmd.modmail.ticket.notify.desc')))
      .addSubcommand(sub =>
        sub.setName('subscribe').setDescription(t('cmd.modmail.ticket.subscribe.desc')))
      .addSubcommand(sub =>
        sub.setName('msglink').setDescription(t('cmd.modmail.ticket.msglink.desc'))
          .addStringOption(opt => opt.setName('message-id').setDescription(t('cmd.modmail.ticket.msglink.opt_message_id')).setRequired(true)))
      .addSubcommand(sub =>
        sub.setName('loglink').setDescription(t('cmd.modmail.ticket.loglink.desc')))
      .addSubcommand(sub =>
        sub.setName('reopen').setDescription(t('cmd.modmail.ticket.reopen.desc'))
          .addUserOption(opt => opt.setName('user').setDescription(t('cmd.modmail.ticket.reopen.opt_user')).setRequired(true))))
  .setDefaultMemberPermissions(0) as unknown as SlashCommandBuilder;

async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const channel = interaction.channel as GuildTextBasedChannel | null;
  if (!isTextChannel(channel)) {
    await interaction.reply({ content: t('modmail.errors.text_only'), flags: MessageFlags.Ephemeral });
    return;
  }

  const group = interaction.options.getSubcommandGroup(false);
  const sub = interaction.options.getSubcommand();
  const member = interaction.member as GuildMember | null;

  let result = '';

  try {
    if (!group) {
      switch (sub) {
        case 'reply':
          if (!member) { result = t('modmail.errors.member_not_found'); break; }
          result = await modmail.reply(channel, member, interaction.options.getString('message', true));
          break;
        case 'preply':
          if (!member) { result = t('modmail.errors.member_not_found'); break; }
          result = await modmail.plainReply(channel, member, interaction.options.getString('message', true));
          break;
        case 'areply':
          result = await modmail.anonymousReply(channel, interaction.options.getString('message', true));
          break;
        case 'pareply':
          result = await modmail.plainAnonymousReply(channel, interaction.options.getString('message', true));
          break;
        case 'close':
          if (!member) { result = t('modmail.errors.member_not_found'); break; }
          result = await modmail.closeTicket(channel, member, interaction.options.getString('reason'), interaction.options.getBoolean('silent') ?? false);
          break;
        case 'edit':
          result = await modmail.editReply(channel, interaction.options.getString('message-id', true), interaction.options.getString('new-content', true));
          break;
        case 'delete':
          result = await modmail.deleteReply(channel, interaction.options.getString('message-id', true));
          break;
        case 'move': {
          const category = interaction.options.getChannel('category', true);
          result = await modmail.moveTicket(channel, category.id);
          break;
        }
        case 'note':
          if (!member) { result = t('modmail.errors.member_not_found'); break; }
          if (interaction.options.getBoolean('persistent') ?? false) {
            result = await modmail.persistentNote(channel, member, interaction.options.getString('message', true));
          } else {
            result = await modmail.note(channel, member, interaction.options.getString('message', true));
          }
          break;
        default:
          result = t('modmail.errors.unknown_command');
      }
    } else if (group === 'snippet') {
      switch (sub) {
        case 'send':
          if (!member) { result = t('modmail.errors.member_not_found'); break; }
          result = await modmail.replyWithSnippet(channel, member, interaction.options.getString('name', true));
          break;
        case 'raw':
          result = modmail.getSnippetRaw(interaction.guildId!, interaction.options.getString('name', true)) ?? t('modmail.snippet.not_found', { name: interaction.options.getString('name', true) });
          break;
        case 'add':
          result = modmail.createSnippet(interaction.guildId!, interaction.options.getString('name', true), interaction.options.getString('content', true));
          break;
        case 'edit':
          result = modmail.editSnippet(interaction.guildId!, interaction.options.getString('name', true), interaction.options.getString('content', true));
          break;
        case 'remove':
          result = modmail.deleteSnippet(interaction.guildId!, interaction.options.getString('name', true));
          break;
        case 'list':
          const snippets = modmail.getSnippets(interaction.guildId!);
          if (!snippets.length) {
            result = t('modmail.snippet.list_empty');
          } else {
            const desc = snippets.map(s => `\`${s.name}\``).join('\n');
            await interaction.reply({ embeds: [new EmbedBuilder().setTitle(t('modmail.snippet.list_title', { count: snippets.length })).setDescription(desc).setColor(Colors.Blue)], flags: MessageFlags.Ephemeral });
            return;
          }
          break;
      }
    } else if (group === 'logs') {
      switch (sub) {
        case 'user': {
          const user = interaction.options.getUser('user', true);
          result = modmail.getLogsByUser(interaction.guild!, user.id);
          break;
        }
        case 'closed-by': {
          const staff = interaction.options.getUser('staff', true);
          result = modmail.getLogsClosedBy(interaction.guildId!, staff.id);
          break;
        }
        case 'key':
          result = modmail.getLogsByKeyword(interaction.guildId!, interaction.options.getString('keyword', true));
          break;
        case 'responded':
          result = modmail.getLogsResponded(channel.id);
          break;
        case 'search':
          result = modmail.searchLogs(interaction.options.getString('keyword', true));
          break;
      }
    } else if (group === 'admin') {
      switch (sub) {
        case 'block':
          result = modmail.blockUser(interaction.guildId!, interaction.options.getUser('user', true).id, interaction.options.getString('reason'), interaction.user.id);
          break;
        case 'unblock':
          result = modmail.unblockUser(interaction.guildId!, interaction.options.getUser('user', true).id);
          break;
        case 'blocked': {
          const blocked = modmail.getBlockedUsers(interaction.guildId!);
          if (!blocked.length) {
            result = t('modmail.block.list_empty');
          } else {
            const lines = blocked.map(b => `<@${b.user_id}> — ${b.reason ?? t('modmail.block.no_reason')} (${t('modmail.block.by')} <@${b.blocked_by_staff_id}>)`);
            await interaction.reply({ embeds: [new EmbedBuilder().setTitle(t('modmail.block.list_title', { count: blocked.length })).setDescription(lines.join('\n')).setColor(Colors.Red)], flags: MessageFlags.Ephemeral });
            return;
          }
          break;
        }
        case 'whitelist': {
          const user = interaction.options.getUser('user', true);
          const action = interaction.options.getString('action') ?? 'add';
          result = action === 'add'
            ? modmail.whitelistUser(interaction.guildId!, user.id, interaction.user.id)
            : modmail.unwhitelistUser(interaction.guildId!, user.id);
          break;
        }
        case 'contact':
          result = await modmail.contact(interaction.guildId!, interaction.options.getUser('user', true));
          break;
        case 'selfcontact':
          if (!member) { result = t('modmail.errors.member_not_found'); break; }
          result = await modmail.selfContact(interaction.guildId!, member, interaction.options.getUser('user', true));
          break;
        case 'enable':
          result = modmail.enableModmail(interaction.guildId!, interaction.options.getUser('user')?.id);
          break;
        case 'disable': {
          const mode = interaction.options.getString('mode') ?? 'all';
          const targetUser = interaction.options.getUser('user');
          if (mode === 'user' && targetUser) {
            result = modmail.disableModmail(interaction.guildId!, false, false, targetUser.id);
          } else {
            result = modmail.disableModmail(interaction.guildId!, mode === 'new', mode === 'all');
          }
          break;
        }
        case 'isenable':
          result = modmail.isModmailEnabled(interaction.guildId!, interaction.options.getUser('user')?.id);
          break;
        case 'setup-log': {
          const logChannel = interaction.options.getChannel('channel');
          result = modmail.setLogChannel(interaction.guildId!, logChannel?.id ?? null);
          break;
        }
        case 'alert-role': {
          const role = interaction.options.getRole('role');
          result = modmail.setAlertRole(interaction.guildId!, role?.id ?? null);
          break;
        }
        case 'greeting': {
          const msg = interaction.options.getString('message');
          result = modmail.setGreeting(interaction.guildId!, msg ?? null);
          break;
        }
        case 'staff-role': {
          const action = interaction.options.getString('action', true);
          const role = interaction.options.getRole('role');
          if (action === 'list') {
            const roles = modmail.getStaffRoles(interaction.guildId!);
            result = roles.length ? roles.map(r => `<@&${r}>`).join('\n') : t('modmail.staff_role.list_empty');
          } else {
            if (!role) { result = t('modmail.admin.role_required'); break; }
            result = action === 'add'
              ? modmail.addStaffRole(interaction.guildId!, role.id)
              : modmail.removeStaffRole(interaction.guildId!, role.id);
          }
          break;
        }
        case 'category': {
          const action = interaction.options.getString('action', true);
          if (action === 'list') {
            const cats = modmail.getCategories(interaction.guildId!);
            result = cats.length ? cats.map(c => `\`${c.name}\``).join('\n') : t('modmail.category.list_empty');
          } else {
            const name = interaction.options.getString('name');
            if (!name) { result = t('modmail.admin.name_required'); break; }
            result = action === 'add'
              ? modmail.addCategory(interaction.guildId!, name, interaction.options.getChannel('parent')?.id ?? null)
              : modmail.removeCategory(interaction.guildId!, name);
          }
          break;
        }
      }
    } else if (group === 'ticket') {
      switch (sub) {
        case 'title':
          if (!member) { result = t('modmail.errors.member_not_found'); break; }
          result = await modmail.setTicketTitle(channel, member, interaction.options.getString('title', true));
          break;
        case 'adduser': {
          const target = interaction.options.getMember('user');
          if (!target) { result = t('modmail.errors.member_not_in_guild'); break; }
          result = await modmail.addUserToTicket(channel, target as GuildMember);
          break;
        }
        case 'removeuser': {
          const target = interaction.options.getMember('user');
          if (!target) { result = t('modmail.errors.member_not_in_guild'); break; }
          result = await modmail.removeUserFromTicket(channel, target as GuildMember);
          break;
        }
        case 'repair':
          result = await modmail.repairTicket(channel);
          break;
        case 'snooze':
          result = await modmail.snoozeTicket(channel, interaction.options.getInteger('minutes') ?? 60);
          break;
        case 'unsnooze':
          result = await modmail.unsnoozeTicket(channel);
          break;
        case 'snoozed':
          result = modmail.getSnoozedTickets(interaction.guild!);
          break;
        case 'clearsnoozed':
          result = modmail.clearSnoozedTickets();
          break;
        case 'nsfw':
          result = await modmail.setNsfw(channel);
          break;
        case 'sfw':
          result = await modmail.setSfw(channel);
          break;
        case 'notify':
          result = modmail.toggleNotify(interaction.guildId!, interaction.user.id, channel.id);
          break;
        case 'subscribe':
          result = modmail.toggleSubscribe(channel.id, interaction.user.id);
          break;
        case 'msglink':
          result = modmail.getMessageLink(interaction.guildId!, channel.id, interaction.options.getString('message-id', true));
          break;
        case 'loglink':
          result = modmail.getLogLink(interaction.guildId!, channel.id);
          break;
        case 'reopen':
          if (!member) { result = t('modmail.errors.member_not_found'); break; }
          result = await modmail.reopenTicket(interaction.guild!, member, interaction.options.getUser('user', true).id);
          break;
      }
    }
  } catch (e) {
    console.error('Modmail command error:', e);
    result = t('modmail.errors.unknown');
  }

  if (result) {
    await interaction.reply({ content: result, flags: MessageFlags.Ephemeral });
  }
}

async function handleAutocomplete(interaction: AutocompleteInteraction): Promise<void> {
  const group = interaction.options.getSubcommandGroup(false);
  const sub = interaction.options.getSubcommand();
  const focused = interaction.options.getFocused().toString();
  const guildId = interaction.guildId!;
  let names: string[] = [];

  if (group === 'snippet' && ['send', 'raw', 'edit', 'remove'].includes(sub)) {
    names = modmail.autocompleteSnippets(guildId, focused);
  }

  await interaction.respond(names.map(n => ({ name: n, value: n })));
}

export const commands: Command[] = [
  {
    data,
    execute,
  },
];

export async function autocomplete(interaction: AutocompleteInteraction): Promise<void> {
  await handleAutocomplete(interaction);
}
