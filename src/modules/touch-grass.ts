import {
  SlashCommandBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  ChannelSelectMenuBuilder,
  ChannelType,
  EmbedBuilder,
  Colors,
  MessageFlags,
  PermissionFlagsBits,
  type ChatInputCommandInteraction,
  type ModalSubmitInteraction,
  type ButtonInteraction,
  type StringSelectMenuInteraction,
  type ChannelSelectMenuInteraction,
  type Guild,
  type MessageMentionOptions,
  type PermissionsBitField,
} from 'discord.js';
import { container } from 'tsyringe';
import {
  TouchGrassService,
  parseEventDateInput,
  zonedComponentsToUtc,
  formatEventAtDisplay,
  formatEventAtInput,
  sqliteUtcToDate,
  DEFAULT_EVENT_TIMEZONE,
} from '../services/touch-grass.js';
import { checkCooldown, checkRateLimit } from '../services/ratelimit.js';
import type { TouchGrassEventRow, TouchGrassNotifyLevel, TouchGrassVoteValue } from '../database/types.js';
import type { Command } from '../types.js';
import { t } from '../locales/index.js';

const touchGrass = container.resolve(TouchGrassService);

// ─── Custom-id namespaces: tgm_ modal, tgb_ button, tgs_ select ────────────
const CREATE_MODAL = 'tgm_create';
const EDIT_MODAL_PREFIX = 'tgm_edit_';

const RETRY_CREATE = 'tgb_retrycreate';
const RETRY_EDIT_PREFIX = 'tgb_retryedit_';
const VOTE_GOING = 'tgb_vote_going_';
const VOTE_MAYBE = 'tgb_vote_maybe_';
const VOTE_CANT = 'tgb_vote_cant_';
const TOGGLE_24H = 'tgb_toggle24_';
const TOGGLE_1H = 'tgb_toggle1_';
const TOGGLE_15M = 'tgb_toggle15_';
const ACTIVATE = 'tgb_activate_';
const DISCARD = 'tgb_discard_';
const EDIT = 'tgb_edit_';
const CLOSE = 'tgb_close_';
const CANCEL = 'tgb_cancel_';
const ANNOUNCE_SEND = 'tgb_announcesend_';
const ANNOUNCE = 'tgb_announce_';

const NOTIFY_SELECT = 'tgs_notify_';
const TZ_SELECT = 'tgs_tz_';
const THREAD_SELECT = 'tgc_thread_';

const ACTIVE_LIMIT_NORMAL = 5;
const ACTIVE_LIMIT_MOD = 20;
const CREATE_LIMIT_30M = 3;
const CREATE_LIMIT_DAILY = 10;

// Curated list — Discord string selects cap at 25 options. Vietnam is first/default per the bot's audience.
const TIMEZONE_OPTIONS: { value: string; label: string }[] = [
  { value: 'Asia/Ho_Chi_Minh', label: '🇻🇳 Việt Nam (UTC+7)' },
  { value: 'Asia/Bangkok', label: 'Bangkok (UTC+7)' },
  { value: 'Asia/Jakarta', label: 'Jakarta (UTC+7)' },
  { value: 'Asia/Singapore', label: 'Singapore (UTC+8)' },
  { value: 'Asia/Shanghai', label: 'Trung Quốc (UTC+8)' },
  { value: 'Asia/Manila', label: 'Philippines (UTC+8)' },
  { value: 'Asia/Tokyo', label: 'Nhật Bản (UTC+9)' },
  { value: 'Asia/Seoul', label: 'Hàn Quốc (UTC+9)' },
  { value: 'Asia/Kolkata', label: 'Ấn Độ (UTC+5:30)' },
  { value: 'Europe/London', label: 'Anh (UTC+0/+1)' },
  { value: 'Europe/Paris', label: 'Châu Âu (UTC+1/+2)' },
  { value: 'America/New_York', label: 'Mỹ - Miền Đông (UTC-5/-4)' },
  { value: 'America/Los_Angeles', label: 'Mỹ - Miền Tây (UTC-8/-7)' },
  { value: 'Australia/Sydney', label: 'Úc (UTC+10/+11)' },
  { value: 'UTC', label: 'UTC' },
];

const data = new SlashCommandBuilder()
  .setName('touch-grass')
  .setDescription(t('cmd.touchgrass.desc')) as unknown as SlashCommandBuilder;

function idFromCustomId(customId: string, prefix: string): number {
  return Number(customId.slice(prefix.length));
}

function isModerator(memberPermissions: Readonly<PermissionsBitField> | null): boolean {
  return memberPermissions?.has(PermissionFlagsBits.ManageGuild) ?? false;
}

