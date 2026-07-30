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

const modmail = container.resolve(ModmailService);

function isTextChannel(channel: GuildTextBasedChannel | null): channel is TextChannel {
  return channel !== null && 'guild' in channel;
}

const data = new SlashCommandBuilder()
  .setName('modmail')
  .setDescription('Quản lý ticket hỗ trợ')

  // ─── Top-level commands ─────────────────────────────────────────────────
  .addSubcommand(sub =>
    sub.setName('reply').setDescription('Trả lời ticket (embed)')
      .addStringOption(opt => opt.setName('message').setDescription('Nội dung tin nhắn').setRequired(true)))
  .addSubcommand(sub =>
    sub.setName('preply').setDescription('Trả lời dạng text (không embed)')
      .addStringOption(opt => opt.setName('message').setDescription('Nội dung tin nhắn').setRequired(true)))
  .addSubcommand(sub =>
    sub.setName('areply').setDescription('Trả lời ẩn danh (embed)')
      .addStringOption(opt => opt.setName('message').setDescription('Nội dung tin nhắn').setRequired(true)))
  .addSubcommand(sub =>
    sub.setName('pareply').setDescription('Trả lời ẩn danh dạng text')
      .addStringOption(opt => opt.setName('message').setDescription('Nội dung tin nhắn').setRequired(true)))
  .addSubcommand(sub =>
    sub.setName('close').setDescription('Đóng ticket hiện tại')
      .addStringOption(opt => opt.setName('reason').setDescription('Lý do đóng'))
      .addBooleanOption(opt => opt.setName('silent').setDescription('Không gửi thông báo')))
  .addSubcommand(sub =>
    sub.setName('edit').setDescription('Sửa tin nhắn reply đã gửi')
      .addStringOption(opt => opt.setName('message-id').setDescription('ID tin nhắn (lấy từ footer)').setRequired(true))
      .addStringOption(opt => opt.setName('new-content').setDescription('Nội dung mới').setRequired(true)))
  .addSubcommand(sub =>
    sub.setName('delete').setDescription('Xoá tin nhắn reply đã gửi')
      .addStringOption(opt => opt.setName('message-id').setDescription('ID tin nhắn (lấy từ footer)').setRequired(true)))
  .addSubcommand(sub =>
    sub.setName('move').setDescription('Di chuyển ticket sang category khác')
      .addChannelOption(opt => opt.setName('category').setDescription('Category mới').setRequired(true)))
  .addSubcommand(sub =>
    sub.setName('note').setDescription('Thêm ghi chú nội bộ')
      .addStringOption(opt => opt.setName('message').setDescription('Nội dung ghi chú').setRequired(true))
      .addBooleanOption(opt => opt.setName('persistent').setDescription('Ghim vĩnh viễn')))

  // ─── Snippet group ──────────────────────────────────────────────────────
  .addSubcommandGroup(group =>
    group.setName('snippet').setDescription('Quản lý câu trả lời mẫu')
      .addSubcommand(sub =>
        sub.setName('send').setDescription('Gửi snippet vào ticket')
          .addStringOption(opt => opt.setName('name').setDescription('Tên snippet').setRequired(true).setAutocomplete(true)))
      .addSubcommand(sub =>
        sub.setName('raw').setDescription('Xem nội dung gốc')
          .addStringOption(opt => opt.setName('name').setDescription('Tên snippet').setRequired(true).setAutocomplete(true)))
      .addSubcommand(sub =>
        sub.setName('add').setDescription('Thêm snippet mới')
          .addStringOption(opt => opt.setName('name').setDescription('Tên snippet').setRequired(true))
          .addStringOption(opt => opt.setName('content').setDescription('Nội dung').setRequired(true)))
      .addSubcommand(sub =>
        sub.setName('edit').setDescription('Sửa nội dung snippet')
          .addStringOption(opt => opt.setName('name').setDescription('Tên snippet').setRequired(true).setAutocomplete(true))
          .addStringOption(opt => opt.setName('content').setDescription('Nội dung mới').setRequired(true)))
      .addSubcommand(sub =>
        sub.setName('remove').setDescription('Xoá snippet')
          .addStringOption(opt => opt.setName('name').setDescription('Tên snippet').setRequired(true).setAutocomplete(true)))
      .addSubcommand(sub =>
        sub.setName('list').setDescription('Danh sách snippet')))

  // ─── Logs group ─────────────────────────────────────────────────────────
  .addSubcommandGroup(group =>
    group.setName('logs').setDescription('Tra cứu log')
      .addSubcommand(sub =>
        sub.setName('user').setDescription('Xem lịch sử ticket của người dùng')
          .addUserOption(opt => opt.setName('user').setDescription('Người dùng').setRequired(true)))
      .addSubcommand(sub =>
        sub.setName('closed-by').setDescription('Tìm ticket đã đóng bởi staff')
          .addUserOption(opt => opt.setName('staff').setDescription('Staff đã đóng').setRequired(true)))
      .addSubcommand(sub =>
        sub.setName('key').setDescription('Tìm ticket theo từ khoá')
          .addStringOption(opt => opt.setName('keyword').setDescription('Từ khoá').setRequired(true)))
      .addSubcommand(sub =>
        sub.setName('responded').setDescription('Kiểm tra staff đã trả lời chưa'))
      .addSubcommand(sub =>
        sub.setName('search').setDescription('Tìm kiếm nội dung log')
          .addStringOption(opt => opt.setName('keyword').setDescription('Từ khoá').setRequired(true))))

  // ─── Admin group ────────────────────────────────────────────────────────
  .addSubcommandGroup(group =>
    group.setName('admin').setDescription('Quản trị modmail')
      .addSubcommand(sub =>
        sub.setName('block').setDescription('Chặn người dùng khỏi modmail')
          .addUserOption(opt => opt.setName('user').setDescription('Người dùng').setRequired(true))
          .addStringOption(opt => opt.setName('reason').setDescription('Lý do')))
      .addSubcommand(sub =>
        sub.setName('unblock').setDescription('Bỏ chặn người dùng')
          .addUserOption(opt => opt.setName('user').setDescription('Người dùng').setRequired(true)))
      .addSubcommand(sub =>
        sub.setName('blocked').setDescription('Danh sách người dùng bị chặn'))
      .addSubcommand(sub =>
        sub.setName('whitelist').setDescription('Thêm/xoá whitelist')
          .addUserOption(opt => opt.setName('user').setDescription('Người dùng').setRequired(true))
          .addStringOption(opt => opt.setName('action').setDescription('add hoặc remove')
            .addChoices({ name: 'add', value: 'add' }, { name: 'remove', value: 'remove' })))
      .addSubcommand(sub =>
        sub.setName('contact').setDescription('Tạo ticket chủ động')
          .addUserOption(opt => opt.setName('user').setDescription('Người dùng').setRequired(true)))
      .addSubcommand(sub =>
        sub.setName('selfcontact').setDescription('Tạo ticket (hiện tên staff)')
          .addUserOption(opt => opt.setName('user').setDescription('Người dùng').setRequired(true)))
      .addSubcommand(sub =>
        sub.setName('enable').setDescription('Bật modmail')
          .addUserOption(opt => opt.setName('user').setDescription('Người dùng (bỏ trống = bật tất cả)')))
      .addSubcommand(sub =>
        sub.setName('disable').setDescription('Tắt modmail')
          .addStringOption(opt => opt.setName('mode').setDescription('Chế độ')
            .addChoices(
              { name: 'new', value: 'new' },
              { name: 'all', value: 'all' },
              { name: 'user', value: 'user' },
            ))
          .addUserOption(opt => opt.setName('user').setDescription('Người dùng (với mode=user)')))
      .addSubcommand(sub =>
        sub.setName('isenable').setDescription('Kiểm tra trạng thái modmail')
          .addUserOption(opt => opt.setName('user').setDescription('Người dùng (bỏ trống = kiểm tra chung)')))
      .addSubcommand(sub =>
        sub.setName('setup-log').setDescription('Đặt channel log ticket')
          .addChannelOption(opt => opt.setName('channel').setDescription('Channel log (bỏ trống = xoá)')))
      .addSubcommand(sub =>
        sub.setName('alert-role').setDescription('Đặt role ping khi có ticket mới')
          .addRoleOption(opt => opt.setName('role').setDescription('Role (bỏ trống = xoá)')))
      .addSubcommand(sub =>
        sub.setName('greeting').setDescription('Set tin nhắn chào khi tạo ticket')
          .addStringOption(opt => opt.setName('message').setDescription('Nội dung (bỏ trống = tắt)'))))

  // ─── Ticket group ───────────────────────────────────────────────────────
  .addSubcommandGroup(group =>
    group.setName('ticket').setDescription('Quản lý ticket')
      .addSubcommand(sub =>
        sub.setName('title').setDescription('Đặt tiêu đề ticket')
          .addStringOption(opt => opt.setName('title').setDescription('Tiêu đề mới').setRequired(true)))
      .addSubcommand(sub =>
        sub.setName('adduser').setDescription('Thêm người dùng vào ticket')
          .addUserOption(opt => opt.setName('user').setDescription('Người dùng').setRequired(true)))
      .addSubcommand(sub =>
        sub.setName('removeuser').setDescription('Xoá người dùng khỏi ticket')
          .addUserOption(opt => opt.setName('user').setDescription('Người dùng').setRequired(true)))
      .addSubcommand(sub =>
        sub.setName('repair').setDescription('Sửa ticket (webhook, permissions)'))
      .addSubcommand(sub =>
        sub.setName('snooze').setDescription('Tạm gác ticket')
          .addIntegerOption(opt => opt.setName('minutes').setDescription('Số phút')))
      .addSubcommand(sub =>
        sub.setName('unsnooze').setDescription('Mở lại ticket'))
      .addSubcommand(sub =>
        sub.setName('snoozed').setDescription('Danh sách ticket đang gác'))
      .addSubcommand(sub =>
        sub.setName('clearsnoozed').setDescription('Xoá gác tất cả ticket'))
      .addSubcommand(sub =>
        sub.setName('nsfw').setDescription('Đánh dấu NSFW'))
      .addSubcommand(sub =>
        sub.setName('sfw').setDescription('Đánh dấu SFW'))
      .addSubcommand(sub =>
        sub.setName('notify').setDescription('Bật/tắt thông báo reply'))
      .addSubcommand(sub =>
        sub.setName('subscribe').setDescription('Nhận DM khi user trả lời'))
      .addSubcommand(sub =>
        sub.setName('msglink').setDescription('Link tới tin nhắn reply')
          .addStringOption(opt => opt.setName('message-id').setDescription('ID tin nhắn (từ footer)').setRequired(true)))
      .addSubcommand(sub =>
        sub.setName('loglink').setDescription('Link tới channel ticket')))
  .setDefaultMemberPermissions(0) as unknown as SlashCommandBuilder;

