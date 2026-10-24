import type { DiscordGatewayAdapterCreator } from '@discordjs/voice';
import {
  type ChatInputCommandInteraction,
  GuildMember,
  type Message,
  type VoiceBasedChannel,
} from 'discord.js';

// Estrutura extraída de uma mensagem com prefixo no chat.
export interface ParsedPrefixCommand {
  readonly commandName: string;
  readonly rawArgs: string;
  readonly argsList: readonly string[];
}

/**
 * Analisa uma mensagem de chat verificando se inicia com o prefixo configurado
 * e separa o nome do comando do restante dos argumentos.
 */
export function parsePrefixMessage(
  content: string,
  prefix: string,
): ParsedPrefixCommand | undefined {
  const trimmed = content.trim();
  if (!trimmed.startsWith(prefix)) {
    return undefined;
  }

  const withoutPrefix = trimmed.slice(prefix.length).trim();
  if (withoutPrefix.length === 0) {
    return undefined;
  }

  const firstSpaceIdx = withoutPrefix.indexOf(' ');
  if (firstSpaceIdx === -1) {
    return {
      commandName: withoutPrefix.toLowerCase(),
      rawArgs: '',
      argsList: [],
    };
  }

  const commandName = withoutPrefix.slice(0, firstSpaceIdx).toLowerCase();
  const rawArgs = withoutPrefix.slice(firstSpaceIdx + 1).trim();
  const argsList = rawArgs.length > 0 ? rawArgs.split(/\s+/) : [];

  return {
    commandName,
    rawArgs,
    argsList,
  };
}

/**
 * Contexto unificado para execução de comandos tanto via Slash Command (/play)
 * quanto via mensagem com prefixo (!play).
 */
export interface CommandContext {
  readonly guildId: string;
  readonly userTag: string;
  readonly voiceChannel: VoiceBasedChannel | null;
  readonly voiceAdapterCreator: DiscordGatewayAdapterCreator;
  getStringArg(name: string, index?: number): string | undefined;
  getIntArg(name: string, index?: number): number | undefined;
  defer(): Promise<void>;
  reply(content: string): Promise<void>;
}

// Cria um CommandContext a partir de uma ChatInputCommandInteraction (Slash Command).
export function createSlashCommandContext(
  interaction: ChatInputCommandInteraction,
): CommandContext | undefined {
  if (!interaction.guild || !interaction.guildId) {
    return undefined;
  }

  const member = interaction.member instanceof GuildMember ? interaction.member : null;
  const voiceChannel = member?.voice.channel ?? null;
  const guild = interaction.guild;
  let deferred = false;

  return {
    guildId: interaction.guildId,
    userTag: interaction.user.tag,
    voiceChannel,
    voiceAdapterCreator: guild.voiceAdapterCreator as unknown as DiscordGatewayAdapterCreator,

    getStringArg(name: string): string | undefined {
      const val = interaction.options.getString(name, false);
      return val?.trim() || undefined;
    },

    getIntArg(name: string): number | undefined {
      const val = interaction.options.getInteger(name, false);
      return val ?? undefined;
    },

    async defer(): Promise<void> {
      if (!deferred && !interaction.deferred && !interaction.replied) {
        deferred = true;
        await interaction.deferReply();
      }
    },

    async reply(content: string): Promise<void> {
      if (interaction.deferred || interaction.replied || deferred) {
        await interaction.editReply({ content });
      } else {
        await interaction.reply({ content });
      }
    },
  };
}

// Cria um CommandContext a partir de uma mensagem de texto com prefixo (!comando).
export function createPrefixCommandContext(
  message: Message,
  parsed: ParsedPrefixCommand,
): CommandContext | undefined {
  if (!message.guild || !message.guildId || !message.member) {
    return undefined;
  }

  const guild = message.guild;
  const voiceChannel = message.member.voice.channel ?? null;
  let responseMessage: Message | undefined;

  return {
    guildId: message.guildId,
    userTag: message.author.tag,
    voiceChannel,
    voiceAdapterCreator: guild.voiceAdapterCreator as unknown as DiscordGatewayAdapterCreator,

    getStringArg(_name: string, index = 0): string | undefined {
      if (index === 0) {
        return parsed.rawArgs || undefined;
      }
      return parsed.argsList[index];
    },

    getIntArg(_name: string, index = 0): number | undefined {
      const raw = parsed.argsList[index];
      if (!raw) return undefined;
      const num = Number.parseInt(raw, 10);
      return Number.isFinite(num) ? num : undefined;
    },

    async defer(): Promise<void> {
      if ('sendTyping' in message.channel) {
        await message.channel.sendTyping().catch(() => undefined);
      }
    },

    async reply(content: string): Promise<void> {
      if (responseMessage) {
        await responseMessage.edit({ content });
      } else {
        responseMessage = await message.reply({
          content,
          allowedMentions: { repliedUser: false },
        });
      }
    },
  };
}