function canManage(interaction: { user: { id: string }; memberPermissions: Readonly<PermissionsBitField> | null }, event: TouchGrassEventRow): boolean {
  return interaction.user.id === event.creator_id || isModerator(interaction.memberPermissions);
}

function isFlooding(userId: string): boolean {
  return checkRateLimit(`touchgrass:${userId}`, 10, 10_000);
}

async function replyFlood(interaction: ButtonInteraction | StringSelectMenuInteraction | ChannelSelectMenuInteraction): Promise<void> {
  await interaction.reply({ content: t('touchgrass.errors.slow_down'), flags: MessageFlags.Ephemeral }).catch(() => {});
}

// ─── Rendering ──────────────────────────────────────────────────────────────

export function buildEventCard(event: TouchGrassEventRow) {
  const counts = touchGrass.getVoteCounts(event.id);
  const isActive = event.status === 'ACTIVE';
  const dateLine = formatEventAtDisplay(event.event_at, event.event_tz);
  const locationValue = /^https?:\/\//i.test(event.location)
    ? `[${t('touchgrass.embed.location_link')}](${event.location})`
    : event.location;

  const embed = new EmbedBuilder()
    .setTitle(`🌱 ${event.name} — ${event.public_id}`)
    .setColor(isActive ? Colors.Green : Colors.Grey)
    .addFields(
      { name: t('touchgrass.embed.location'), value: locationValue },
      { name: t('touchgrass.embed.date'), value: isActive ? dateLine : `~~${dateLine}~~` },
      { name: t('touchgrass.embed.description'), value: event.description },
      { name: t('touchgrass.embed.creator'), value: `<@${event.creator_id}>`, inline: true },
      {
        name: t('touchgrass.embed.votes', { count: String(counts.going + counts.maybe + counts.cant_go) }),
        value: t('touchgrass.embed.vote_breakdown', { going: String(counts.going), maybe: String(counts.maybe), cant_go: String(counts.cant_go) }),
      },
    );

  if (event.thread_id) {
    embed.addFields({ name: t('touchgrass.embed.thread'), value: `<#${event.thread_id}>`, inline: true });
  }

  const statusKey = event.status === 'CLOSED' ? 'closed' : event.status === 'CANCELLED' ? 'cancelled' : event.status === 'EXPIRED' ? 'expired' : null;
  if (statusKey) embed.setFooter({ text: t(`touchgrass.status.${statusKey}`) });

  const voteRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`${VOTE_GOING}${event.id}`).setLabel(t('touchgrass.button.going')).setEmoji('👍').setStyle(ButtonStyle.Success).setDisabled(!isActive),
    new ButtonBuilder().setCustomId(`${VOTE_MAYBE}${event.id}`).setLabel(t('touchgrass.button.maybe')).setEmoji('🤔').setStyle(ButtonStyle.Secondary).setDisabled(!isActive),
    new ButtonBuilder().setCustomId(`${VOTE_CANT}${event.id}`).setLabel(t('touchgrass.button.cant_go')).setEmoji('❌').setStyle(ButtonStyle.Danger).setDisabled(!isActive),
  );

  if (!isActive) return { embeds: [embed], components: [voteRow] };

  const ownerRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`${EDIT}${event.id}`).setLabel(t('touchgrass.button.edit')).setEmoji('✏️').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`${CLOSE}${event.id}`).setLabel(t('touchgrass.button.close')).setEmoji('🔒').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`${CANCEL}${event.id}`).setLabel(t('touchgrass.button.cancel')).setEmoji('🗑️').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(`${ANNOUNCE}${event.id}`).setLabel(t('touchgrass.button.announce')).setEmoji('📢').setStyle(ButtonStyle.Primary),
  );

  return { embeds: [embed], components: [voteRow, ownerRow] };
}

