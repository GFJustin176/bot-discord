import type { Interaction, Message } from 'discord.js';
import { getEnvConfig } from '../../config/env.js';
import { logger } from '../../utils/logger.js';
import {
  createPrefixCommandContext,
  createSlashCommandContext,
  parsePrefixMessage,
} from '../command-context.js';
import { getCommandHandler } from '../commands/index.js';

// Roteia Slash Commands (/play, /skip, etc.) para o handler unificado.
export async function handleInteractionCreate(interaction: Interaction): Promise<void> {
  if (!interaction.isChatInputCommand()) {
    return;
  }

  const handler = getCommandHandler(interaction.commandName);
  if (!handler) {
    return;
  }

  const ctx = createSlashCommandContext(interaction);
  if (!ctx) {
    return;
  }

  try {
    await handler(ctx);
  } catch (err) {
    logger.error('CommandRouter', `Erro no comando /${interaction.commandName}`, err);
    const msg = err instanceof Error ? err.message : 'Erro interno ao processar o comando.';
    await ctx.reply(`Erro ao executar comando: ${msg}`).catch(() => undefined);
  }
}

// Roteia comandos por prefixo de mensagem no chat (!play, !skip, etc.) para o handler unificado.
export async function handleMessageCreate(message: Message): Promise<void> {
  if (message.author.bot || !message.guild) {
    return;
  }

  const { commandPrefix } = getEnvConfig();
  const parsed = parsePrefixMessage(message.content, commandPrefix);
  if (!parsed) {
    return;
  }

  const handler = getCommandHandler(parsed.commandName);
  if (!handler) {
    return;
  }

  const ctx = createPrefixCommandContext(message, parsed);
  if (!ctx) {
    return;
  }

  try {
    await handler(ctx);
  } catch (err) {
    logger.error('CommandRouter', `Erro no comando ${commandPrefix}${parsed.commandName}`, err);
    const msg = err instanceof Error ? err.message : 'Erro interno ao processar o comando.';
    await ctx.reply(`Erro ao executar comando: ${msg}`).catch(() => undefined);
  }
}

