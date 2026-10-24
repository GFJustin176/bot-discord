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
    durationMs: 180_000,
    locator: `https://www.youtube.com/watch?v=${id}`,
  };
}

describe('GuildSession - Prevenção de Drenagem por Falhas Consecutivas', () => {
  it('interrompe o loop e preserva as faixas restantes na fila quando 3 faixas consecutivas falharem', async () => {
    // Loader que sempre lança erro (simulando bloqueio anti-bot do YouTube)
    const failingLoader = vi.fn().mockRejectedValue(new Error('Sign in to confirm you’re not a bot'));
    const cache = new PrebufferCache(25 * 1024 * 1024, failingLoader);

    const textChannelMock = {
      send: vi.fn().mockResolvedValue({}),
    };

    const session = new GuildSession('guild_error_test', 25_000, cache, vi.fn());
    session.setTextChannel(textChannelMock);

    // Enfileira 10 faixas
    const tracks = Array.from({ length: 10 }, (_, i) => makeTrack(`track_${i + 1}`));
    await session.enqueueAndPlay(tracks);

    // Deve tentar no máximo 3 faixas consecutivas, e parar para NÃO drenar a fila inteira de 10 faixas
    expect(failingLoader).toHaveBeenCalledTimes(3);

    // O restante das faixas (7) deve continuar preservado na fila para não perder a playlist
    expect(session.queue.size).toBe(7);
    expect(session.nowPlaying).toBeUndefined();

    // Deve notificar o usuário no canal de texto sobre a interrupção por erros consecutivos
    expect(textChannelMock.send).toHaveBeenCalledWith(
      expect.stringContaining('Reprodução interrompida após múltiplas falhas consecutivas'),
    );
  });
});
