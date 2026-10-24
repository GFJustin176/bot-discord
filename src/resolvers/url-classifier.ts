// Plataforma detectada a partir da entrada do usuário.
export type QueryPlatform = 'youtube' | 'ytmusic' | 'spotify' | 'search';

// Categoria do recurso solicitado.
export type QueryKind = 'track' | 'playlist' | 'album' | 'search';

// Resultado estruturado da classificação de uma query ou URL.
export interface ClassifiedQuery {
  readonly platform: QueryPlatform;
  readonly kind: QueryKind;
  readonly value: string;
  readonly id?: string;
}

const SPOTIFY_REGEX =
  /^https?:\/\/open\.spotify\.com\/(?:intl-[a-zA-Z-]+\/)?(track|playlist|album)\/([a-zA-Z0-9]+)/i;

/**
 * Verifica se o parâmetro list= do YouTube / YouTube Music representa uma playlist ou álbum real
 * (ex: PL..., OLAK5uy_..., UU..., FL..., RDCLAK5uy_...) e não um Mix automático de rádio (RD... / RDAMVM...).
 */
function isExplicitPlaylistId(listId: string): boolean {
  if (listId.startsWith('RDCLAK5uy_')) {
    return true;
  }
  if (listId.startsWith('RD')) {
    return false;
  }
  return true;
}

/**
 * Classifica uma entrada textual (URL do YouTube, YouTube Music, Spotify ou busca livre)
 * para direcionar ao resolver apropriado.
 */
export function classifyQuery(rawInput: string): ClassifiedQuery {
  const input = rawInput.trim();

  const spotifyMatch = SPOTIFY_REGEX.exec(input);
  if (spotifyMatch && spotifyMatch[1] && spotifyMatch[2]) {
    const rawKind = spotifyMatch[1].toLowerCase();
    const kind: QueryKind =
      rawKind === 'playlist' ? 'playlist' : rawKind === 'album' ? 'album' : 'track';
    return {
      platform: 'spotify',
      kind,
      value: input,
      id: spotifyMatch[2],
    };
  }

  try {
    const url = new URL(input);
    const host = url.hostname.toLowerCase();

    if (host === 'youtu.be') {
      const videoId = url.pathname.slice(1).split('/')[0];
      const listId = url.searchParams.get('list');
      if (listId && isExplicitPlaylistId(listId)) {
        return {
          platform: 'youtube',
          kind: 'playlist',
          value: `https://www.youtube.com/playlist?list=${listId}`,
          id: listId,
        };
      }
      if (videoId) {
        return { platform: 'youtube', kind: 'track', value: input, id: videoId };
      }
    }

    const isYtMusic = host === 'music.youtube.com';
    const isYoutube =
      isYtMusic ||
      host === 'youtube.com' ||
      host === 'www.youtube.com' ||
      host === 'm.youtube.com';

    if (isYoutube) {
      const platform: QueryPlatform = isYtMusic ? 'ytmusic' : 'youtube';
      const listId = url.searchParams.get('list');
      const videoId = url.searchParams.get('v');

      // Suporte a links de navegação de playlist do YouTube Music (/browse/VLPL...)
      if (url.pathname.startsWith('/browse/VL')) {
        const browseListId = url.pathname.slice('/browse/VL'.length).split('/')[0];
        if (browseListId) {
          return {
            platform,
            kind: 'playlist',
            value: `https://www.youtube.com/playlist?list=${browseListId}`,
            id: browseListId,
          };
        }
      }

      if (url.pathname.startsWith('/playlist') && listId) {
        return {
          platform,
          kind: 'playlist',
          value: input,
          id: listId,
        };
      }

      // Se o link for /watch?v=...&list=PL... (ou OLAK5uy_...), trata como a playlist solicitada.
      if (listId && isExplicitPlaylistId(listId)) {
        return {
          platform,
          kind: 'playlist',
          value: `https://www.youtube.com/playlist?list=${listId}`,
          id: listId,
        };
      }

      if (videoId) {
        return { platform, kind: 'track', value: input, id: videoId };
      }

      if (listId) {
        return { platform, kind: 'playlist', value: input, id: listId };
      }
    }
  } catch {
    // Não é uma URL válida; prossegue como busca por texto livre.
  }

  return {
    platform: 'search',
    kind: 'search',
    value: input,
  };
}
