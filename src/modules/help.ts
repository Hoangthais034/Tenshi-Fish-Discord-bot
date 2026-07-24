import { SlashCommandBuilder, type ChatInputCommandInteraction, EmbedBuilder, MessageFlags } from 'discord.js';
import type { Command } from '../types.js';

const data = new SlashCommandBuilder()
  .setName('help')
  .setDescription('Xem danh sách lệnh của bot');

async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const embed = new EmbedBuilder()
    .setTitle('Danh sách lệnh')
    .setColor(0x5865f2)
    .addFields(
      {
        name: '🎵 Music',
        value:
          '`/music play <query>` - Phát nhạc\n' +
          '`/music skip` - Bỏ qua bài\n' +
          '`/music stop` - Dừng phát\n' +
          '`/music pause` - Tạm dừng\n' +
          '`/music resume` - Tiếp tục\n' +
          '`/music queue` - Xem hàng đợi\n' +
          '`/music nowplaying` - Bài đang phát\n' +
          '`/music volume <0-200>` - Chỉnh volume\n' +
          '`/music shuffle` - Xáo trộn\n' +
          '`/music loop <mode>` - Lặp lại',
      },
      {
        name: '📬 Modmail',
        value:
          '`/modmail reply <content>` - Trả lời ticket\n' +
          '`/modmail close [reason]` - Đóng ticket\n' +
          '`/modmail block <user> [reason]` - Chặn user\n' +
          '`/modmail unblock <user>` - Bỏ chặn user\n' +
          '`/modmail snippet <create|edit|delete>` - Quản lý snippet\n' +
          '`/modmail logs [user] [keyword]` - Xem lịch sử\n' +
          '`/modmail admin <move|cleanup>` - Quản trị\n' +
          '`/modmail contact <user> [title]` - Tạo ticket mới\n' +
          '... và nhiều hơn nữa.',
      },
      {
        name: '🍯 Honeypot',
        value:
          '`/honeypot setup` - Cấu hình honeypot\n' +
          '`/honeypot add <channel>` - Thêm trap channel\n' +
          '`/honeypot remove <channel>` - Xóa trap channel\n' +
          '`/honeypot list` - Danh sách trap\n' +
          '`/honeypot action <type>` - Chọn hành động\n' +
          '`/honeypot stats` - Thống kê',
      },
    )
    .setTimestamp();

  await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}

export const commands: Command[] = [{ data, execute }];
