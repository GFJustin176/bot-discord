import { generateDependencyReport, version as voiceVersion } from '@discordjs/voice';
import { describe, expect, it, vi } from 'vitest';
import { connectOrGetVoiceConnection } from '../../src/audio/voice-manager.js';

describe('VoiceConnection & Protocolo DAVE (Reprodução do Bug AbortError)', () => {
  it('exige @discordjs/voice >= 0.19.0 com suporte nativo ao protocolo DAVE (Voice Gateway v8)', () => {
    const [major = 0, minor = 0] = voiceVersion.split('.').map((n) => Number.parseInt(n, 10));
    expect(major).toBeGreaterThanOrEqual(0);
    expect(minor).toBeGreaterThanOrEqual(19);
    const report = generateDependencyReport();
    expect(report).toContain('@snazzah/davey');
  });

  it('destrói a conexão presa e lança erro descritivo quando o handshake de voz sofre AbortError', async () => {
    const destroySpy = vi.fn();
    const fakeConnection = {
      state: { status: 'signalling' },
      joinConfig: { channelId: 'ch_1' },
      on: vi.fn(),
      destroy: destroySpy,
    };

    const abortErr = new Error('The operation was aborted');
    abortErr.name = 'AbortError';

    await expect(
      connectOrGetVoiceConnection(
        {
          guildId: 'guild_1',
          channelId: 'ch_1',
          adapterCreator: vi.fn() as never,
          onDisconnectedDestroy: vi.fn(),
        },
        {
          joinFn: () => fakeConnection as never,
          getConnFn: () => undefined,
          entersStateFn: async () => {
            throw abortErr;
          },
          timeoutMs: 100,
        },
      ),
    ).rejects.toThrow(/Tempo limite esgotado ao estabelecer conexão de voz/i);

    expect(destroySpy).toHaveBeenCalledTimes(1);
  });
});
