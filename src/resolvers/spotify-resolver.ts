import { getEnvConfig } from '../config/env.js';
import type { CompactTrack } from '../queue/track.js';
import { logger } from '../utils/logger.js';

export interface SpotifyRawTrackMeta {
  readonly id: string;
  readonly title: string;
  readonly artists: readonly string[];
  readonly durationMs: number;
  readonly isrc?: string;
}

interface CachedSpotifyToken {
  readonly accessToken: string;
  readonly expiresAtMs: number;
}

let tokenCache: CachedSpotifyToken | undefined;

/**
 * Monta a string de busca tardia (lazy locator) que será consultada no YouTube/YT Music
 * somente quando a faixa estiver prestes a entrar no pré-buffer em RAM.
 */
export function buildSpotifyLazySearchQuery(meta: {
  readonly title: string;
  readonly artists: readonly string[];
  readonly isrc?: string;
}): string {
  const artistStr = meta.artists.filter((a) => a.trim().length > 0).join(', ') || 'Unknown Artist';
  return `${artistStr} - ${meta.title.trim()} audio`;
}

/**
 * Constrói um CompactTrack leve a partir dos metadados do Spotify.
 */
export function buildSpotifyCompactTrack(
  meta: SpotifyRawTrackMeta,
  requestedBy?: string,
): CompactTrack {
  const artist = meta.artists.filter((a) => a.trim().length > 0).join(', ') || 'Artista Desconhecido';
  return {
    id: `sp_${meta.id}`,
    source: 'spotify',
    title: meta.title.trim(),
    artist,
    durationMs: meta.durationMs > 0 ? meta.durationMs : 0,
    locator: buildSpotifyLazySearchQuery(meta),
    webpageUrl: `https://open.spotify.com/track/${meta.id}`,
    requestedBy,
  };
}

/**
 * Extrai faixas da página pública de embed do Spotify (__NEXT_DATA__),
 * permitindo funcionamento mesmo sem SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET.
 */
export function extractTracksFromSpotifyEmbedHtml(
  html: string,
  fallbackId: string,
  requestedBy?: string,
): CompactTrack[] {
  const nextDataMatch =
    /<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/i.exec(html);
  if (!nextDataMatch || !nextDataMatch[1]) {
    return [];
  }

  try {
    const parsed = JSON.parse(nextDataMatch[1]) as {
      props?: {
        pageProps?: {
          state?: {
            data?: {
              entity?: {
                id?: string;
                uri?: string;
                title?: string;
                name?: string;
                subtitle?: string;
                duration?: number;
                artists?: Array<{ name?: string }>;
                trackList?: Array<{
                  uri?: string;
                  title?: string;
                  subtitle?: string;
                  duration?: number;
                }>;
              };
            };
          };
        };
      };
    };

    const entity = parsed.props?.pageProps?.state?.data?.entity;
    if (!entity) {
      return [];
    }

    if (Array.isArray(entity.trackList) && entity.trackList.length > 0) {
      const results: CompactTrack[] = [];
      for (let i = 0; i < entity.trackList.length; i += 1) {
        const item = entity.trackList[i];
        if (!item?.title) continue;
        const uriParts = item.uri?.split(':') ?? [];
        const trackId = uriParts[uriParts.length - 1] || `${fallbackId}_${i}`;
        const rawSubtitle = item.subtitle?.replace(/\u00a0•\u00a0/g, ', ') ?? 'Artista';
        results.push(
          buildSpotifyCompactTrack(
            {
              id: trackId,
              title: item.title,
              artists: [rawSubtitle],
              durationMs: typeof item.duration === 'number' ? item.duration : 0,
            },
            requestedBy,
          ),
        );
      }
      return results;
    }

    const singleTitle = entity.title || entity.name;
    if (singleTitle) {
      const artists =
        entity.artists?.map((a) => a.name ?? '').filter(Boolean) ??
        (entity.subtitle ? [entity.subtitle.replace(/\u00a0•\u00a0/g, ', ')] : ['Artista']);
      return [
        buildSpotifyCompactTrack(
          {
            id: entity.id || fallbackId,
            title: singleTitle,
            artists,
            durationMs: typeof entity.duration === 'number' ? entity.duration : 0,
          },
          requestedBy,
        ),
      ];
    }
  } catch {
    // Falha no parse do JSON de embed; retorna vazio para permitir próximo fallback.
  }

  return [];
}

