import {
  type RESTPostAPIChatInputApplicationCommandsJSONBody,
  SlashCommandBuilder,
} from 'discord.js';
import type { CommandContext } from '../command-context.js';
import {
  handlePauseCommand,
  handlePlayCommand,
  handleResumeCommand,
  handleSkipCommand,
  handleSkipToCommand,
  handleStopCommand,
} from './playback-commands.js';
import {
  handleAutoplayCommand,
  handleBlacklistCommand,
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
  skipto: 'skipto',
  st: 'skipto',
  jumpto: 'skipto',
  jump: 'skipto',
  pularpara: 'skipto',
  irpara: 'skipto',
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
  autoplay: 'autoplay',
  ap: 'autoplay',
  radio: 'autoplay',
  blacklist: 'blacklist',
  bl: 'blacklist',
};

// Normaliza o nome do comando ou atalho em português/inglês para o identificador canônico.
export function normalizeCommandAlias(input: string): string | undefined {
  return ALIAS_MAP[input.toLowerCase().trim()];
}

const COMMAND_HANDLERS: Record<string, CommandHandler> = {
  play: handlePlayCommand,
  skip: handleSkipCommand,
  skipto: handleSkipToCommand,
  stop: handleStopCommand,
  pause: handlePauseCommand,
  resume: handleResumeCommand,
  queue: handleQueueCommand,
  shuffle: handleShuffleCommand,
  loop: handleLoopCommand,
  np: handleNowPlayingCommand,
  clear: handleClearCommand,
  autoplay: handleAutoplayCommand,
  blacklist: handleBlacklistCommand,
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
      .setDescription(
        'Toca uma música ou playlist do YouTube, YouTube Music ou Spotify (até 25.000 músicas)',
      )
      .addStringOption((opt) =>
        opt
          .setName('busca')
          .setDescription('Link do Spotify, YouTube, YouTube Music ou nome da música')
          .setRequired(true),
      ),
    new SlashCommandBuilder().setName('skip').setDescription('Pula para a próxima música da fila'),
    new SlashCommandBuilder()
      .setName('skipto')
      .setDescription('Pula para a música correspondente na fila sem apagar as faixas puladas')
      .addStringOption((opt) =>
        opt
          .setName('busca')
          .setDescription('Nome da música e/ou artista na fila')
          .setRequired(true),
      ),
    new SlashCommandBuilder()
      .setName('stop')
      .setDescription('Para a música, limpa a fila e desconecta do canal de voz'),
    new SlashCommandBuilder().setName('pause').setDescription('Pausa a música atual'),
    new SlashCommandBuilder().setName('resume').setDescription('Retoma a música pausada'),
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
    new SlashCommandBuilder()
      .setName('autoplay')
      .setDescription('Ativa ou desativa a rádio automática baseada no estilo da música atual')
      .addStringOption((opt) =>
        opt
          .setName('modo')
          .setDescription('Ativar ou desativar o Autoplay')
          .setRequired(false)
          .addChoices(
            { name: 'Ativar (enable)', value: 'enable' },
            { name: 'Desativar (disable)', value: 'disable' },
          ),
      ),
    new SlashCommandBuilder()
      .setName('blacklist')
      .setDescription(
        'Bloqueia variantes no Autoplay e substitui automaticamente pela versão normal',
      )
      .addStringOption((opt) =>
        opt
          .setName('acao')
          .setDescription('Ação desejada')
          .setRequired(false)
          .addChoices(
            { name: 'Alternar (toggle)', value: 'toggle' },
            { name: 'Adicionar (add)', value: 'add' },
            { name: 'Remover (remove)', value: 'remove' },
            { name: 'Listar ativas (list)', value: 'list' },
            { name: 'Limpar todas (clear)', value: 'clear' },
          ),
      )
      .addStringOption((opt) =>
        opt
          .setName('categoria')
          .setDescription('Categoria permitida na blacklist do Autoplay')
          .setRequired(false)
          .addChoices(
            { name: 'Slowed (slowed)', value: 'slowed' },
            { name: 'Slowed Intensificado (ultra/super slowed)', value: 'slowed_intensificado' },
            { name: 'Speed Up (speed up / sped up / nightcore)', value: 'speed_up' },
            {
              name: 'Speed Up Intensificado (ultra/super speed up)',
              value: 'speed_up_intensificado',
            },
          ),
      ),
  ].map((cmd) => cmd.toJSON());
}
