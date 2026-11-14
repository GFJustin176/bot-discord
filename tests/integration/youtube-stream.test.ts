import { describe, expect, it, vi } from 'vitest';
import {
  chunkPlaylistStream,
  parseYtDlpJsonLine,
  resolveSingleYoutubeTrack,
} from '../../src/resolvers/youtube-resolver.js';

describe('parseYtDlpJsonLine & chunkPlaylistStream', () => {
  it('converte uma linha JSON do yt-dlp em CompactTrack com valores higienizados', () => {
    const rawLine = JSON.stringify({
      id: 'dQw4w9WgXcQ',
      title: 'Rick Astley - Never Gonna Give You Up',
      uploader: 'Rick Astley',
      duration: 213,
      webpage_url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    });

    const track = parseYtDlpJsonLine(rawLine, 'youtube', 'user_1');
    expect(track).toBeDefined();
    expect(track?.id).toBe('yt_dQw4w9WgXcQ');
    expect(track?.title).toBe('Rick Astley - Never Gonna Give You Up');
    expect(track?.artist).toBe('Rick Astley');
    expect(track?.durationMs).toBe(213_000);
    expect(track?.locator).toBe('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    expect(track?.requestedBy).toBe('user_1');
  });

  it('emite a primeira faixa imediatamente e agrupa as demais em lotes até o limite máximo', async () => {
    async function* fakeLines(): AsyncGenerator<string> {
      for (let i = 1; i <= 120; i += 1) {
        yield JSON.stringify({
          id: `vid_${i}`,
          title: `Música ${i}`,
          channel: `Canal ${i}`,
          duration: 180,
        });
      }
    }

    const batches: number[] = [];
    let totalTracks = 0;

    for await (const batch of chunkPlaylistStream(fakeLines(), 'ytmusic', 'user_1', 100, 25)) {
      batches.push(batch.length);
      totalTracks += batch.length;
    }

    // O primeiro lote tem tamanho 1 (Time-to-First-Audio imediato) e o total respeita o teto de 100.
    expect(batches[0]).toBe(1);
    expect(totalTracks).toBe(100);
  });

  it('seleciona versão exata na busca textual (slowed vs super slowed vs ultra slowed)', async () => {
    const entries = [
      { id: 'JQ34aqP_9u8', title: 'HYPNOTIC (Super Slowed)', uploader: 'ATLXS', duration: 118 },
      { id: 'BRoesAunq1s', title: 'HYPNOTIC (Ultra Slowed)', uploader: 'ATLXS', duration: 124 },
      { id: 'o8oT5owblLQ', title: 'HYPNOTIC (Slowed)', uploader: 'ATLXS', duration: 111 },
      { id: 'OG0REmJEG2Y', title: 'HYPNOTIC', uploader: 'ATLXS', duration: 100 },
    ];

    const fakeRunner = vi.fn(async (_cmd: string, args: readonly string[]) => {
      expect(args[args.length - 1]?.startsWith('ytsearch5:')).toBe(true);
      return Buffer.from(JSON.stringify({ entries }));
    });

    const onlySlowed = await resolveSingleYoutubeTrack(
      'ATLXS HYPNOTIC slowed',
      'youtube',
      'u1',
      undefined,
      fakeRunner,
    );
    expect(onlySlowed.id).toBe('yt_o8oT5owblLQ');

    const superSlowed = await resolveSingleYoutubeTrack(
      'ATLXS HYPNOTIC super slowed',
      'youtube',
      'u1',
      undefined,
      fakeRunner,
    );
    expect(superSlowed.id).toBe('yt_JQ34aqP_9u8');

    const ultraSlowed = await resolveSingleYoutubeTrack(
      'ATLXS HYPNOTIC ultra slowed',
      'youtube',
      'u1',
      undefined,
      fakeRunner,
    );
    expect(ultraSlowed.id).toBe('yt_BRoesAunq1s');

    const normal = await resolveSingleYoutubeTrack(
      'ATLXS HYPNOTIC',
      'youtube',
      'u1',
      undefined,
      fakeRunner,
    );
    expect(normal.id).toBe('yt_OG0REmJEG2Y');
  });
});
