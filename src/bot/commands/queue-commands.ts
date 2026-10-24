import { getGuildSession } from '../../queue/guild-session.js';
import { type LoopMode, formatDuration } from '../../queue/track.js';
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
    lines.push('\n*Nenhuma música aguardando na fila.*');
  } else {
    lines.push(
      `\n**Fila de Espera:** ${pageData.totalItems.toLocaleString('pt-BR')} música(s) | Página ${pageData.currentPage}/${pageData.totalPages} | Loop: \`${session.queue.loopMode}\``,
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
      `**Músicas restantes na fila:** ${session.queue.size.toLocaleString('pt-BR')}`,
    ].join('\n'),
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

