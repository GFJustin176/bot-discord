import { describe, expect, it, vi } from 'vitest';
import { PrebufferCache } from '../../src/audio/prebuffer-cache.js';
import { GuildSession } from '../../src/queue/guild-session.js';
import type { CompactTrack } from '../../src/queue/track.js';

function makeTrack(id: string): CompactTrack {
  return {
    id,
    source: 'youtube',
    title: `Faixa ${id}`,
    artist: 'Artista',
    durationMs: 120_000,
    locator: `https://www.youtube.com/watch?v=${id}`,
  };
}

describe('GuildSession (Orquestração de Fila, Pré-Buffer N/N+1 e Permanência em Voz)', () => {
  it('inicia reprodução da 1ª música e pré-carrega automaticamente a faixa N+1 na RAM', async () => {
    const webmBytes = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x00, 0x00, 0x00, 0x00]);
    const loadedIds: string[] = [];

    const cache = new PrebufferCache(25 * 1024 * 1024, async (track) => {
      loadedIds.push(track.id);
      return { mode: 'ram', buffer: webmBytes };
    });

    const playResourceSpy = vi.fn();
    const session = new GuildSession('guild_test', 25_000, cache, playResourceSpy);

    const t1 = makeTrack('1');
    const t2 = makeTrack('2');

    await session.enqueueAndPlay([t1, t2]);

    expect(session.nowPlaying?.id).toBe('1');
    expect(session.queue.size).toBe(1);
    expect(playResourceSpy).toHaveBeenCalledTimes(1);

    // Aguarda microtask do prefetch da faixa N+1 (t2).
    await new Promise((r) => setTimeout(r, 20));
    expect(loadedIds).toContain('1');
    expect(loadedIds).toContain('2');
    expect(cache.getCachedTrackIds('guild_test')).toEqual(['1', '2']);
  });

  it('mantém a sessão viva quando a fila termina (sem desconectar do canal de voz)', async () => {
    const webmBytes = Buffer.from([0x1a, 0x45, 0xdf, 0xa3]);
    const cache = new PrebufferCache(25 * 1024 * 1024, async () => ({
      mode: 'ram',
      buffer: webmBytes,
    }));

    const session = new GuildSession('guild_idle', 25_000, cache, vi.fn());
    await session.enqueueAndPlay([makeTrack('unica')]);
    expect(session.nowPlaying?.id).toBe('unica');

    // Simula fim natural da faixa sem mais itens na fila.
    await session.advanceToNextTrack();
    expect(session.nowPlaying).toBeUndefined();
    expect(session.isDestroyed).toBe(false);
    expect(cache.getCachedTrackIds('guild_idle')).toEqual([]);
  });
});

