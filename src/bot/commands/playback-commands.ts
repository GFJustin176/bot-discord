import { connectOrGetVoiceConnection } from '../../audio/voice-manager.js';
import { getEnvConfig } from '../../config/env.js';
import {
  destroyGuildSession,
  getGuildSession,
  getOrCreateGuildSession,
} from '../../queue/guild-session.js';
import { formatDuration } from '../../queue/track.js';
import { resolveSpotifyStream } from '../../resolvers/spotify-resolver.js';
import { classifyQuery } from '../../resolvers/url-classifier.js';
import {
  resolveSingleYoutubeTrack,
  resolveYoutubePlaylistStream,
} from '../../resolvers/youtube-resolver.js';
import type { CommandContext } from '../command-context.js';

/**
 * Executa o comando play (/play ou !play), suportando:
 * - YouTube (vídeo ou playlist até 25.000 músicas)
 * - YouTube Music (música ou playlist até 25.000 músicas)
 * - Spotify (faixa, álbum ou playlist até 25.000 músicas em modo híbrido)
 * - Busca por texto livre
 */
export async function handlePlayCommand(ctx: CommandContext): Promise<void> {
  const query = ctx.getStringArg('busca', 0);
  if (!query) {
    await ctx.reply(
      'Informe o nome da música ou link do YouTube, YouTube Music ou Spotify. Exemplo: `/play daft punk` ou `!play <url>`.',
    );
    return;
  }

  if (!ctx.voiceChannel) {
    await ctx.reply('Você precisa estar conectado em um canal de voz para reproduzir músicas.');
    return;
  }

  await ctx.defer();

  const session = getOrCreateGuildSession(ctx.guildId);
  if (session.queue.remainingCapacity <= 0) {
    await ctx.reply(
      `A fila atingiu a capacidade máxima de **${getEnvConfig().maxQueueSize.toLocaleString('pt-BR')}** músicas.`,
    );
    return;
  }

  const connection = await connectOrGetVoiceConnection({
    guildId: ctx.guildId,
    channelId: ctx.voiceChannel.id,
    adapterCreator: ctx.voiceAdapterCreator,
    onDisconnectedDestroy: () => destroyGuildSession(ctx.guildId),
  });

  session.bindVoiceConnection(connection);

  const classified = classifyQuery(query);
  const maxRemaining = session.queue.remainingCapacity;

  if (classified.platform === 'spotify' && classified.id) {
    const kind =
      classified.kind === 'playlist'
        ? 'playlist'
        : classified.kind === 'album'
          ? 'album'
          : 'track';

    const stream = resolveSpotifyStream(
      kind,
      classified.id,
      ctx.userTag,
      maxRemaining,
    );
    const { firstTrack } = await session.ingestTrackStream(stream);

    if (!firstTrack) {
      await ctx.reply('Não foi possível encontrar faixas válidas para este link do Spotify.');
      return;
    }

    if (kind === 'track') {
      await ctx.reply(
        `Adicionada via **Spotify**: **${firstTrack.artist} — ${firstTrack.title}** (\`${formatDuration(firstTrack.durationMs)}\`)`,
      );
    } else {
      await ctx.reply(
        `Iniciando **${firstTrack.artist} — ${firstTrack.title}** via **Spotify** (${kind === 'playlist' ? 'Playlist' : 'Álbum'}).\nAs demais faixas estão sendo carregadas em segundo plano (limite até 25.000 músicas).`,
      );
    }
    return;
  }

  if (
    (classified.platform === 'youtube' || classified.platform === 'ytmusic') &&
    classified.kind === 'playlist'
  ) {
    const stream = resolveYoutubePlaylistStream(
      classified.value,
      classified.platform,
      ctx.userTag,
      maxRemaining,
    );
    const { firstTrack } = await session.ingestTrackStream(stream);

    if (!firstTrack) {
      await ctx.reply('Não foi possível carregar faixas desta playlist.');
      return;
    }

    const label = classified.platform === 'ytmusic' ? 'YouTube Music' : 'YouTube';
    await ctx.reply(
      `Iniciando playlist do **${label}** com **${firstTrack.title}** (\`${formatDuration(firstTrack.durationMs)}\`).\nO restante da playlist está sendo enfileirado em segundo plano.`,
    );
    return;
  }

  // Faixa única do YouTube / YouTube Music ou busca por texto livre.
  const source = classified.platform === 'ytmusic' ? 'ytmusic' : 'youtube';
  const track = await resolveSingleYoutubeTrack(classified.value, source, ctx.userTag);
  const wasPlaying = Boolean(session.nowPlaying);

  await session.enqueueAndPlay([track]);

  if (!wasPlaying) {
    await ctx.reply(
      `Tocando agora (pré-buffer em RAM): **${track.title}** — *${track.artist}* (\`${formatDuration(track.durationMs)}\`)`,
    );
  } else {
    await ctx.reply(
      `Adicionada à fila (#${session.queue.size}): **${track.title}** — *${track.artist}* (\`${formatDuration(track.durationMs)}\`)`,
    );
  }
}

// Pula para a próxima faixa da fila.
export async function handleSkipCommand(ctx: CommandContext): Promise<void> {
  const session = getGuildSession(ctx.guildId);
  if (!session || (!session.nowPlaying && session.queue.size === 0)) {
    await ctx.reply('Não há nenhuma música tocando no momento.');
    return;
  }

  const skippedTitle = session.nowPlaying?.title ?? 'Faixa atual';
  await ctx.defer();
  const next = await session.skip();

  if (next) {
    await ctx.reply(
      `Pulada **${skippedTitle}**.\nTocando agora: **${next.title}** — *${next.artist}* (\`${formatDuration(next.durationMs)}\`)`,
    );
  } else {
    await ctx.reply(`Pulada **${skippedTitle}**. A fila terminou (permanecendo no canal de voz).`);
  }
}

// Para a reprodução, limpa a fila/RAM e desconecta do canal de voz.
export async function handleStopCommand(ctx: CommandContext): Promise<void> {
  const session = getGuildSession(ctx.guildId);
  if (!session) {
    await ctx.reply('O bot não está reproduzindo nada neste servidor.');
    return;
  }

  destroyGuildSession(ctx.guildId);
  await ctx.reply('Reprodução encerrada, fila limpa e desconectado do canal de voz.');
}

// Pausa a faixa em reprodução.
export async function handlePauseCommand(ctx: CommandContext): Promise<void> {
  const session = getGuildSession(ctx.guildId);
  if (!session?.nowPlaying) {
    await ctx.reply('Não há música em reprodução para pausar.');
    return;
  }

  session.pause();
  await ctx.reply(`Reprodução pausada: **${session.nowPlaying.title}**.`);
}

// Retoma a faixa pausada.
export async function handleResumeCommand(ctx: CommandContext): Promise<void> {
  const session = getGuildSession(ctx.guildId);
  if (!session?.nowPlaying) {
    await ctx.reply('Não há música pausada no momento.');
    return;
  }

  session.resume();
  await ctx.reply(`Reprodução retomada: **${session.nowPlaying.title}**.`);
}

