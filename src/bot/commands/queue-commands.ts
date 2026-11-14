import { getGuildSession, getOrCreateGuildSession } from '../../queue/guild-session.js';
import {
  AUTOPLAY_BLACKLIST_CATEGORIES,
  AUTOPLAY_BLACKLIST_LABELS,
  type AutoplayBlacklistCategory,
  type LoopMode,
  formatDuration,
  parseBlacklistCategory,
} from '../../queue/track.js';
import type { CommandContext } from '../command-context.js';

// Exibe a fila paginada de até 25.000 músicas.
export async function handleQueueCommand(ctx: CommandContext): Promise<void> {
  const session = getGuildSession(ctx.guildId);
  if (!session || (!session.nowPlaying && session.queue.size === 0)) {
    await ctx.reply('A fila de reprodução está vazia.');
    return;
  }

  const requestedPage = ctx.getIntArg('pagina', 0) ?? 1;
  const pageData = session.queue.getPage(requestedPage, 10);
  const current = session.nowPlaying;

  const lines: string[] = [];
  if (current) {
    lines.push(
      `**Tocando agora:** ${current.title} — *${current.artist}* (\`${formatDuration(current.durationMs)}\`) [${current.source}]`,
    );
  }

  if (pageData.totalItems === 0) {
    lines.push(
      `\n*Nenhuma música aguardando na fila.* | Autoplay: \`${session.autoplay ? 'on' : 'off'}\``,
    );
  } else {
    lines.push(
      `\n**Fila de Espera:** ${pageData.totalItems.toLocaleString('pt-BR')} música(s) | Página ${pageData.currentPage}/${pageData.totalPages} | Loop: \`${session.queue.loopMode}\` | Autoplay: \`${session.autoplay ? 'on' : 'off'}\``,
    );

    const baseNumber = (pageData.currentPage - 1) * 10;
    for (let i = 0; i < pageData.items.length; i += 1) {
      const item = pageData.items[i];
      if (!item) continue;
      lines.push(
        `\`${baseNumber + i + 1}.\` **${item.title}** — *${item.artist}* (\`${formatDuration(item.durationMs)}\`)`,
      );
    }
  }

  if (session.isIngestingPlaylist) {
    lines.push('\n*Carregando faixas restantes da playlist em segundo plano...*');
  }

  await ctx.reply(lines.join('\n'));
}

// Embaralha todas as músicas da fila em O(n) e atualiza o pré-buffer da nova N+1.
export async function handleShuffleCommand(ctx: CommandContext): Promise<void> {
  const session = getGuildSession(ctx.guildId);
  if (!session || session.queue.size < 2) {
    await ctx.reply('São necessárias pelo menos 2 músicas na fila para embaralhar.');
    return;
  }

  session.queue.shuffle();
  session.triggerNextTrackPrefetch();
  await ctx.reply(
    `Fila de **${session.queue.size.toLocaleString('pt-BR')}** músicas embaralhada com sucesso.`,
  );
}

// Altera o modo de repetição (off, track, queue).
export async function handleLoopCommand(ctx: CommandContext): Promise<void> {
  const session = getGuildSession(ctx.guildId);
  if (!session) {
    await ctx.reply('Não há sessão de música ativa.');
    return;
  }

  const rawMode = ctx.getStringArg('modo', 0)?.toLowerCase();
  let nextMode: LoopMode;

  if (rawMode === 'track' || rawMode === 'musica' || rawMode === 'faixa') {
    nextMode = 'track';
  } else if (rawMode === 'queue' || rawMode === 'fila' || rawMode === 'all') {
    nextMode = 'queue';
  } else if (rawMode === 'off' || rawMode === 'desligado' || rawMode === 'none') {
    nextMode = 'off';
  } else {
    // Alterna ciclicamente caso nenhum argumento tenha sido informado.
    nextMode =
      session.queue.loopMode === 'off'
        ? 'track'
        : session.queue.loopMode === 'track'
          ? 'queue'
          : 'off';
  }

  session.queue.setLoopMode(nextMode);
  session.triggerNextTrackPrefetch();

  const labels: Record<LoopMode, string> = {
    off: 'Desativado (`off`)',
    track: 'Repetindo a música atual (`track`)',
    queue: 'Repetindo a fila inteira (`queue`)',
  };

  await ctx.reply(`Modo de repetição alterado para: **${labels[nextMode]}**.`);
}

