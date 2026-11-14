import { describe, expect, it, vi } from 'vitest';
import type { CompactTrack } from '../../src/queue/track.js';
import {
  buildTrackDedupeKey,
  extractVideoIdFromTrack,
  fetchAutoplayRecommendations,
} from '../../src/resolvers/autoplay-resolver.js';

function makeYoutubeTrack(videoId: string, title: string, artist = 'Artista'): CompactTrack {
  return {
    id: `yt_${videoId}`,
    source: 'youtube',
    title,
    artist,
    durationMs: 210_000,
    locator: `https://www.youtube.com/watch?v=${videoId}`,
    webpageUrl: `https://www.youtube.com/watch?v=${videoId}`,
  };
}

describe('autoplay-resolver (YouTube Radio Mix & Deduplicação)', () => {
  it('extrai videoId diretamente de faixas do YouTube e YouTube Music', () => {
    expect(extractVideoIdFromTrack(makeYoutubeTrack('dQw4w9WgXcQ', 'Test'))).toBe('dQw4w9WgXcQ');
    expect(
      extractVideoIdFromTrack({
        id: 'ytm_abc123XYZ',
        source: 'ytmusic',
        title: 'Faixa YTM',
        artist: 'Banda',
        durationMs: 180_000,
        locator: 'https://music.youtube.com/watch?v=abc123XYZ',
      }),
    ).toBe('abc123XYZ');
  });

  it('normaliza chaves de deduplicação removendo sufixos de clipe/áudio oficial', () => {
    const k1 = buildTrackDedupeKey({
      title: 'Tears For Fears - Everybody Wants To Rule The World (Official Video)',
      artist: 'Tears For Fears',
    });
    const k2 = buildTrackDedupeKey({
      title: 'Everybody Wants To Rule The World [Official Audio]',
      artist: 'Tears For Fears',
    });
    expect(k1).toBe(k2);
  });

  it('filtra faixa-semente, histórico e duplicatas por título/artista retornando até limit faixas', async () => {
    const seed = makeYoutubeTrack('seed123', 'Seed Song', 'Band A');
    const ndjsonLines = [
      JSON.stringify({ id: 'seed123', title: 'Seed Song', artist: 'Band A', duration: 200 }),
      JSON.stringify({ id: 'hist456', title: 'Already Played', artist: 'Band B', duration: 190 }),
      JSON.stringify({
        id: 'rec1',
        title: 'Next Hit (Official Video)',
        artist: 'Band C',
        duration: 215,
      }),
      JSON.stringify({
        id: 'rec1_alt',
        title: 'Next Hit [Lyrics]',
        artist: 'Band C',
        duration: 216,
      }),
      JSON.stringify({ id: 'rec2', title: 'Another Track', artist: 'Band D', duration: 180 }),
      JSON.stringify({ id: 'rec3', title: 'Third Track', artist: 'Band E', duration: 240 }),
    ];

    async function* fakeLineStream(): AsyncGenerator<string, void, undefined> {
      for (const line of ndjsonLines) {
        yield line;
      }
    }

    const mixStreamFactory = vi.fn(() => fakeLineStream());
    const results = await fetchAutoplayRecommendations(seed, {
      limit: 2,
      excludeIds: new Set(['yt_hist456']),
      excludeKeys: new Set([buildTrackDedupeKey({ title: 'Already Played', artist: 'Band B' })]),
      mixLineStreamFactory: mixStreamFactory,
    });

    expect(mixStreamFactory).toHaveBeenCalledWith(
      'https://www.youtube.com/watch?v=seed123&list=RDseed123',
      undefined,
    );
    expect(results).toHaveLength(2);
    expect(results[0]?.id).toBe('yt_rec1');
    expect(results[0]?.requestedBy).toBe('Autoplay');
    expect(results[1]?.id).toBe('yt_rec2');
  });

  it('resolve semente do Spotify via YouTube Music antes de consultar o Mix RD<videoId>', async () => {
    const spotifySeed: CompactTrack = {
      id: 'sp_7ouMYWpwJ422jRcDASZB7P',
      source: 'spotify',
      title: 'Knights of Cydonia',
      artist: 'Muse',
      durationMs: 366_000,
      locator: 'Muse - Knights of Cydonia audio',
    };

    const resolveSeedSpy = vi.fn(async () => ({
      id: 'ytm_G_sBOsh-vyI',
      source: 'ytmusic' as const,
      title: 'Knights of Cydonia',
      artist: 'Muse',
      durationMs: 366_000,
      locator: 'https://music.youtube.com/watch?v=G_sBOsh-vyI',
    }));

    async function* fakeMixStream(): AsyncGenerator<string, void, undefined> {
      yield JSON.stringify({
        id: 'G_sBOsh-vyI',
        title: 'Knights of Cydonia',
        artist: 'Muse',
        duration: 366,
      });
      yield JSON.stringify({
        id: 'w8KQmps-Sog',
        title: 'Uprising',
        artist: 'Muse',
        duration: 304,
      });
    }

    const mixStreamFactory = vi.fn(() => fakeMixStream());
    const results = await fetchAutoplayRecommendations(spotifySeed, {
      limit: 5,
      resolveSeedTrack: resolveSeedSpy,
      mixLineStreamFactory: mixStreamFactory,
    });

    expect(resolveSeedSpy).toHaveBeenCalledWith(
      'Muse - Knights of Cydonia audio',
      'ytmusic',
      'Autoplay',
      undefined,
    );
    expect(mixStreamFactory).toHaveBeenCalledWith(
      'https://www.youtube.com/watch?v=G_sBOsh-vyI&list=RDG_sBOsh-vyI',
      undefined,
    );
    expect(results).toHaveLength(1);
    expect(results[0]?.title).toBe('Uprising');
    expect(results[0]?.source).toBe('ytmusic');
  });
});
