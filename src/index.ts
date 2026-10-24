import { createDiscordClient } from './bot/client.js';
import { deploySlashCommands } from './bot/deploy-commands.js';
import { getEnvConfig } from './config/env.js';
import { destroyAllGuildSessions } from './queue/guild-session.js';
import { logger } from './utils/logger.js';

async function bootstrap(): Promise<void> {
  const env = getEnvConfig();

  logger.info('Bootstrap', 'Configuração carregada com sucesso.', {
    prefix: env.commandPrefix,
    maxQueueSize: env.maxQueueSize,
    maxRamBufferMb: Math.round(env.maxRamBufferBytes / (1024 * 1024)),
    spotifyMode: env.spotifyHasCredentials ? 'hybrid-api+embed' : 'hybrid-embed-fallback',
    ytdlpPath: env.ytdlpPath,
    ffmpegPath: env.ffmpegPath,
  });

  // Registra/atualiza automaticamente os Slash Commands ao iniciar.
  try {
    await deploySlashCommands();
  } catch (err) {
    logger.warn(
      'Bootstrap',
      'Não foi possível atualizar Slash Commands na inicialização; comandos por prefixo continuam ativos.',
      { error: err instanceof Error ? err.message : String(err) },
    );
  }

  const client = createDiscordClient();

  const shutdown = (signal: string): void => {
    logger.info('Bootstrap', `Sinal ${signal} recebido; encerrando sessões de voz e liberando RAM...`);
    destroyAllGuildSessions();
    void client.destroy();
    process.exit(0);
  };

  process.once('SIGINT', () => shutdown('SIGINT'));
  process.once('SIGTERM', () => shutdown('SIGTERM'));

  await client.login(env.discordToken);
}

bootstrap().catch((err) => {
  logger.error('Bootstrap', 'Erro fatal ao inicializar o bot', err);
  process.exit(1);
});