// Exibe detalhes da música atualmente em reprodução.
export async function handleNowPlayingCommand(ctx: CommandContext): Promise<void> {
  const session = getGuildSession(ctx.guildId);
  const current = session?.nowPlaying;
  if (!session || !current) {
    await ctx.reply('Nenhuma música em reprodução no momento.');
    return;
  }

  await ctx.reply(
    [
      `**Tocando agora:** ${current.title}`,
      `**Artista:** ${current.artist}`,
      `**Duração:** \`${formatDuration(current.durationMs)}\` | **Origem:** \`${current.source}\``,
      `**Músicas restantes na fila:** ${session.queue.size.toLocaleString('pt-BR')} | **Autoplay:** \`${session.autoplay ? 'on' : 'off'}\``,
    ].join('\n'),
  );
}

// Interpreta argumentos enable/disable (e sinônimos) para o comando autoplay.
export function parseAutoplayModeArg(
  rawMode: string | undefined,
  currentEnabled: boolean,
): boolean | undefined {
  const normalized = rawMode?.trim().toLowerCase();
  if (!normalized) {
    return !currentEnabled;
  }
  if (['enable', 'on', 'ativar', 'ativado', 'true', 'sim'].includes(normalized)) {
    return true;
  }
  if (['disable', 'off', 'desativar', 'desativado', 'false', 'nao', 'não'].includes(normalized)) {
    return false;
  }
  return undefined;
}

// Ativa ou desativa a adição automática de músicas relacionadas ao estilo da faixa atual.
export async function handleAutoplayCommand(ctx: CommandContext): Promise<void> {
  const session = getOrCreateGuildSession(ctx.guildId);
  session.setTextChannel(ctx.textChannel);

  const rawMode = ctx.getStringArg('modo', 0);
  const nextState = parseAutoplayModeArg(rawMode, session.autoplay);

  if (nextState === undefined) {
    await ctx.reply(
      `Argumento inválido. Uso: \`autoplay [enable|disable]\` (estado atual: **${session.autoplay ? 'ativado' : 'desativado'}**).`,
    );
    return;
  }

  session.setAutoplay(nextState);
  await ctx.reply(
    nextState
      ? 'Modo **Autoplay ativado** (`enable`). Novas músicas do mesmo estilo serão adicionadas automaticamente quando a fila esvaziar.'
      : 'Modo **Autoplay desativado** (`disable`).',
  );
}

// Limpa apenas a fila de espera mantendo a música atual em reprodução.
export async function handleClearCommand(ctx: CommandContext): Promise<void> {
  const session = getGuildSession(ctx.guildId);
  if (!session || session.queue.size === 0) {
    await ctx.reply('A fila já está vazia.');
    return;
  }

  const count = session.queue.size;
  session.clearQueue();
  await ctx.reply(`Foram removidas **${count.toLocaleString('pt-BR')}** músicas da fila.`);
}

export type ParsedBlacklistArgs =
  | { readonly kind: 'list' }
  | { readonly kind: 'clear' }
  | {
      readonly kind: 'update';
      readonly action: 'add' | 'remove' | 'toggle';
      readonly category: AutoplayBlacklistCategory;
    }
  | { readonly kind: 'missing-category'; readonly action: 'add' | 'remove' | 'toggle' }
  | { readonly kind: 'invalid-category'; readonly rawInput: string };