// Obtém ou renova o token de acesso do Spotify via Client Credentials Flow.
async function getSpotifyApiAccessToken(
  clientId: string,
  clientSecret: string,
  signal?: AbortSignal,
): Promise<string> {
  const now = Date.now();
  if (tokenCache && tokenCache.expiresAtMs > now + 30_000) {
    return tokenCache.accessToken;
  }

  const credentialsBase64 = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const response = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${credentialsBase64}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
    signal,
  });

  if (!response.ok) {
    throw new Error(`Falha ao autenticar na API do Spotify: HTTP ${response.status}`);
  }

  const data = (await response.json()) as { access_token: string; expires_in: number };
  tokenCache = {
    accessToken: data.access_token,
    expiresAtMs: now + data.expires_in * 1000,
  };

  return tokenCache.accessToken;
}

// Extrai faixas via embed público do Spotify (modo sem chaves).
async function fetchViaSpotifyEmbedFallback(
  kind: 'track' | 'album' | 'playlist',
  id: string,
  requestedBy?: string,
  signal?: AbortSignal,
): Promise<CompactTrack[]> {
  const embedUrl = `https://open.spotify.com/embed/${kind}/${id}`;
  const response = await fetch(embedUrl, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    },
    signal,
  });

  if (response.ok) {
    const html = await response.text();
    const extracted = extractTracksFromSpotifyEmbedHtml(html, id, requestedBy);
    if (extracted.length > 0) {
      return extracted;
    }
  }

  // Último fallback para faixa única via endpoint público oEmbed.
  if (kind === 'track') {
    const oembedResp = await fetch(
      `https://open.spotify.com/oembed?url=https://open.spotify.com/track/${id}`,
      { signal },
    );
    if (oembedResp.ok) {
      const oembed = (await oembedResp.json()) as { title?: string };
      if (oembed.title) {
        return [
          buildSpotifyCompactTrack(
            {
              id,
              title: oembed.title,
              artists: ['Spotify'],
              durationMs: 0,
            },
            requestedBy,
          ),
        ];
      }
    }
  }

  throw new Error(
    `Não foi possível extrair os dados do Spotify (${kind}/${id}). Configure SPOTIFY_CLIENT_ID e SPOTIFY_CLIENT_SECRET no .env para playlists grandes.`,
  );
}

interface SpotifyApiTrackObject {
  readonly id?: string | null;
  readonly name?: string;
  readonly duration_ms?: number;
  readonly is_local?: boolean;
  readonly artists?: Array<{ name?: string }>;
  readonly external_ids?: { isrc?: string };
}

function mapApiTrackToCompact(
  item: SpotifyApiTrackObject | null | undefined,
  requestedBy?: string,
): CompactTrack | undefined {
  if (!item || item.is_local || !item.id || !item.name) {
    return undefined;
  }
  const artists = item.artists?.map((a) => a.name ?? '').filter(Boolean) ?? ['Artista'];
  return buildSpotifyCompactTrack(
    {
      id: item.id,
      title: item.name,
      artists,
      durationMs: item.duration_ms ?? 0,
      isrc: item.external_ids?.isrc,
    },
    requestedBy,
  );
}

/**
 * Resolve faixas, álbuns ou playlists do Spotify em modo híbrido:
 * 1. Se SPOTIFY_CLIENT_ID e SPOTIFY_CLIENT_SECRET estiverem definidos, pagina até 25.000 músicas via API oficial.
 * 2. Se não estiverem definidos (ou em caso de falha de credenciais), faz fallback automático via embed público.
 */
