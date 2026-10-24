import {
  type DiscordGatewayAdapterCreator,
  type VoiceConnection,
  VoiceConnectionDisconnectReason,
  VoiceConnectionStatus,
  entersState,
  getVoiceConnection,
  joinVoiceChannel,
} from '@discordjs/voice';
import { logger } from '../utils/logger.js';

export interface ConnectVoiceParams {
  readonly guildId: string;
  readonly channelId: string;
  readonly adapterCreator: DiscordGatewayAdapterCreator;
  readonly onDisconnectedDestroy: () => void;
}

export interface ConnectVoiceOverrides {
  readonly joinFn?: typeof joinVoiceChannel;
  readonly getConnFn?: typeof getVoiceConnection;
  readonly entersStateFn?: typeof entersState;
  readonly timeoutMs?: number;
}

/**
 * Conecta ou reutiliza a conexão de voz no servidor especificado, configurando recuperação
 * automática contra oscilações de rede UDP/WebSocket e suporte ao protocolo DAVE (Voice Gateway v8).
 */
export async function connectOrGetVoiceConnection(
  params: ConnectVoiceParams,
  overrides: ConnectVoiceOverrides = {},
): Promise<VoiceConnection> {
  const joinFn = overrides.joinFn ?? joinVoiceChannel;
  const getConnFn = overrides.getConnFn ?? getVoiceConnection;
  const entersStateFn = overrides.entersStateFn ?? entersState;
  const timeoutMs = overrides.timeoutMs ?? 20_000;

  const existing = getConnFn(params.guildId);
  if (
    existing &&
    existing.state.status !== VoiceConnectionStatus.Destroyed &&
    existing.joinConfig.channelId === params.channelId
  ) {
    if (existing.state.status === VoiceConnectionStatus.Ready) {
      return existing;
    }
    try {
      await entersStateFn(existing, VoiceConnectionStatus.Ready, timeoutMs);
      return existing;
    } catch {
      existing.destroy();
    }
  } else if (existing && existing.state.status !== VoiceConnectionStatus.Destroyed) {
    existing.destroy();
  }

  const connection = joinFn({
    guildId: params.guildId,
    channelId: params.channelId,
    adapterCreator: params.adapterCreator,
    selfDeaf: true,
    selfMute: false,
  });

  connection.on(VoiceConnectionStatus.Disconnected, async (_, newState) => {
    try {
      if (
        newState.reason === VoiceConnectionDisconnectReason.WebSocketClose &&
        newState.closeCode === 4014
      ) {
        // Verifica se o bot foi movido de canal de voz ou desconectado manualmente.
        await entersStateFn(connection, VoiceConnectionStatus.Connecting, 5_000);
      } else if (connection.rejoinAttempts < 5) {
        await new Promise((r) => setTimeout(r, (connection.rejoinAttempts + 1) * 1_000));
        connection.rejoin();
      } else {
        connection.destroy();
        params.onDisconnectedDestroy();
      }
    } catch {
      if (connection.state.status !== VoiceConnectionStatus.Destroyed) {
        connection.destroy();
      }
      params.onDisconnectedDestroy();
    }
  });

  connection.on('error', (err) => {
    logger.error('VoiceManager', `Erro na conexão de voz da guild ${params.guildId}`, err);
  });

  try {
    await entersStateFn(connection, VoiceConnectionStatus.Ready, timeoutMs);
    return connection;
  } catch (err) {
    if (connection.state.status !== VoiceConnectionStatus.Destroyed) {
      connection.destroy();
    }
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Tempo limite esgotado ao estabelecer conexão de voz com o Discord (${detail}). Verifique permissões de Conectar/Falar no canal.`,
    );
  }
}
