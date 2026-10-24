import { Client, Events, GatewayIntentBits } from 'discord.js';
import { logger } from '../utils/logger.js';
import { handleInteractionCreate, handleMessageCreate } from './events/command-router.js';
import { handleVoiceStateUpdate } from './events/voice-state-update.js';

/**
 * Instancia e configura o cliente Discord com os Intents necessários para:
 * - Chamadas de voz (GuildVoiceStates)
 * - Comandos Slash (Guilds)
 * - Comandos por prefixo no chat (GuildMessages, MessageContent)
 */
export function createDiscordClient(): Client {
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildVoiceStates,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ],
  });

  client.once(Events.ClientReady, (readyClient) => {
    logger.info('DiscordClient', `Bot autenticado como ${readyClient.user.tag}`);
  });

  client.on(Events.InteractionCreate, (interaction) => {
    void handleInteractionCreate(interaction);
  });

  client.on(Events.MessageCreate, (message) => {
    void handleMessageCreate(message);
  });

  client.on(Events.VoiceStateUpdate, (oldState, newState) => {
    handleVoiceStateUpdate(oldState, newState);
  });

  return client;
}

