import { describe, expect, it } from 'vitest';
import { classifyQuery } from '../../src/resolvers/url-classifier.js';

describe('classifyQuery (Identificação Multi-Plataforma de URLs e Buscas)', () => {
  it('identifica vídeos e playlists do YouTube tradicional e links curtos youtu.be', () => {
    expect(classifyQuery('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toEqual({
      platform: 'youtube',
      kind: 'track',
      value: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      id: 'dQw4w9WgXcQ',
    });

    expect(classifyQuery('https://youtu.be/dQw4w9WgXcQ?si=abc')).toEqual({
      platform: 'youtube',
      kind: 'track',
      value: 'https://youtu.be/dQw4w9WgXcQ?si=abc',
      id: 'dQw4w9WgXcQ',
    });

    expect(
      classifyQuery('https://www.youtube.com/playlist?list=PLFgquLnL59alCl_2TQvOiD5Vgm1hCaGSI'),
    ).toEqual({
      platform: 'youtube',
      kind: 'playlist',
      value: 'https://www.youtube.com/playlist?list=PLFgquLnL59alCl_2TQvOiD5Vgm1hCaGSI',
      id: 'PLFgquLnL59alCl_2TQvOiD5Vgm1hCaGSI',
    });
  });

  it('identifica faixas e playlists do YouTube Music (music.youtube.com)', () => {
    expect(classifyQuery('https://music.youtube.com/watch?v=abc123XYZ_-')).toEqual({
      platform: 'ytmusic',
      kind: 'track',
      value: 'https://music.youtube.com/watch?v=abc123XYZ_-',
      id: 'abc123XYZ_-',
    });

    expect(classifyQuery('https://music.youtube.com/playlist?list=OLAK5uy_n12345')).toEqual({
      platform: 'ytmusic',
      kind: 'playlist',
      value: 'https://music.youtube.com/playlist?list=OLAK5uy_n12345',
      id: 'OLAK5uy_n12345',
    });

    // Links do YouTube Music copiados com música aberta dentro de uma playlist/álbum (&list=PL... ou OLAK5uy_...)
    expect(
      classifyQuery('https://music.youtube.com/watch?v=abc123XYZ_-&list=PLFgquLnL59alCl_2TQvOiD5Vgm1hCaGSI'),
    ).toEqual({
      platform: 'ytmusic',
      kind: 'playlist',
      value: 'https://www.youtube.com/playlist?list=PLFgquLnL59alCl_2TQvOiD5Vgm1hCaGSI',
      id: 'PLFgquLnL59alCl_2TQvOiD5Vgm1hCaGSI',
    });
  });

  it('identifica faixas, álbuns e playlists do Spotify incluindo rotas /intl-pt/', () => {
    expect(
      classifyQuery('https://open.spotify.com/intl-pt/track/4cOdK2wGLETKBW3PvgPWqT?si=123'),
    ).toEqual({
      platform: 'spotify',
      kind: 'track',
      value: 'https://open.spotify.com/intl-pt/track/4cOdK2wGLETKBW3PvgPWqT?si=123',
      id: '4cOdK2wGLETKBW3PvgPWqT',
    });

    expect(classifyQuery('https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M')).toEqual({
      platform: 'spotify',
      kind: 'playlist',
      value: 'https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M',
      id: '37i9dQZF1DXcBWIGoYBM5M',
    });

    expect(classifyQuery('https://open.spotify.com/album/1ATL5GLyefJaxhQzSPVrLX')).toEqual({
      platform: 'spotify',
      kind: 'album',
      value: 'https://open.spotify.com/album/1ATL5GLyefJaxhQzSPVrLX',
      id: '1ATL5GLyefJaxhQzSPVrLX',
    });
  });

  it('classifica buscas por texto livre como search', () => {
    expect(classifyQuery('daft punk veridis quo')).toEqual({
      platform: 'search',
      kind: 'search',
      value: 'daft punk veridis quo',
    });
  });
});

