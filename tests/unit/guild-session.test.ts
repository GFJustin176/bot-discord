import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { PrebufferCache } from '../../src/audio/prebuffer-cache.js';
import {
  type GuildAutoplayStore,
  createGuildAutoplayStore,
} from '../../src/config/guild-settings.js';
import { GuildSession } from '../../src/queue/guild-session.js';
import type { CompactTrack } from '../../src/queue/track.js';

function createMemoryAutoplayStore(): GuildAutoplayStore {
  const map = new Map<string, boolean>();
  return {
    getAutoplay: (guildId) => map.get(guildId) ?? false,
    setAutoplay: (guildId, enabled) => {
      map.set(guildId, enabled);
    },
  };
}

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

  it('aciona autoplay imediatamente ao tocar música avulsa e pré-carrega a recomendada na RAM', async () => {
    const webmBytes = Buffer.from([0x1a, 0x45, 0xdf, 0xa3]);
    const loadedIds: string[] = [];
    const cache = new PrebufferCache(25 * 1024 * 1024, async (track) => {
      loadedIds.push(track.id);
      return { mode: 'ram', buffer: webmBytes };
    });

    const recommended = makeTrack('rec_1');
    const autoplaySpy = vi.fn(async () => [recommended]);
    const session = new GuildSession(
      'guild_ap_single',
      25_000,
      cache,
      vi.fn(),
      autoplaySpy,
      createMemoryAutoplayStore(),
    );
    session.setAutoplay(true);

    await session.enqueueAndPlay([makeTrack('single_1')]);
    await new Promise((r) => setTimeout(r, 30));

    expect(autoplaySpy).toHaveBeenCalledTimes(1);
    expect(autoplaySpy.mock.calls[0]?.[0].id).toBe('single_1');
    expect(session.queue.size).toBe(1);
    expect(session.queue.peek(0)?.id).toBe('rec_1');
    expect(loadedIds).toContain('rec_1');
  });

  it('aguarda o fim da playlist e usa a última faixa tocada como semente do autoplay', async () => {
    const webmBytes = Buffer.from([0x1a, 0x45, 0xdf, 0xa3]);
    const cache = new PrebufferCache(25 * 1024 * 1024, async () => ({
      mode: 'ram',
      buffer: webmBytes,
    }));

    const autoplaySpy = vi.fn(async (seed: CompactTrack) => [makeTrack(`after_${seed.id}`)]);
    const session = new GuildSession(
      'guild_ap_playlist',
      25_000,
      cache,
      vi.fn(),
      autoplaySpy,
      createMemoryAutoplayStore(),
    );
    session.setAutoplay(true);

    await session.enqueueAndPlay([makeTrack('pl_1'), makeTrack('pl_2')]);
    await new Promise((r) => setTimeout(r, 20));

    // Ainda há faixa da playlist na fila (pl_2); autoplay não deve disparar antecipadamente.
    expect(autoplaySpy).not.toHaveBeenCalled();

    // Avança para a última música da playlist (pl_2). Agora a fila fica vazia.
    await session.advanceToNextTrack();
    await new Promise((r) => setTimeout(r, 30));

    expect(session.nowPlaying?.id).toBe('pl_2');
    expect(autoplaySpy).toHaveBeenCalledTimes(1);
    expect(autoplaySpy.mock.calls[0]?.[0].id).toBe('pl_2');
    expect(session.queue.peek(0)?.id).toBe('after_pl_2');
  });

  it('respeita exclusão de histórico entre lotes consecutivos e não dispara quando loop está ativo', async () => {
    const webmBytes = Buffer.from([0x1a, 0x45, 0xdf, 0xa3]);
    const cache = new PrebufferCache(25 * 1024 * 1024, async () => ({
      mode: 'ram',
      buffer: webmBytes,
    }));

    const autoplaySpy = vi.fn(async () => [makeTrack('rec_loop')]);
    const session = new GuildSession(
      'guild_ap_loop',
      25_000,
      cache,
      vi.fn(),
      autoplaySpy,
      createMemoryAutoplayStore(),
    );
    session.queue.setLoopMode('track');
    session.setAutoplay(true);

    await session.enqueueAndPlay([makeTrack('base')]);
    await new Promise((r) => setTimeout(r, 20));
    expect(autoplaySpy).not.toHaveBeenCalled();

    // Desativa loop e reativa autoplay para verificar histórico passado nas exclusões.
    session.queue.setLoopMode('off');
    session.setAutoplay(true);
    await new Promise((r) => setTimeout(r, 20));

    expect(autoplaySpy).toHaveBeenCalledTimes(1);
    const callOpts = autoplaySpy.mock.calls[0]?.[1];
    expect(callOpts?.excludeIds?.has('base')).toBe(true);
  });

  it('persiste o estado de autoplay por servidor após desconexão e reinicialização', () => {
    const tempDir = mkdtempSync(path.join(tmpdir(), 'bot-discord-settings-'));
    const settingsFile = path.join(tempDir, 'guild-settings.json');

    try {
      const store1 = createGuildAutoplayStore(settingsFile);
      const cache = new PrebufferCache(25 * 1024 * 1024, async () => ({
        mode: 'ram',
        buffer: Buffer.from([0x1a, 0x45, 0xdf, 0xa3]),
      }));

      // Ao entrar pela primeira vez no servidor, autoplay deve iniciar desativado.
      const session1 = new GuildSession(
        'guild_persist_1',
        25_000,
        cache,
        vi.fn(),
        undefined,
        store1,
      );
      const otherGuild = new GuildSession(
        'guild_persist_2',
        25_000,
        cache,
        vi.fn(),
        undefined,
        store1,
      );
      expect(session1.autoplay).toBe(false);
      expect(otherGuild.autoplay).toBe(false);

      // Ao ativar e encerrar a sessão (stop / canal vazio), a preferência deve persistir.
      session1.setAutoplay(true);
      session1.stopAndDisconnect();

      // Simula nova sessão após reconexão ou reinício completo do bot lendo do mesmo arquivo.
      const store2 = createGuildAutoplayStore(settingsFile);
      const sessionAfterRestart = new GuildSession(
        'guild_persist_1',
        25_000,
        cache,
        vi.fn(),
        undefined,
        store2,
      );
      const otherAfterRestart = new GuildSession(
        'guild_persist_2',
        25_000,
        cache,
        vi.fn(),
        undefined,
        store2,
      );

      expect(sessionAfterRestart.autoplay).toBe(true);
      expect(otherAfterRestart.autoplay).toBe(false);

      // Ao desativar explicitamente, a nova preferência também persiste.
      sessionAfterRestart.setAutoplay(false);
      const store3 = createGuildAutoplayStore(settingsFile);
      const sessionDisabled = new GuildSession(
        'guild_persist_1',
        25_000,
        cache,
        vi.fn(),
        undefined,
        store3,
      );
      expect(sessionDisabled.autoplay).toBe(false);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
