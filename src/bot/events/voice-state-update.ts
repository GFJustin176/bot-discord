import { getVoiceConnection } from '@discordjs/voice';
import type { VoiceState } from 'discord.js';
import { destroyGuildSession } from '../../queue/guild-session.js';
import { logger } from '../../utils/logger.js';

export interface SimpleVoiceMember {
  readonly isBot: boolean;
}

/**
 * Avalia se o canal de voz do bot ficou completamente sem membros humanos.
 * Regra: desconectar automaticamente SOMENTE quando não houver nenhum usuário humano no canal.
 */
export function shouldAutoLeaveVoiceChannel(members: readonly SimpleVoiceMember[]): boolean {
  const humanCount = members.filter((m) => !m.isBot).length;
  return humanCount === 0;
}

/**
 * Listener do evento voiceStateUpdate do Discord:
 * - Se o próprio bot foi desconectado manualmente do canal de voz, limpa a sessão e a RAM.
 * - Se um usuário saiu ou mudou de canal e o canal de voz onde o bot está ficou vazio (0 humanos),
 *   encerra a reprodução, limpa a RAM e desconecta automaticamente.
 */
export function handleVoiceStateUpdate(oldState: VoiceState, newState: VoiceState): void {
  const guildId = oldState.guild.id;
  const botId = oldState.client.user?.id;

  // Caso o próprio bot tenha sido desconectado manualmente da chamada.
  if (botId && oldState.member?.id === botId && oldState.channelId && !newState.channelId) {
    logger.info('VoiceState', `Bot desconectado manualmente na guild ${guildId}; limpando sessão.`);
    destroyGuildSession(guildId);
    return;
  }

  const connection = getVoiceConnection(guildId);
  const botChannelId = connection?.joinConfig.channelId;
  if (!botChannelId) {
    return;
  }

  // Só avalia se o evento envolveu saída/movimentação do canal onde o bot está conectado.
  if (oldState.channelId !== botChannelId) {
    return;
  }

  const channel = oldState.guild.channels.cache.get(botChannelId);
  if (!channel || !channel.isVoiceBased()) {
    return;
  }

  const memberList: SimpleVoiceMember[] = Array.from(channel.members.values()).map((member) => ({
    isBot: member.user.bot,
  }));

  if (shouldAutoLeaveVoiceChannel(memberList)) {
    logger.info(
      'VoiceState',
      `Canal de voz (${botChannelId}) ficou vazio na guild ${guildId}; desconectando automaticamente.`,
    );
    destroyGuildSession(guildId);
  }
}

