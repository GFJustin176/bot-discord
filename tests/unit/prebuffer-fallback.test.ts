import { describe, expect, it, vi } from 'vitest';
import { defaultYtDlpRamLoader } from '../../src/audio/prebuffer-cache.js';
import type { CompactTrack } from '../../src/queue/track.js';
import { type ProcessRunOptions, runProcessToBuffer } from '../../src/utils/process-runner.js';

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
    expect(targetCalls[1]).toContain('The Long Faces - Jane!');
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

  it('filtra variantes (slowed, sped up, etc.) e faixa de duração na busca do Spotify', async () => {
    const track: CompactTrack = {
      id: 'sp_hypnotic',
      source: 'spotify',
      title: 'HYPNOTIC',
      artist: 'ATLXS',
      durationMs: 99_000,
      locator: 'ATLXS - HYPNOTIC',
    };

    const calls: Array<{ args: readonly string[]; options?: ProcessRunOptions }> = [];
    const fakeRunner = vi.fn(
      async (_cmd: string, args: readonly string[], options?: ProcessRunOptions) => {
        calls.push({ args, options });
        return Buffer.from([0x1a, 0x45, 0xdf, 0xa3]);
      },
    );

    const result = await defaultYtDlpRamLoader(
      track,
      25 * 1024 * 1024,
      new AbortController().signal,
      fakeRunner,
    );

    expect(result.mode).toBe('ram');
    expect(calls).toHaveLength(1);
    const args = calls[0]?.args ?? [];
    expect(args[args.length - 1]).toBe('ytsearch5:ATLXS - HYPNOTIC');
    expect(args).toContain('--max-downloads');
    expect(args).toContain('--match-filter');
    const filterExpr = args[args.indexOf('--match-filter') + 1] ?? '';
    expect(filterExpr).toContain('duration >= 74 & duration <= 124');
    expect(filterExpr).toContain('!~=?');
    expect(filterExpr).toContain('\\bslowed\\b');
    expect(calls[0]?.options?.acceptedExitCodes).toEqual([0, 101]);
  });

  it('rejeita ultra/super slowed quando apenas slowed foi pedido e exige o qualificador quando especificado', async () => {
    const onlySlowed: CompactTrack = {
      id: 'sp_only_slowed',
      source: 'spotify',
      title: 'HYPNOTIC (Slowed)',
      artist: 'ATLXS',
      durationMs: 111_000,
      locator: 'ATLXS - HYPNOTIC (Slowed)',
    };
    const superSlowed: CompactTrack = {
      id: 'sp_super_slowed',
      source: 'spotify',
      title: 'HYPNOTIC (Super Slowed)',
      artist: 'ATLXS',
      durationMs: 118_000,
      locator: 'ATLXS - HYPNOTIC (Super Slowed)',
    };

    const calls: string[][] = [];
    const fakeRunner = vi.fn(async (_cmd: string, args: readonly string[]) => {
      calls.push([...args]);
      return Buffer.from([0x1a, 0x45, 0xdf, 0xa3]);
    });

    await defaultYtDlpRamLoader(
      onlySlowed,
      25 * 1024 * 1024,
      new AbortController().signal,
      fakeRunner,
    );
    await defaultYtDlpRamLoader(
      superSlowed,
      25 * 1024 * 1024,
      new AbortController().signal,
      fakeRunner,
    );

    const onlySlowedFilter = calls[0]?.[calls[0].indexOf('--match-filter') + 1] ?? '';
    expect(onlySlowedFilter).toContain('title ~= "(?i)\\bslowed\\b"');
    expect(onlySlowedFilter).toContain('ultra|super|extreme|mega');

    const superSlowedFilter = calls[1]?.[calls[1].indexOf('--match-filter') + 1] ?? '';
    expect(superSlowedFilter).toContain('title ~= "(?i)\\bsuper\\b"');
    expect(superSlowedFilter).toContain('title ~= "(?i)\\bslowed\\b"');
    expect(superSlowedFilter).toContain('ultra|extreme|mega');
    expect(superSlowedFilter).toContain('duration >= 93 & duration <= 143');
  });

  it('runProcessToBuffer aceita códigos de saída configurados (como 101 do --max-downloads)', async () => {
    const buf = await runProcessToBuffer(
      process.execPath,
      ['-e', 'process.stdout.write("ok"); process.exit(101);'],
      { acceptedExitCodes: [0, 101] },
    );
    expect(buf.toString('utf-8')).toBe('ok');
  });
});
