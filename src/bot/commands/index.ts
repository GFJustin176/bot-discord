import { type RESTPostAPIChatInputApplicationCommandsJSONBody, SlashCommandBuilder } from 'discord.js';
import type { CommandContext } from '../command-context.js';
import {
  handlePauseCommand,
  handlePlayCommand,
  handleResumeCommand,
  handleSkipCommand,
  handleStopCommand,
} from './playback-commands.js';
import {
  handleClearCommand,
  handleLoopCommand,
  handleNowPlayingCommand,
  handleQueueCommand,
  handleShuffleCommand,
} from './queue-commands.js';

export type CommandHandler = (ctx: CommandContext) => Promise<void>;

const ALIAS_MAP: Record<string, string> = {
  play: 'play',
  p: 'play',
  tocar: 'play',
  skip: 'skip',
  s: 'skip',
  pular: 'skip',
  next: 'skip',
  stop: 'stop',
  parar: 'stop',
  leave: 'stop',
  disconnect: 'stop',
  pause: 'pause',
  pausar: 'pause',
  resume: 'resume',
  continuar: 'resume',
  unpause: 'resume',
  queue: 'queue',
  q: 'queue',
  fila: 'queue',
  shuffle: 'shuffle',
  embaralhar: 'shuffle',
  loop: 'loop',
  repeat: 'loop',
  np: 'np',
  nowplaying: 'np',
  tocando: 'np',
  clear: 'clear',
  limpar: 'clear',
};

// Normaliza o nome do comando ou atalho em português/inglês para o identificador canônico.
export function normalizeCommandAlias(input: string): string | undefined {
  return ALIAS_MAP[input.toLowerCase().trim()];
}

const COMMAND_HANDLERS: Record<string, CommandHandler> = {
  play: handlePlayCommand,
  skip: handleSkipCommand,
  stop: handleStopCommand,
  pause: handlePauseCommand,
  resume: handleResumeCommand,
  queue: handleQueueCommand,
  shuffle: handleShuffleCommand,
  loop: handleLoopCommand,
  np: handleNowPlayingCommand,
  clear: handleClearCommand,
};

// Obtém o handler correspondente a um comando Slash ou Prefixo.
export function getCommandHandler(nameOrAlias: string): CommandHandler | undefined {
  const canonical = normalizeCommandAlias(nameOrAlias);
  return canonical ? COMMAND_HANDLERS[canonical] : undefined;
}

// Definições dos Slash Commands para registro na API do Discord.
export function buildSlashCommandsJson(): RESTPostAPIChatInputApplicationCommandsJSONBody[] {
  return [
    new SlashCommandBuilder()
      .setName('play')
      .setDescription('Toca uma música ou playlist do YouTube, YouTube Music ou Spotify (até 25.000 músicas)')
      .addStringOption((opt) =>
        opt
          .setName('busca')
          .setDescription('Link do Spotify, YouTube, YouTube Music ou nome da música')
          .setRequired(true),
      ),
    new SlashCommandBuilder()
      .setName('skip')
      .setDescription('Pula para a próxima música da fila'),
    new SlashCommandBuilder()
      .setName('stop')
      .setDescription('Para a música, limpa a fila e desconecta do canal de voz'),
    new SlashCommandBuilder()
      .setName('pause')
      .setDescription('Pausa a música atual'),
    new SlashCommandBuilder()
      .setName('resume')
      .setDescription('Retoma a música pausada'),
    new SlashCommandBuilder()
      .setName('queue')
      .setDescription('Mostra as músicas na fila de reprodução')
      .addIntegerOption((opt) =>
        opt.setName('pagina').setDescription('Número da página da fila').setRequired(false),
      ),
    new SlashCommandBuilder()
      .setName('shuffle')
      .setDescription('Embaralha todas as músicas da fila (até 25.000 faixas)'),
    new SlashCommandBuilder()
      .setName('loop')
      .setDescription('Altera o modo de repetição (off, track, queue)')
      .addStringOption((opt) =>
        opt
          .setName('modo')
          .setDescription('Modo de repetição')
          .setRequired(false)
          .addChoices(
            { name: 'Desativado (off)', value: 'off' },
            { name: 'Música atual (track)', value: 'track' },
            { name: 'Fila inteira (queue)', value: 'queue' },
          ),
      ),
    new SlashCommandBuilder()
      .setName('np')
      .setDescription('Mostra informações da música que está tocando agora'),
    new SlashCommandBuilder()
      .setName('clear')
      .setDescription('Limpa todas as músicas da fila sem parar a música atual'),
  ].map((cmd) => cmd.toJSON());
}