function buildPreview(draft: TouchGrassEventRow, duplicateOf: TouchGrassEventRow | null) {
  const embed = new EmbedBuilder()
    .setTitle(`🌱 ${t('touchgrass.preview.title')}`)
    .setColor(Colors.Greyple)
    .addFields(
      { name: t('touchgrass.embed.name'), value: draft.name },
      {
        name: t('touchgrass.embed.location'),
        value: /^https?:\/\//i.test(draft.location) ? `[${t('touchgrass.embed.location_link')}](${draft.location})` : draft.location,
      },
      { name: t('touchgrass.embed.date'), value: formatEventAtDisplay(draft.event_at, draft.event_tz) },
      { name: t('touchgrass.embed.description'), value: draft.description },
    );

  if (duplicateOf) {
    const link = `https://discord.com/channels/${duplicateOf.guild_id}/${duplicateOf.channel_id}/${duplicateOf.message_id}`;
    embed.addFields({ name: t('touchgrass.preview.duplicate_title'), value: t('touchgrass.preview.duplicate_value', { id: duplicateOf.public_id, link }) });
  }

  const tzSelect = new StringSelectMenuBuilder()
    .setCustomId(`${TZ_SELECT}${draft.id}`)
    .setPlaceholder(t('touchgrass.preview.tz_placeholder'))
    .addOptions(TIMEZONE_OPTIONS.map(o => ({ label: o.label, value: o.value, default: o.value === draft.event_tz })));

  const toggleRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`${TOGGLE_24H}${draft.id}`).setLabel(`${draft.reminder_24h ? '✅' : '⬜'} ${t('touchgrass.preview.reminder_24h')}`).setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`${TOGGLE_1H}${draft.id}`).setLabel(`${draft.reminder_1h ? '✅' : '⬜'} ${t('touchgrass.preview.reminder_1h')}`).setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`${TOGGLE_15M}${draft.id}`).setLabel(`${draft.reminder_15m ? '✅' : '⬜'} ${t('touchgrass.preview.reminder_15m')}`).setStyle(ButtonStyle.Secondary),
  );

  const actionRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`${ACTIVATE}${draft.id}`).setLabel(t('touchgrass.preview.create')).setEmoji('🌱').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`${DISCARD}${draft.id}`).setLabel(t('touchgrass.preview.cancel')).setEmoji('❌').setStyle(ButtonStyle.Danger),
  );

  return {
    embeds: [embed],
    components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(tzSelect), toggleRow, actionRow],
  };
}

function buildAnnouncePanel(event: TouchGrassEventRow, allowEveryone: boolean) {
  const embed = new EmbedBuilder()
    .setTitle(t('touchgrass.announce.title'))
    .setColor(Colors.Blurple)
    .setDescription(t('touchgrass.announce.desc', { id: event.public_id }))
    .addFields(
      { name: t('touchgrass.announce.current_level'), value: event.notify_level ? t(`touchgrass.announce.level_${event.notify_level}`) : t('touchgrass.announce.level_unset'), inline: true },
      { name: t('touchgrass.announce.current_thread'), value: event.thread_id ? `<#${event.thread_id}>` : t('touchgrass.announce.thread_unset'), inline: true },
    );

  const levelOptions = [
    { label: t('touchgrass.announce.level_none'), value: 'none', default: event.notify_level === 'none' },
    { label: t('touchgrass.announce.level_participants'), value: 'participants', default: event.notify_level === 'participants' },
  ];
  if (allowEveryone) {
    levelOptions.push(
      { label: t('touchgrass.announce.level_here'), value: 'here', default: event.notify_level === 'here' },
      { label: t('touchgrass.announce.level_everyone'), value: 'everyone', default: event.notify_level === 'everyone' },
    );
  }

  const levelSelect = new StringSelectMenuBuilder()
    .setCustomId(`${NOTIFY_SELECT}${event.id}`)
    .setPlaceholder(t('touchgrass.announce.level_placeholder'))
    .addOptions(levelOptions);

  const threadSelect = new ChannelSelectMenuBuilder()
    .setCustomId(`${THREAD_SELECT}${event.id}`)
    .setPlaceholder(t('touchgrass.announce.thread_placeholder'))
    .addChannelTypes(ChannelType.PublicThread, ChannelType.PrivateThread, ChannelType.AnnouncementThread);

  const sendRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`${ANNOUNCE_SEND}${event.id}`).setLabel(t('touchgrass.announce.send')).setEmoji('✅').setStyle(ButtonStyle.Success).setDisabled(!event.notify_level),
  );

  return {
    embeds: [embed],
    components: [
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(levelSelect),
      new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(threadSelect),
      sendRow,
    ],
  };
}

function buildCreateModal(): ModalBuilder {
  const modal = new ModalBuilder().setCustomId(CREATE_MODAL).setTitle(t('touchgrass.modal.title'));

  const nameInput = new TextInputBuilder()
    .setCustomId('name').setLabel(t('touchgrass.modal.name_label')).setStyle(TextInputStyle.Short)
    .setPlaceholder(t('touchgrass.modal.name_placeholder')).setRequired(true).setMaxLength(100);
  const locationInput = new TextInputBuilder()
    .setCustomId('location').setLabel(t('touchgrass.modal.location_label')).setStyle(TextInputStyle.Short)
    .setPlaceholder(t('touchgrass.modal.location_placeholder')).setRequired(true).setMaxLength(300);
  const dateInput = new TextInputBuilder()
    .setCustomId('date').setLabel(t('touchgrass.modal.date_label')).setStyle(TextInputStyle.Short)
    .setPlaceholder(t('touchgrass.modal.date_placeholder')).setRequired(true).setMaxLength(20);
  const descriptionInput = new TextInputBuilder()
    .setCustomId('description').setLabel(t('touchgrass.modal.description_label')).setStyle(TextInputStyle.Paragraph)
    .setPlaceholder(t('touchgrass.modal.description_placeholder')).setRequired(true).setMaxLength(1000);

  modal.addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(nameInput),
    new ActionRowBuilder<TextInputBuilder>().addComponents(locationInput),
    new ActionRowBuilder<TextInputBuilder>().addComponents(dateInput),
    new ActionRowBuilder<TextInputBuilder>().addComponents(descriptionInput),
  );
  return modal;
}