export async function* resolveSpotifyStream(
  kind: 'track' | 'album' | 'playlist',
  spotifyId: string,
  requestedBy?: string,
  maxTracks = 25_000,
  signal?: AbortSignal,
): AsyncGenerator<CompactTrack[], void, undefined> {
  const env = getEnvConfig();

  if (env.spotifyHasCredentials && env.spotifyClientId && env.spotifyClientSecret) {
    try {
      const token = await getSpotifyApiAccessToken(
        env.spotifyClientId,
        env.spotifyClientSecret,
        signal,
      );

      if (kind === 'track') {
        const res = await fetch(`https://api.spotify.com/v1/tracks/${spotifyId}`, {
          headers: { Authorization: `Bearer ${token}` },
          signal,
        });
        if (!res.ok) throw new Error(`Spotify API HTTP ${res.status}`);
        const data = (await res.json()) as SpotifyApiTrackObject;
        const mapped = mapApiTrackToCompact(data, requestedBy);
        if (mapped) {
          yield [mapped];
          return;
        }
      } else if (kind === 'playlist') {
        let nextUrl: string | null =
          `https://api.spotify.com/v1/playlists/${spotifyId}/tracks?limit=100&fields=items(track(id,name,duration_ms,is_local,artists(name),external_ids(isrc))),next`;
        let totalEmitted = 0;
        let firstEmitted = false;

        while (nextUrl && totalEmitted < maxTracks && !signal?.aborted) {
          const res = await fetch(nextUrl, {
            headers: { Authorization: `Bearer ${token}` },
            signal,
          });
          if (!res.ok) throw new Error(`Spotify Playlist API HTTP ${res.status}`);
          const page = (await res.json()) as {
            items?: Array<{ track?: SpotifyApiTrackObject | null }>;
            next?: string | null;
          };

          const batch: CompactTrack[] = [];
          for (const entry of page.items ?? []) {
            if (totalEmitted >= maxTracks) break;
            const track = mapApiTrackToCompact(entry.track, requestedBy);
            if (!track) continue;
            totalEmitted += 1;

            if (!firstEmitted) {
              firstEmitted = true;
              yield [track];
            } else {
              batch.push(track);
            }
          }

          if (batch.length > 0) {
            yield batch;
          }

          nextUrl = page.next ?? null;
        }
        if (firstEmitted) return;
      } else if (kind === 'album') {
        const albumRes = await fetch(`https://api.spotify.com/v1/albums/${spotifyId}`, {
          headers: { Authorization: `Bearer ${token}` },
          signal,
        });
        if (!albumRes.ok) throw new Error(`Spotify Album API HTTP ${albumRes.status}`);
        const albumData = (await albumRes.json()) as {
          tracks?: { items?: SpotifyApiTrackObject[]; next?: string | null };
        };

        let items = albumData.tracks?.items ?? [];
        let nextUrl = albumData.tracks?.next ?? null;
        let totalEmitted = 0;
        let firstEmitted = false;

        while (totalEmitted < maxTracks && !signal?.aborted) {
          const batch: CompactTrack[] = [];
          for (const rawTrack of items) {
            if (totalEmitted >= maxTracks) break;
            const track = mapApiTrackToCompact(rawTrack, requestedBy);
            if (!track) continue;
            totalEmitted += 1;

            if (!firstEmitted) {
              firstEmitted = true;
              yield [track];
            } else {
              batch.push(track);
            }
          }

          if (batch.length > 0) {
            yield batch;
          }

          if (!nextUrl || totalEmitted >= maxTracks) break;
          const nextRes = await fetch(nextUrl, {
            headers: { Authorization: `Bearer ${token}` },
            signal,
          });
          if (!nextRes.ok) break;
          const nextPage = (await nextRes.json()) as {
            items?: SpotifyApiTrackObject[];
            next?: string | null;
          };
          items = nextPage.items ?? [];
          nextUrl = nextPage.next ?? null;
        }
        if (firstEmitted) return;
      }
    } catch (err) {
      logger.warn(
        'SpotifyResolver',
        'Falha na API oficial do Spotify; acionando fallback automático via embed.',
        { error: err instanceof Error ? err.message : String(err) },
      );
    }
  }

  // Fallback automático sem chaves (embed público / oEmbed).
  const fallbackTracks = await fetchViaSpotifyEmbedFallback(kind, spotifyId, requestedBy, signal);
  const capped = fallbackTracks.slice(0, maxTracks);
  if (capped.length === 0) {
    throw new Error('Nenhuma faixa encontrada para o link do Spotify informado.');
  }

  // Emite a 1ª faixa imediatamente e o restante no segundo lote.
  const first = capped[0];
  if (first) {
    yield [first];
  }
  if (capped.length > 1) {
    yield capped.slice(1);
  }
}

