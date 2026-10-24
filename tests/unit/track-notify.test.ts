import { describe, expect, it, vi } from 'vitest';
import { PrebufferCache } from '../../src/audio/prebuffer-cache.js';
import { GuildSession } from '../../src/queue/guild-session.js';
import { type CompactTrack, getSourceLabel } from '../../src/queue/track.js';

describe('Track Notification & Source Display', () => {
  it('retorna os rótulos de origem corretos para YouTube, YouTube Music e Spotify', () => {
    expect(getSourceLabel('youtube')).toBe('YouTube');
    expect(getSourceLabel('ytmusic')).toBe('YouTube Music');
    expect(getSourceLabel('spotify')).toBe('Spotify');
  });

  it('notifica o canal de texto sempre que uma nova música inicia a reprodução', async () => {
    const webmBytes = Buffer.from([0x1a, 0x45, 0xdf, 0xa3]);
    const cache = new PrebufferCache(25 * 1024 * 1024, async () => ({
      mode: 'ram',
      buffer: webmBytes,
    }));

    const session = new GuildSession('guild_notify', 25_000, cache, vi.fn());
    const sendSpy = vi.fn().mockResolvedValue(undefined);
    session.setTextChannel({ send: sendSpy } as never);

    const track1: CompactTrack = {
      id: 't1',
      source: 'ytmusic',
      title: 'Música 1',
      artist: 'Artista 1',
      durationMs: 120_000,
      locator: 'https://music.youtube.com/watch?v=1',
    };
    const track2: CompactTrack = {
      id: 't2',
      source: 'spotify',
      title: 'Música 2',
      artist: 'Artista 2',
      durationMs: 180_000,
      locator: 'Artista 2 - Música 2 audio',
    };

    await session.enqueueAndPlay([track1, track2]);

    // Primeira musica tocou
    expect(sendSpy).toHaveBeenCalledTimes(1);
    expect(sendSpy.mock.calls[0]?.[0]).toContain('Música 1');
    expect(sendSpy.mock.calls[0]?.[0]).toContain('YouTube Music');

    // Troca de musica (termino da primeira ou skip)
    await session.advanceToNextTrack();
    expect(sendSpy).toHaveBeenCalledTimes(2);
    expect(sendSpy.mock.calls[1]?.[0]).toContain('Música 2');
    expect(sendSpy.mock.calls[1]?.[0]).toContain('Spotify');
  });
});