const BLACKLIST_ACTION_ALIASES: Record<string, 'add' | 'remove' | 'toggle' | 'list' | 'clear'> = {
  add: 'add',
  adicionar: 'add',
  remove: 'remove',
  remover: 'remove',
  rm: 'remove',
  toggle: 'toggle',
  alternar: 'toggle',
  list: 'list',
  listar: 'list',
  clear: 'clear',
  limpar: 'clear',
};

// Interpreta ação e categoria fechada do comando /blacklist (Slash ou Prefixo).
export function parseBlacklistCommandArgs(
  rawFirst?: string,
  rawSecond?: string,
): ParsedBlacklistArgs {
  const first = rawFirst?.trim();
  const second = rawSecond?.trim();

  if (!first && !second) {
    return { kind: 'list' };
  }

  let action: 'add' | 'remove' | 'toggle' = 'toggle';
  let categoryRaw = first ?? '';

  if (first) {
    const tokens = first.split(/\s+/);
    const maybeAction = tokens[0] ? BLACKLIST_ACTION_ALIASES[tokens[0].toLowerCase()] : undefined;
    if (maybeAction) {
      if (maybeAction === 'list') return { kind: 'list' };
      if (maybeAction === 'clear') return { kind: 'clear' };
      action = maybeAction;
      const remainder = tokens.slice(1).join(' ').trim();
      categoryRaw = remainder || second || '';
    } else if (second) {
      categoryRaw = second;
    }
  } else if (second) {
    categoryRaw = second;
  }

  if (!categoryRaw) {
    return { kind: 'missing-category', action };
  }

  const category = parseBlacklistCategory(categoryRaw);
  if (!category) {
    return { kind: 'invalid-category', rawInput: categoryRaw };
  }

  return { kind: 'update', action, category };
}

function formatValidBlacklistCategories(): string {
  return AUTOPLAY_BLACKLIST_CATEGORIES.map(
    (c) => `\`${c}\` (${AUTOPLAY_BLACKLIST_LABELS[c]})`,
  ).join(', ');
}

// Configura a blacklist categorizada aplicável somente ao Autoplay do servidor.
export async function handleBlacklistCommand(ctx: CommandContext): Promise<void> {
  const session = getOrCreateGuildSession(ctx.guildId);
  const parsed = parseBlacklistCommandArgs(
    ctx.getStringArg('acao', 0),
    ctx.getStringArg('categoria', 1),
  );

  if (parsed.kind === 'list') {
    const active = session.blacklist;
    if (active.length === 0) {
      await ctx.reply(
        `A blacklist do **Autoplay** está vazia.\nCategorias permitidas: ${formatValidBlacklistCategories()}.`,
      );
      return;
    }
    const labels = active.map((c) => `\`${c}\` (${AUTOPLAY_BLACKLIST_LABELS[c]})`).join(', ');
    await ctx.reply(`Blacklist ativa do **Autoplay** (substitui pela versão normal): ${labels}.`);
    return;
  }

  if (parsed.kind === 'clear') {
    session.updateBlacklist('clear');
    await ctx.reply('Blacklist do **Autoplay** limpa.');
    return;
  }

  if (parsed.kind === 'missing-category') {
    await ctx.reply(
      `Informe uma categoria válida após \`${parsed.action}\`: ${formatValidBlacklistCategories()}.`,
    );
    return;
  }

  if (parsed.kind === 'invalid-category') {
    await ctx.reply(
      `Categoria inválida: \`${parsed.rawInput}\`. São permitidas apenas: ${formatValidBlacklistCategories()}.`,
    );
    return;
  }

  const result = session.updateBlacklist(parsed.action, parsed.category);
  const label = AUTOPLAY_BLACKLIST_LABELS[parsed.category];
  const stateText = result.active ? 'adicionada à' : 'removida da';
  const activeSummary =
    result.categories.length > 0 ? result.categories.map((c) => `\`${c}\``).join(', ') : 'nenhuma';

  await ctx.reply(
    `Categoria **${label}** (\`${parsed.category}\`) ${stateText} blacklist do **Autoplay**.\nAtivas: ${activeSummary}.`,
  );
}