function buildEditModal(event: TouchGrassEventRow): ModalBuilder {
  const modal = new ModalBuilder().setCustomId(`${EDIT_MODAL_PREFIX}${event.id}`).setTitle(t('touchgrass.modal.edit_title'));

  const nameInput = new TextInputBuilder()
    .setCustomId('name').setLabel(t('touchgrass.modal.name_label')).setStyle(TextInputStyle.Short)
    .setValue(event.name).setRequired(true).setMaxLength(100);
  const locationInput = new TextInputBuilder()
    .setCustomId('location').setLabel(t('touchgrass.modal.location_label')).setStyle(TextInputStyle.Short)
    .setValue(event.location).setRequired(true).setMaxLength(300);
  const dateInput = new TextInputBuilder()
    .setCustomId('date').setLabel(t('touchgrass.modal.date_label')).setStyle(TextInputStyle.Short)
    .setValue(formatEventAtInput(event.event_at, event.event_tz)).setPlaceholder(t('touchgrass.modal.date_placeholder')).setRequired(true).setMaxLength(20);
  const descriptionInput = new TextInputBuilder()
    .setCustomId('description').setLabel(t('touchgrass.modal.description_label')).setStyle(TextInputStyle.Paragraph)
    .setValue(event.description).setRequired(true).setMaxLength(1000);

  modal.addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(nameInput),
    new ActionRowBuilder<TextInputBuilder>().addComponents(locationInput),
    new ActionRowBuilder<TextInputBuilder>().addComponents(dateInput),
    new ActionRowBuilder<TextInputBuilder>().addComponents(descriptionInput),
  );
  return modal;
}

async function refreshCard(guild: Guild, event: TouchGrassEventRow): Promise<void> {
  if (!event.message_id) return;
  const channel = await guild.channels.fetch(event.channel_id).catch(() => null);
  if (!channel || !channel.isSendable()) return;
  const message = await channel.messages.fetch(event.message_id).catch(() => null);
  if (!message) return;
  const { embeds, components } = buildEventCard(event);
  await message.edit({ embeds, components }).catch(() => {});
}

// ─── Slash command ──────────────────────────────────────────────────────────

