import { REST, Routes } from 'discord.js';
import { getEnvConfig } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { buildSlashCommandsJson } from './commands/index.js';

/**
 * Registra os Slash Commands na API do Discord:
 * - Se DISCORD_GUILD_ID estiver definido no .env, registra instantaneamente no servidor pessoal.
 * - Caso contrário, registra globalmente na aplicação.
 */
export async function deploySlashCommands(): Promise<void> {
  const env = getEnvConfig();
  const rest = new REST({ version: '10' }).setToken(env.discordToken);
  const commandsPayload = buildSlashCommandsJson();

  if (env.discordGuildId) {
    logger.info(
      'DeployCommands',
      `Registrando ${commandsPayload.length} Slash Commands no servidor ${env.discordGuildId}...`,
    );
    await rest.put(Routes.applicationGuildCommands(env.discordClientId, env.discordGuildId), {
      body: commandsPayload,
    });
    logger.info('DeployCommands', 'Slash Commands registrados com sucesso no servidor.');
  } else {
    logger.info(
      'DeployCommands',
      `Registrando ${commandsPayload.length} Slash Commands globalmente...`,
    );
    await rest.put(Routes.applicationCommands(env.discordClientId), {
      body: commandsPayload,
    });
    logger.info('DeployCommands', 'Slash Commands globais registrados com sucesso.');
  }
}

// Permite execução direta via `npm run deploy:commands`.
if (import.meta.url.endsWith('deploy-commands.ts') || import.meta.url.endsWith('deploy-commands.js')) {
  deploySlashCommands().catch((err) => {
    logger.error('DeployCommands', 'Falha ao registrar Slash Commands', err);
    process.exitCode = 1;
  });
}

