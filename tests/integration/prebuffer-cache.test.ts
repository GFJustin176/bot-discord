import { describe, expect, it, vi } from 'vitest';
import { PrebufferCache } from '../../src/audio/prebuffer-cache.js';
import { detectContainerFormat } from '../../src/audio/stream-pipeline.js';
import type { CompactTrack } from '../../src/queue/track.js';

function createTrack(id: string, durationMs = 180_000): CompactTrack {
  return {
    id,
    source: 'youtube',
    title: `Música ${id}`,
    artist: 'Artista',
    durationMs,
    locator: `https://www.youtube.com/watch?v=${id}`,
  };
}

describe('PrebufferCache (Retenção N e N+1 em RAM e Deduplicação)', () => {
  it('reutiliza download em andamento (deduplicação) e retém apenas faixas permitidas na RAM', async () => {
    let downloadCalls = 0;
    const fakeWebmBuffer = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x01, 0x02, 0x03, 0x04]);

    const loader = vi.fn(async () => {
      downloadCalls += 1;
      await new Promise((r) => setTimeout(r, 15));
      return {
        mode: 'ram' as const,
        buffer: fakeWebmBuffer,
      };
    });

    const cache = new PrebufferCache(25 * 1024 * 1024, loader);
    const track1 = createTrack('t1');
    const track2 = createTrack('t2');
    const track3 = createTrack('t3');

    // Dispara pré-carregamento concorrente da mesma faixa: deve executar o loader apenas 1 vez.
    const [resA, resB] = await Promise.all([
      cache.acquire('guild_1', track1),
      cache.acquire('guild_1', track1),
    ]);

    expect(downloadCalls).toBe(1);
    expect(resA.mode).toBe('ram');
    expect(resB.mode).toBe('ram');

    // Pré-carrega N+1 (track2) e mantém apenas t1 e t2.
    await cache.prefetch('guild_1', track2, [track1.id, track2.id]);
    expect(cache.getCachedTrackIds('guild_1')).toEqual(['t1', 't2']);

    // Quando avança para t2 e pré-carrega t3, t1 é removido imediatamente da RAM.
    await cache.prefetch('guild_1', track3, [track2.id, track3.id]);
    expect(cache.getCachedTrackIds('guild_1')).toEqual(['t2', 't3']);

    // Limpeza completa da guild libera todos os buffers.
    cache.clearGuild('guild_1');
    expect(cache.getCachedTrackIds('guild_1')).toEqual([]);
  });

  it('detecta corretamente cabeçalhos WebM (EBML) e Ogg Opus para demux direto sem ffmpeg', () => {
    const webmHeader = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42]);
    const oggHeader = Buffer.from([0x4f, 0x67, 0x67, 0x53, 0x00, 0x02]);
    const mp4Header = Buffer.from([0x00, 0x00, 0x00, 0x18, 0x66, 0x74]);

    expect(detectContainerFormat(webmHeader)).toBe('webm');
    expect(detectContainerFormat(oggHeader)).toBe('ogg');
    expect(detectContainerFormat(mp4Header)).toBe('unknown');
  });
});