async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.inGuild()) {
    await interaction.reply({ content: t('touchgrass.errors.guild_only'), flags: MessageFlags.Ephemeral });
    return;
  }

  const userId = interaction.user.id;

  if (touchGrass.countCreatedSince(userId, 30) >= CREATE_LIMIT_30M) {
    const oldest = touchGrass.oldestCreatedSince(userId, 30);
    const minutes = oldest ? Math.max(1, Math.ceil((sqliteUtcToDate(oldest).getTime() + 30 * 60 * 1000 - Date.now()) / 60_000)) : 30;
    await interaction.reply({ content: t('touchgrass.errors.cooldown_30m', { minutes: String(minutes) }), flags: MessageFlags.Ephemeral });
    return;
  }

  if (touchGrass.countCreatedSince(userId, 24 * 60) >= CREATE_LIMIT_DAILY) {
    const oldest = touchGrass.oldestCreatedSince(userId, 24 * 60);
    const hours = oldest ? Math.max(1, Math.ceil((sqliteUtcToDate(oldest).getTime() + 24 * 60 * 60 * 1000 - Date.now()) / 3_600_000)) : 24;
    await interaction.reply({ content: t('touchgrass.errors.daily_limit', { hours: String(hours) }), flags: MessageFlags.Ephemeral });
    return;
  }

  const activeLimit = isModerator(interaction.memberPermissions) ? ACTIVE_LIMIT_MOD : ACTIVE_LIMIT_NORMAL;
  if (touchGrass.countActive(userId) >= activeLimit) {
    await interaction.reply({ content: t('touchgrass.errors.active_limit', { limit: String(activeLimit) }), flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.showModal(buildCreateModal());
}

// ─── Modal submit ───────────────────────────────────────────────────────────

async function handleCreateModalSubmit(interaction: ModalSubmitInteraction): Promise<void> {
  if (isFlooding(interaction.user.id)) {
    await interaction.reply({ content: t('touchgrass.errors.slow_down'), flags: MessageFlags.Ephemeral }).catch(() => {});
    return;
  }
  if (!interaction.inGuild() || !interaction.channelId) {
    await interaction.reply({ content: t('touchgrass.errors.guild_only'), flags: MessageFlags.Ephemeral });
    return;
  }

  const name = interaction.fields.getTextInputValue('name').trim();
  const location = interaction.fields.getTextInputValue('location').trim();
  const dateInput = interaction.fields.getTextInputValue('date').trim();
  const description = interaction.fields.getTextInputValue('description').trim();

  const dateComponents = parseEventDateInput(dateInput);
  const eventAt = dateComponents ? zonedComponentsToUtc(dateComponents, DEFAULT_EVENT_TIMEZONE) : null;
  if (!eventAt || eventAt.getTime() <= Date.now()) {
    await interaction.reply({
      content: t('touchgrass.errors.invalid_date'),
      components: [new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(RETRY_CREATE).setLabel(t('touchgrass.button.retry')).setEmoji('🔁').setStyle(ButtonStyle.Secondary),
      )],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const draft = touchGrass.createDraft(interaction.guildId!, interaction.channelId, interaction.user.id, name, location, dateInput, DEFAULT_EVENT_TIMEZONE, eventAt, description);
  const duplicate = touchGrass.findDuplicateActive(interaction.user.id, location, eventAt, draft.id);

  const { embeds, components } = buildPreview(draft, duplicate ?? null);
  await interaction.reply({ embeds, components, flags: MessageFlags.Ephemeral });
}

async function handleEditModalSubmit(interaction: ModalSubmitInteraction): Promise<void> {
  if (isFlooding(interaction.user.id)) {
    await interaction.reply({ content: t('touchgrass.errors.slow_down'), flags: MessageFlags.Ephemeral }).catch(() => {});
    return;
  }

  const id = idFromCustomId(interaction.customId, EDIT_MODAL_PREFIX);
  const event = touchGrass.getById(id);
  if (!event) {
    await interaction.reply({ content: t('touchgrass.errors.event_not_found'), flags: MessageFlags.Ephemeral });
    return;
  }
  if (!canManage(interaction, event)) {
    await interaction.reply({ content: t('touchgrass.errors.not_owner'), flags: MessageFlags.Ephemeral });
    return;
  }

  const name = interaction.fields.getTextInputValue('name').trim();
  const location = interaction.fields.getTextInputValue('location').trim();
  const dateInput = interaction.fields.getTextInputValue('date').trim();
  const description = interaction.fields.getTextInputValue('description').trim();

  const dateComponents = parseEventDateInput(dateInput);
  const eventAt = dateComponents ? zonedComponentsToUtc(dateComponents, event.event_tz) : null;
  if (!eventAt || eventAt.getTime() <= Date.now()) {
    await interaction.reply({
      content: t('touchgrass.errors.invalid_date'),
      components: [new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(`${RETRY_EDIT_PREFIX}${id}`).setLabel(t('touchgrass.button.retry')).setEmoji('🔁').setStyle(ButtonStyle.Secondary),
      )],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const updated = touchGrass.updateDetails(id, name, location, description, dateInput, event.event_tz, eventAt);
  if (interaction.guild) await refreshCard(interaction.guild, updated);
  await interaction.reply({ content: t('touchgrass.edit.success'), flags: MessageFlags.Ephemeral });
}

export async function modalSubmit(interaction: ModalSubmitInteraction): Promise<void> {
  if (interaction.customId === CREATE_MODAL) {
    await handleCreateModalSubmit(interaction);
  } else if (interaction.customId.startsWith(EDIT_MODAL_PREFIX)) {
    await handleEditModalSubmit(interaction);
  }
}

// ─── Buttons ────────────────────────────────────────────────────────────────

async function handleVote(interaction: ButtonInteraction, id: number, vote: TouchGrassVoteValue): Promise<void> {
  const event = touchGrass.getById(id);
  if (!event || event.status !== 'ACTIVE') {
    await interaction.reply({ content: t('touchgrass.errors.event_not_found'), flags: MessageFlags.Ephemeral });
    return;
  }

  if (checkCooldown(`touchgrass:vote:${id}:${interaction.user.id}`, 3)) {
    await interaction.reply({ content: t('touchgrass.errors.vote_cooldown'), flags: MessageFlags.Ephemeral });
    return;
  }

  touchGrass.upsertVote(id, interaction.user.id, vote);
  const { embeds, components } = buildEventCard(touchGrass.getById(id)!);
  await interaction.update({ embeds, components });
}

async function handleToggle(interaction: ButtonInteraction, id: number, key: '24h' | '1h' | '15m'): Promise<void> {
  const draft = touchGrass.getById(id);
  if (!draft || draft.status !== 'DRAFT' || draft.creator_id !== interaction.user.id) {
    await interaction.reply({ content: t('touchgrass.errors.event_not_found'), flags: MessageFlags.Ephemeral });
    return;
  }

  const updated = touchGrass.toggleReminder(id, key);
  const duplicate = touchGrass.findDuplicateActive(updated.creator_id, updated.location, new Date(updated.event_at), updated.id);
  const { embeds, components } = buildPreview(updated, duplicate ?? null);
  await interaction.update({ embeds, components });
}

async function handleActivate(interaction: ButtonInteraction, id: number): Promise<void> {
  const draft = touchGrass.getById(id);
  if (!draft || draft.status !== 'DRAFT' || draft.creator_id !== interaction.user.id) {
    await interaction.reply({ content: t('touchgrass.errors.event_not_found'), flags: MessageFlags.Ephemeral });
    return;
  }

  const activeLimit = isModerator(interaction.memberPermissions) ? ACTIVE_LIMIT_MOD : ACTIVE_LIMIT_NORMAL;
  if (touchGrass.countActive(draft.creator_id) >= activeLimit) {
    touchGrass.deleteDraft(id);
    await interaction.update({ content: t('touchgrass.errors.active_limit', { limit: String(activeLimit) }), embeds: [], components: [] });
    return;
  }

  const channel = interaction.guild ? await interaction.guild.channels.fetch(draft.channel_id).catch(() => null) : null;
  if (!channel || !channel.isSendable()) {
    touchGrass.deleteDraft(id);
    await interaction.update({ content: t('touchgrass.errors.channel_unavailable'), embeds: [], components: [] });
    return;
  }

  const activated = touchGrass.activate(id);
  const { embeds, components } = buildEventCard(activated);
  const message = await channel.send({ embeds, components });
  touchGrass.setMessageId(id, message.id);

  await interaction.update({ content: t('touchgrass.preview.created', { id: activated.public_id }), embeds: [], components: [] });
}

async function handleDiscard(interaction: ButtonInteraction, id: number): Promise<void> {
  const draft = touchGrass.getById(id);
  if (draft && draft.creator_id === interaction.user.id) {
    touchGrass.deleteDraft(id);
  }
  await interaction.update({ content: t('touchgrass.preview.discarded'), embeds: [], components: [] });
}

async function handleRetryCreate(interaction: ButtonInteraction): Promise<void> {
  await interaction.showModal(buildCreateModal());
}

async function handleRetryEdit(interaction: ButtonInteraction, id: number): Promise<void> {
  const event = touchGrass.getById(id);
  if (!event) {
    await interaction.reply({ content: t('touchgrass.errors.event_not_found'), flags: MessageFlags.Ephemeral });
    return;
  }
  await interaction.showModal(buildEditModal(event));
}

async function handleEditButton(interaction: ButtonInteraction, id: number): Promise<void> {
  const event = touchGrass.getById(id);
  if (!event) {
    await interaction.reply({ content: t('touchgrass.errors.event_not_found'), flags: MessageFlags.Ephemeral });
    return;
  }
  if (!canManage(interaction, event)) {
    await interaction.reply({ content: t('touchgrass.errors.not_owner'), flags: MessageFlags.Ephemeral });
    return;
  }
  await interaction.showModal(buildEditModal(event));
}

async function handleClose(interaction: ButtonInteraction, id: number): Promise<void> {
  const event = touchGrass.getById(id);
  if (!event) {
    await interaction.reply({ content: t('touchgrass.errors.event_not_found'), flags: MessageFlags.Ephemeral });
    return;
  }
  if (!canManage(interaction, event)) {
    await interaction.reply({ content: t('touchgrass.errors.not_owner'), flags: MessageFlags.Ephemeral });
    return;
  }
  const { embeds, components } = buildEventCard(touchGrass.close(id));
  await interaction.update({ embeds, components });
}

async function handleCancel(interaction: ButtonInteraction, id: number): Promise<void> {
  const event = touchGrass.getById(id);
  if (!event) {
    await interaction.reply({ content: t('touchgrass.errors.event_not_found'), flags: MessageFlags.Ephemeral });
    return;
  }
  if (!canManage(interaction, event)) {
    await interaction.reply({ content: t('touchgrass.errors.not_owner'), flags: MessageFlags.Ephemeral });
    return;
  }
  const { embeds, components } = buildEventCard(touchGrass.cancel(id));
  await interaction.update({ embeds, components });
}

async function handleAnnounceOpen(interaction: ButtonInteraction, id: number): Promise<void> {
  const event = touchGrass.getById(id);
  if (!event) {
    await interaction.reply({ content: t('touchgrass.errors.event_not_found'), flags: MessageFlags.Ephemeral });
    return;
  }
  if (!canManage(interaction, event)) {
    await interaction.reply({ content: t('touchgrass.errors.not_owner'), flags: MessageFlags.Ephemeral });
    return;
  }

  const allowEveryone = interaction.memberPermissions?.has(PermissionFlagsBits.MentionEveryone) ?? false;
  const { embeds, components } = buildAnnouncePanel(event, allowEveryone);
  await interaction.reply({ embeds, components, flags: MessageFlags.Ephemeral });
}

async function handleAnnounceSend(interaction: ButtonInteraction, id: number): Promise<void> {
  const event = touchGrass.getById(id);
  if (!event) {
    await interaction.reply({ content: t('touchgrass.errors.event_not_found'), flags: MessageFlags.Ephemeral });
    return;
  }
  if (!canManage(interaction, event)) {
    await interaction.reply({ content: t('touchgrass.errors.not_owner'), flags: MessageFlags.Ephemeral });
    return;
  }
  if (!event.notify_level) {
    await interaction.reply({ content: t('touchgrass.errors.no_notify_level'), flags: MessageFlags.Ephemeral });
    return;
  }

  const allowEveryone = interaction.memberPermissions?.has(PermissionFlagsBits.MentionEveryone) ?? false;
  if ((event.notify_level === 'here' || event.notify_level === 'everyone') && !allowEveryone) {
    await interaction.reply({ content: t('touchgrass.errors.no_mention_permission'), flags: MessageFlags.Ephemeral });
    return;
  }

  const targetId = event.thread_id ?? event.channel_id;
  const channel = interaction.guild ? await interaction.guild.channels.fetch(targetId).catch(() => null) : null;
  if (!channel || !channel.isSendable()) {
    await interaction.reply({ content: t('touchgrass.errors.thread_unavailable'), flags: MessageFlags.Ephemeral });
    return;
  }

  const goingIds = touchGrass.getGoingUserIds(event.id);
  let mentionText = '';
  let allowedMentions: MessageMentionOptions = { parse: [] };

  switch (event.notify_level) {
    case 'everyone':
      mentionText = '@everyone';
      allowedMentions = { parse: ['everyone'] };
      break;
    case 'here':
      mentionText = '@here';
      allowedMentions = { parse: ['everyone'] };
      break;
    case 'participants':
      mentionText = goingIds.length ? goingIds.map(uid => `<@${uid}>`).join(' ') : t('touchgrass.announce.no_participants');
      allowedMentions = { users: goingIds };
      break;
  }

  const content = t('touchgrass.announce.message', {
    mentions: mentionText,
    id: event.public_id,
    location: event.location,
    date: formatEventAtDisplay(event.event_at, event.event_tz),
  });

  await channel.send({ content, allowedMentions });
  await interaction.update({ content: t('touchgrass.announce.sent', { channel: `<#${channel.id}>` }), embeds: [], components: [] });
}

export async function button(interaction: ButtonInteraction): Promise<void> {
  if (isFlooding(interaction.user.id)) {
    await replyFlood(interaction);
    return;
  }

  const id = interaction.customId;
  if (id === RETRY_CREATE) return handleRetryCreate(interaction);
  if (id.startsWith(RETRY_EDIT_PREFIX)) return handleRetryEdit(interaction, idFromCustomId(id, RETRY_EDIT_PREFIX));
  if (id.startsWith(VOTE_GOING)) return handleVote(interaction, idFromCustomId(id, VOTE_GOING), 'going');
  if (id.startsWith(VOTE_MAYBE)) return handleVote(interaction, idFromCustomId(id, VOTE_MAYBE), 'maybe');
  if (id.startsWith(VOTE_CANT)) return handleVote(interaction, idFromCustomId(id, VOTE_CANT), 'cant_go');
  if (id.startsWith(TOGGLE_24H)) return handleToggle(interaction, idFromCustomId(id, TOGGLE_24H), '24h');
  if (id.startsWith(TOGGLE_1H)) return handleToggle(interaction, idFromCustomId(id, TOGGLE_1H), '1h');
  if (id.startsWith(TOGGLE_15M)) return handleToggle(interaction, idFromCustomId(id, TOGGLE_15M), '15m');
  if (id.startsWith(ACTIVATE)) return handleActivate(interaction, idFromCustomId(id, ACTIVATE));
  if (id.startsWith(DISCARD)) return handleDiscard(interaction, idFromCustomId(id, DISCARD));
  if (id.startsWith(EDIT)) return handleEditButton(interaction, idFromCustomId(id, EDIT));
  if (id.startsWith(CLOSE)) return handleClose(interaction, idFromCustomId(id, CLOSE));
  if (id.startsWith(CANCEL)) return handleCancel(interaction, idFromCustomId(id, CANCEL));
  if (id.startsWith(ANNOUNCE_SEND)) return handleAnnounceSend(interaction, idFromCustomId(id, ANNOUNCE_SEND));
  if (id.startsWith(ANNOUNCE)) return handleAnnounceOpen(interaction, idFromCustomId(id, ANNOUNCE));
}

// ─── Selects ────────────────────────────────────────────────────────────────

async function handleNotifySelect(interaction: StringSelectMenuInteraction, id: number): Promise<void> {
  const event = touchGrass.getById(id);
  if (!event) {
    await interaction.reply({ content: t('touchgrass.errors.event_not_found'), flags: MessageFlags.Ephemeral });
    return;
  }
  if (!canManage(interaction, event)) {
    await interaction.reply({ content: t('touchgrass.errors.not_owner'), flags: MessageFlags.Ephemeral });
    return;
  }

  const level = interaction.values[0] as TouchGrassNotifyLevel;
  const allowEveryone = interaction.memberPermissions?.has(PermissionFlagsBits.MentionEveryone) ?? false;
  if ((level === 'here' || level === 'everyone') && !allowEveryone) {
    await interaction.reply({ content: t('touchgrass.errors.no_mention_permission'), flags: MessageFlags.Ephemeral });
    return;
  }

  touchGrass.setNotifyLevel(id, level);
  const { embeds, components } = buildAnnouncePanel(touchGrass.getById(id)!, allowEveryone);
  await interaction.update({ embeds, components });
}

async function handleTzSelect(interaction: StringSelectMenuInteraction, id: number): Promise<void> {
  const draft = touchGrass.getById(id);
  if (!draft || draft.status !== 'DRAFT' || draft.creator_id !== interaction.user.id) {
    await interaction.reply({ content: t('touchgrass.errors.event_not_found'), flags: MessageFlags.Ephemeral });
    return;
  }

  const tz = interaction.values[0];
  const dateComponents = parseEventDateInput(draft.event_date_raw);
  if (!dateComponents) {
    await interaction.reply({ content: t('touchgrass.errors.invalid_date'), flags: MessageFlags.Ephemeral });
    return;
  }

  const eventAt = zonedComponentsToUtc(dateComponents, tz);
  touchGrass.setTimezone(id, tz, eventAt);
  const updated = touchGrass.getById(id)!;
  const duplicate = touchGrass.findDuplicateActive(updated.creator_id, updated.location, eventAt, updated.id);
  const { embeds, components } = buildPreview(updated, duplicate ?? null);
  await interaction.update({ embeds, components });
}

export async function stringSelect(interaction: StringSelectMenuInteraction): Promise<void> {
  if (isFlooding(interaction.user.id)) {
    await replyFlood(interaction);
    return;
  }

  const id = interaction.customId;
  if (id.startsWith(TZ_SELECT)) return handleTzSelect(interaction, idFromCustomId(id, TZ_SELECT));
  if (id.startsWith(NOTIFY_SELECT)) return handleNotifySelect(interaction, idFromCustomId(id, NOTIFY_SELECT));
}

export async function channelSelect(interaction: ChannelSelectMenuInteraction): Promise<void> {
  if (isFlooding(interaction.user.id)) {
    await replyFlood(interaction);
    return;
  }

  const id = idFromCustomId(interaction.customId, THREAD_SELECT);
  const event = touchGrass.getById(id);
  if (!event) {
    await interaction.reply({ content: t('touchgrass.errors.event_not_found'), flags: MessageFlags.Ephemeral });
    return;
  }
  if (!canManage(interaction, event)) {
    await interaction.reply({ content: t('touchgrass.errors.not_owner'), flags: MessageFlags.Ephemeral });
    return;
  }

  touchGrass.setThread(id, interaction.values[0]);
  const allowEveryone = interaction.memberPermissions?.has(PermissionFlagsBits.MentionEveryone) ?? false;
  const { embeds, components } = buildAnnouncePanel(touchGrass.getById(id)!, allowEveryone);
  await interaction.update({ embeds, components });
}

// ─── Routing predicates ─────────────────────────────────────────────────────

export function isTouchGrassModal(customId: string): boolean {
  return customId.startsWith('tgm_');
}

export function isTouchGrassButton(customId: string): boolean {
  return customId.startsWith('tgb_');
}

export function isTouchGrassStringSelect(customId: string): boolean {
  return customId.startsWith('tgs_');
}

export function isTouchGrassChannelSelect(customId: string): boolean {
  return customId.startsWith('tgc_');
}

export const commands: Command[] = [{ data, execute }];
