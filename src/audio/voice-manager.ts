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

/**
 * Conecta ou reutiliza a conexão de voz no servidor especificado, configurando recuperação
 * automática contra oscilações de rede UDP/WebSocket do Discord.
 */
export async function connectOrGetVoiceConnection(
  params: ConnectVoiceParams,
): Promise<VoiceConnection> {
  const existing = getVoiceConnection(params.guildId);
  if (
    existing &&
    existing.state.status !== VoiceConnectionStatus.Destroyed &&
    existing.joinConfig.channelId === params.channelId
  ) {
    return existing;
  }

  const connection = joinVoiceChannel({
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
        await entersState(connection, VoiceConnectionStatus.Connecting, 5_000);
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

  await entersState(connection, VoiceConnectionStatus.Ready, 15_000);
  return connection;
}

