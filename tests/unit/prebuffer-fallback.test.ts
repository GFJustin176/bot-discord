import { describe, expect, it, vi } from 'vitest';
import { defaultYtDlpRamLoader } from '../../src/audio/prebuffer-cache.js';
import type { CompactTrack } from '../../src/queue/track.js';

describe('defaultYtDlpRamLoader Fallback (Vídeo Indisponível na URL Direta)', () => {
  it('recorre à busca por texto quando a URL direta falha com erro de vídeo indisponível', async () => {
    const track: CompactTrack = {
      id: 'ytm_HydkjjDNTmY',
      source: 'ytmusic',
      title: 'Jane!',
      artist: 'The Long Faces',
      durationMs: 187_000,
      locator: 'https://music.youtube.com/watch?v=HydkjjDNTmY',
    };

    const targetCalls: string[] = [];
    const fakeRunner = vi.fn(async (_cmd: string, args: readonly string[]) => {
      const target = args[args.length - 1] ?? '';
      targetCalls.push(target);
      if (target.includes('HydkjjDNTmY')) {
        throw new Error(
          'Subprocesso finalizou com código 1: ERROR: [youtube] HydkjjDNTmY: Video unavailable',
        );
      }
      return Buffer.from([0x1a, 0x45, 0xdf, 0xa3]); // buffer webm valido
    });

    const result = await defaultYtDlpRamLoader(
      track,
      25 * 1024 * 1024,
      new AbortController().signal,
      fakeRunner,
    );

    expect(result.mode).toBe('ram');
    expect(targetCalls).toHaveLength(2);
    expect(targetCalls[0]).toBe('https://music.youtube.com/watch?v=HydkjjDNTmY');
    expect(targetCalls[1]).toContain('The Long Faces - Jane! audio');
  });

  it('recorre à busca limpa sem sufixo audio quando busca do Spotify retorna buffer vazio', async () => {
    const track: CompactTrack = {
      id: 'sp_brega',
      source: 'spotify',
      title: 'BREGA ASSUMPTIONS',
      artist: 'DJ NOLOTIL,\u00a0Mc Gw',
      durationMs: 89_000,
      locator: 'DJ NOLOTIL,\u00a0Mc Gw - BREGA ASSUMPTIONS audio',
    };

    const targetCalls: string[] = [];
    const fakeRunner = vi.fn(async (_cmd: string, args: readonly string[]) => {
      const target = args[args.length - 1] ?? '';
      targetCalls.push(target);
      if (target.endsWith(' audio')) {
        return Buffer.alloc(0);
      }
      return Buffer.from([0x1a, 0x45, 0xdf, 0xa3]);
    });

    const result = await defaultYtDlpRamLoader(
      track,
      25 * 1024 * 1024,
      new AbortController().signal,
      fakeRunner,
    );

    expect(result.mode).toBe('ram');
    expect(targetCalls.length).toBeGreaterThanOrEqual(2);
    const fallbackTarget = targetCalls[targetCalls.length - 1] ?? '';
    expect(fallbackTarget.startsWith('ytsearch1:')).toBe(true);
    expect(fallbackTarget).not.toContain('\u00a0');
    expect(fallbackTarget).not.toMatch(/\baudio$/);
    expect(fallbackTarget).toContain('BREGA ASSUMPTIONS');
  });
});
