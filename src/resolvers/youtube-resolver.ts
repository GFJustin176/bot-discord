import { getEnvConfig } from '../config/env.js';
import type { CompactTrack, TrackSource } from '../queue/track.js';
import { runProcessToBuffer, streamProcessLines } from '../utils/process-runner.js';

interface YtDlpJsonItem {
  readonly id?: string;
  readonly url?: string;
  readonly webpage_url?: string;
  readonly title?: string;
  readonly uploader?: string;
  readonly channel?: string;
  readonly artist?: string;
  readonly duration?: number;
}

/**
 * Converte uma linha JSON emitida pelo yt-dlp (--dump-json) em um CompactTrack leve.
 * Ignora vídeos privados, deletados ou indisponíveis.
 */
export function parseYtDlpJsonLine(
  jsonLine: string,
  source: TrackSource,
  requestedBy?: string,
): CompactTrack | undefined {
  try {
    const parsed = JSON.parse(jsonLine) as YtDlpJsonItem;
    const videoId = parsed.id?.trim();
    const title = parsed.title?.trim();

    if (!videoId || !title || title === '[Private video]' || title === '[Deleted video]') {
      return undefined;
    }

    const artist =
      parsed.artist?.trim() ||
      parsed.uploader?.trim() ||
      parsed.channel?.trim() ||
      'Artista Desconhecido';
    const durationSec =
      typeof parsed.duration === 'number' && Number.isFinite(parsed.duration) ? parsed.duration : 0;

    const baseHost = source === 'ytmusic' ? 'https://music.youtube.com' : 'https://www.youtube.com';
    const locator =
      parsed.webpage_url?.trim() ||
      (parsed.url?.startsWith('http') ? parsed.url.trim() : `${baseHost}/watch?v=${videoId}`);

    const prefix = source === 'ytmusic' ? 'ytm' : 'yt';
    return {
      id: `${prefix}_${videoId}`,
      source,
      title,
      artist,
      durationMs: Math.round(durationSec * 1000),
      locator,
      webpageUrl: locator,
      requestedBy,
    };
  } catch {
    return undefined;
  }
}

/**
 * Agrupa o stream de linhas NDJSON do yt-dlp de forma que a 1ª música válida seja emitida imediatamente
 * (lote de 1 item para reprodução instantânea) e o restante em lotes de batchSize até maxTracks.
 */
export async function* chunkPlaylistStream(
  lineGenerator: AsyncGenerator<string, void, undefined>,
  source: TrackSource,
  requestedBy?: string,
  maxTracks = 25_000,
  batchSize = 100,
): AsyncGenerator<CompactTrack[], void, undefined> {
  let emittedCount = 0;
  let currentBatch: CompactTrack[] = [];
  let firstTrackEmitted = false;

  for await (const line of lineGenerator) {
    if (emittedCount >= maxTracks) {
      break;
    }

    const track = parseYtDlpJsonLine(line, source, requestedBy);
    if (!track) {
      continue;
    }

    emittedCount += 1;

    if (!firstTrackEmitted) {
      firstTrackEmitted = true;
      yield [track];
      continue;
    }

    currentBatch.push(track);
    if (currentBatch.length >= batchSize) {
      yield currentBatch;
      currentBatch = [];
    }
  }

  if (currentBatch.length > 0) {
    yield currentBatch;
  }
}

/**
 * Resolve uma única faixa ou busca textual via yt-dlp.
 */
export async function resolveSingleYoutubeTrack(
  queryOrUrl: string,
  source: TrackSource,
  requestedBy?: string,
  signal?: AbortSignal,
): Promise<CompactTrack> {
  const { ytdlpPath } = getEnvConfig();
  const isUrl = queryOrUrl.startsWith('http://') || queryOrUrl.startsWith('https://');
  const target = isUrl ? queryOrUrl : `ytsearch1:${queryOrUrl}`;

  const args = [
    '--dump-single-json',
    '--no-playlist',
    '--flat-playlist',
    '--no-warnings',
    '--geo-bypass',
    target,
  ];

  const buffer = await runProcessToBuffer(ytdlpPath, args, {
    signal,
    timeoutMs: 20_000,
    maxBytes: 5 * 1024 * 1024,
  });

  const text = buffer.toString('utf-8').trim();
  const parsed = JSON.parse(text) as YtDlpJsonItem & { entries?: YtDlpJsonItem[] };
  const entry = Array.isArray(parsed.entries) && parsed.entries[0] ? parsed.entries[0] : parsed;

  const track = parseYtDlpJsonLine(JSON.stringify(entry), source, requestedBy);
  if (!track) {
    throw new Error(`Nenhuma faixa encontrada para: ${queryOrUrl}`);
  }
  return track;
}

/**
 * Resolve uma playlist do YouTube ou YouTube Music de até 25.000 músicas em streaming NDJSON.
 * A primeira faixa é emitida imediatamente; as demais chegam progressivamente em lotes.
 */
export function resolveYoutubePlaylistStream(
  playlistUrl: string,
  source: TrackSource,
  requestedBy?: string,
  maxTracks = 25_000,
  signal?: AbortSignal,
): AsyncGenerator<CompactTrack[], void, undefined> {
  const { ytdlpPath } = getEnvConfig();
  const args = [
    '--flat-playlist',
    '--dump-json',
    '--no-warnings',
    '--ignore-errors',
    '--playlist-end',
    String(maxTracks),
    playlistUrl,
  ];

  const lines = streamProcessLines(ytdlpPath, args, { signal });
  return chunkPlaylistStream(lines, source, requestedBy, maxTracks, 100);
}

