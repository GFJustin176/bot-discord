import { getEnvConfig } from '../config/env.js';
import type { CompactTrack, TrackSource } from '../queue/track.js';
import { streamProcessLines } from '../utils/process-runner.js';
import { parseYtDlpJsonLine, resolveSingleYoutubeTrack } from './youtube-resolver.js';

export interface AutoplayOptions {
  readonly limit?: number;
  readonly excludeIds?: ReadonlySet<string>;
  readonly excludeKeys?: ReadonlySet<string>;
  readonly signal?: AbortSignal;
  readonly resolveSeedTrack?: typeof resolveSingleYoutubeTrack;
  readonly mixLineStreamFactory?: (
    mixUrl: string,
    signal?: AbortSignal,
  ) => AsyncGenerator<string, void, undefined>;
}

const DEFAULT_MIX_FETCH_END = 15;
const DEFAULT_RECOMMENDATIONS_LIMIT = 5;

/**
 * Extrai o videoId do YouTube a partir do identificador ou da URL da faixa.
 * Retorna undefined quando a faixa ainda exige busca textual (ex.: origem Spotify).
 */
export function extractVideoIdFromTrack(track: CompactTrack): string | undefined {
  if (track.source === 'spotify') {
    return undefined;
  }

  if (track.id.startsWith('yt_') || track.id.startsWith('ytm_')) {
    const rawId = track.id.slice(track.id.indexOf('_') + 1).trim();
    if (rawId.length > 0) {
      return rawId;
    }
  }

  const candidateUrl = track.webpageUrl ?? track.locator;
  const queryMatch = /[?&]v=([a-zA-Z0-9_-]{6,})/.exec(candidateUrl);
  if (queryMatch?.[1]) {
    return queryMatch[1];
  }

  const shortMatch = /youtu\.be\/([a-zA-Z0-9_-]{6,})/.exec(candidateUrl);
  return shortMatch?.[1];
}

/**
 * Normaliza título e artista para evitar recomendar versões duplicadas da mesma música
 * (ex.: Official Video vs Official Audio vs Lyrics).
 */
export function buildTrackDedupeKey(track: Pick<CompactTrack, 'title' | 'artist'>): string {
  const cleanTitle = track.title
    .toLowerCase()
    .replace(/\([^)]*\)|\[[^\]]*\]/g, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const cleanArtist = track.artist
    .toLowerCase()
    .replace(/-\s*topic$/i, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // Evita duplicar o nome do artista quando o título do YouTube já segue "Artista - Música".
  if (cleanArtist && !cleanTitle.includes(cleanArtist)) {
    return `${cleanArtist} ${cleanTitle}`.trim();
  }
  return cleanTitle;
}

function defaultMixLineStream(
  mixUrl: string,
  signal?: AbortSignal,
): AsyncGenerator<string, void, undefined> {
  const { ytdlpPath, ytdlpCookieArgs } = getEnvConfig();
  return streamProcessLines(
    ytdlpPath,
    [
      '--flat-playlist',
      '--dump-json',
      '--no-warnings',
      '--ignore-errors',
      '--playlist-end',
      String(DEFAULT_MIX_FETCH_END),
      ...ytdlpCookieArgs,
      mixUrl,
    ],
    { signal },
  );
}

/**
 * Gera recomendações contínuas baseadas no estilo da faixa-semente utilizando o
 * YouTube Radio Mix (list=RD<videoId>) via yt-dlp e filtrando duplicatas da sessão.
 */
export async function fetchAutoplayRecommendations(
  seedTrack: CompactTrack,
  options: AutoplayOptions = {},
): Promise<CompactTrack[]> {
  const limit = Math.max(1, options.limit ?? DEFAULT_RECOMMENDATIONS_LIMIT);
  const resolveSeed = options.resolveSeedTrack ?? resolveSingleYoutubeTrack;
  const createMixStream = options.mixLineStreamFactory ?? defaultMixLineStream;

  let videoId = extractVideoIdFromTrack(seedTrack);
  let targetSource: TrackSource = seedTrack.source === 'ytmusic' ? 'ytmusic' : 'youtube';

  if (!videoId) {
    const resolved = await resolveSeed(seedTrack.locator, 'ytmusic', 'Autoplay', options.signal);
    videoId = extractVideoIdFromTrack(resolved);
    targetSource = resolved.source === 'ytmusic' ? 'ytmusic' : 'youtube';
  }

  if (!videoId) {
    return [];
  }

  const mixUrl = `https://www.youtube.com/watch?v=${videoId}&list=RD${videoId}`;
  const seenIds = new Set<string>(options.excludeIds);
  const seenKeys = new Set<string>(options.excludeKeys);

  // Impede que a própria música-semente seja reenfileirada logo em seguida.
  seenIds.add(seedTrack.id);
  seenIds.add(`yt_${videoId}`);
  seenIds.add(`ytm_${videoId}`);
  seenKeys.add(buildTrackDedupeKey(seedTrack));

  const controller = new AbortController();
  const onExternalAbort = (): void => controller.abort();
  if (options.signal) {
    if (options.signal.aborted) {
      controller.abort();
    } else {
      options.signal.addEventListener('abort', onExternalAbort, { once: true });
    }
  }

  const recommendations: CompactTrack[] = [];
  const stream = createMixStream(
    mixUrl,
    options.mixLineStreamFactory ? options.signal : controller.signal,
  );

  try {
    for await (const line of stream) {
      if (controller.signal.aborted) {
        break;
      }

      const candidate = parseYtDlpJsonLine(line, targetSource, 'Autoplay');
      if (!candidate) {
        continue;
      }

      const candidateVideoId = extractVideoIdFromTrack(candidate);
      const dedupeKey = buildTrackDedupeKey(candidate);

      if (
        seenIds.has(candidate.id) ||
        (candidateVideoId &&
          (seenIds.has(`yt_${candidateVideoId}`) || seenIds.has(`ytm_${candidateVideoId}`))) ||
        (dedupeKey.length > 0 && seenKeys.has(dedupeKey))
      ) {
        continue;
      }

      seenIds.add(candidate.id);
      if (candidateVideoId) {
        seenIds.add(`yt_${candidateVideoId}`);
        seenIds.add(`ytm_${candidateVideoId}`);
      }
      if (dedupeKey.length > 0) {
        seenKeys.add(dedupeKey);
      }

      recommendations.push(candidate);
      if (recommendations.length >= limit) {
        controller.abort();
        break;
      }
    }
  } finally {
    controller.abort();
    options.signal?.removeEventListener('abort', onExternalAbort);
  }

  return recommendations;
}
