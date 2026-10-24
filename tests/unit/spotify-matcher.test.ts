import { describe, expect, it } from 'vitest';
import {
  buildSpotifyCompactTrack,
  buildSpotifyLazySearchQuery,
  extractTracksFromSpotifyEmbedHtml,
} from '../../src/resolvers/spotify-resolver.js';

describe('Spotify Hybrid Resolver & Lazy Matcher', () => {
  it('constrói query otimizada para correspondência precisa no YouTube Music / YouTube', () => {
    const query = buildSpotifyLazySearchQuery({
      title: 'Instant Crush (feat. Julian Casablancas)',
      artists: ['Daft Punk', 'Julian Casablancas'],
      isrc: 'USQX91300106',
    });

    expect(query).toBe('Daft Punk, Julian Casablancas - Instant Crush (feat. Julian Casablancas) audio');
  });

  it('cria CompactTrack lazy para o Spotify sem requisitar o YouTube antecipadamente', () => {
    const track = buildSpotifyCompactTrack(
      {
        id: '4cOdK2wGLETKBW3PvgPWqT',
        title: 'Never Gonna Give You Up',
        artists: ['Rick Astley'],
        durationMs: 213_573,
      },
      'user_abc',
    );

    expect(track.id).toBe('sp_4cOdK2wGLETKBW3PvgPWqT');
    expect(track.source).toBe('spotify');
    expect(track.artist).toBe('Rick Astley');
    expect(track.title).toBe('Never Gonna Give You Up');
    expect(track.durationMs).toBe(213_573);
    expect(track.locator).toBe('Rick Astley - Never Gonna Give You Up audio');
    expect(track.requestedBy).toBe('user_abc');
  });

  it('extrai faixas do HTML de embed público do Spotify (fallback sem chaves de API)', () => {
    const sampleHtml = `
      <html>
        <body>
          <script id="__NEXT_DATA__" type="application/json">
            ${JSON.stringify({
              props: {
                pageProps: {
                  state: {
                    data: {
                      entity: {
                        type: 'playlist',
                        name: 'Minha Playlist',
                        trackList: [
                          {
                            uri: 'spotify:track:111',
                            title: 'Faixa Embed 1',
                            subtitle: 'Artista A\u00a0•\u00a0Artista B',
                            duration: 195000,
                          },
                          {
                            uri: 'spotify:track:222',
                            title: 'Faixa Embed 2',
                            subtitle: 'Artista C',
                            duration: 210000,
                          },
                        ],
                      },
                    },
                  },
                },
              },
            })}
          </script>
        </body>
      </html>
    `;

    const tracks = extractTracksFromSpotifyEmbedHtml(sampleHtml, 'fallback_id', 'user_1');
    expect(tracks).toHaveLength(2);
    expect(tracks[0]?.id).toBe('sp_111');
    expect(tracks[0]?.title).toBe('Faixa Embed 1');
    expect(tracks[0]?.artist).toBe('Artista A, Artista B');
    expect(tracks[1]?.id).toBe('sp_222');
  });
});