async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const channel = interaction.channel as GuildTextBasedChannel | null;
  if (!isTextChannel(channel)) {
    await interaction.reply({ content: 'Lệnh này chỉ dùng được trong text channel.', flags: MessageFlags.Ephemeral });
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
          if (!member) { result = 'Không thể xác định người dùng.'; break; }
          result = await modmail.reply(channel, member, interaction.options.getString('message', true));
          break;
        case 'preply':
          if (!member) { result = 'Không thể xác định người dùng.'; break; }
          result = await modmail.plainReply(channel, member, interaction.options.getString('message', true));
          break;
        case 'areply':
          result = await modmail.anonymousReply(channel, interaction.options.getString('message', true));
          break;
        case 'pareply':
          result = await modmail.plainAnonymousReply(channel, interaction.options.getString('message', true));
          break;
        case 'close':
          if (!member) { result = 'Không thể xác định người dùng.'; break; }
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
          if (!member) { result = 'Không thể xác định người dùng.'; break; }
          if (interaction.options.getBoolean('persistent') ?? false) {
            result = await modmail.persistentNote(channel, member, interaction.options.getString('message', true));
          } else {
            result = await modmail.note(channel, member, interaction.options.getString('message', true));
          }
          break;
        default:
          result = 'Unknown command.';
      }
    } else if (group === 'snippet') {
      switch (sub) {
        case 'send':
          if (!member) { result = 'Không thể xác định người dùng.'; break; }
          result = await modmail.replyWithSnippet(channel, member, interaction.options.getString('name', true));
          break;
        case 'raw':
          result = modmail.getSnippetRaw(interaction.guildId!, interaction.options.getString('name', true)) ?? `Không tìm thấy snippet.`;
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
            result = 'Chưa có snippet nào.';
          } else {
            const desc = snippets.map(s => `\`${s.name}\``).join('\n');
            await interaction.reply({ embeds: [new EmbedBuilder().setTitle(`Snippets (${snippets.length})`).setDescription(desc).setColor(Colors.Blue)], flags: MessageFlags.Ephemeral });
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
            result = 'Không có người dùng nào bị chặn.';
          } else {
            const lines = blocked.map(b => `<@${b.user_id}> — ${b.reason ?? 'Không có lý do'} (bởi <@${b.blocked_by_staff_id}>)`);
            await interaction.reply({ embeds: [new EmbedBuilder().setTitle(`Danh sách chặn (${blocked.length})`).setDescription(lines.join('\n')).setColor(Colors.Red)], flags: MessageFlags.Ephemeral });
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
          if (!member) { result = 'Không thể xác định người dùng.'; break; }
          result = await modmail.selfContact(member, interaction.options.getUser('user', true));
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
      }
    } else if (group === 'ticket') {
      switch (sub) {
        case 'title':
          if (!member) { result = 'Không thể xác định người dùng.'; break; }
          result = await modmail.setTicketTitle(channel, member, interaction.options.getString('title', true));
          break;
        case 'adduser': {
          const target = interaction.options.getMember('user');
          if (!target) { result = 'Không tìm thấy người dùng này trong guild.'; break; }
          result = await modmail.addUserToTicket(channel, target as GuildMember);
          break;
        }
        case 'removeuser': {
          const target = interaction.options.getMember('user');
          if (!target) { result = 'Không tìm thấy người dùng này trong guild.'; break; }
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
      }
    }
  } catch (e) {
    console.error('Modmail command error:', e);
    result = '❌ Lỗi khi thực hiện lệnh.';
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
