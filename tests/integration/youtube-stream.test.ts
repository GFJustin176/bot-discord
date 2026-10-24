import { describe, expect, it } from 'vitest';
import {
  chunkPlaylistStream,
  parseYtDlpJsonLine,
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
});

