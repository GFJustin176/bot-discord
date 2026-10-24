import { describe, expect, it } from 'vitest';
import { parseEnvConfig } from '../../src/config/env.js';

describe('parseEnvConfig', () => {
  it('valida variáveis obrigatórias e aplica padrões seguros', () => {
    const config = parseEnvConfig({
      DISCORD_TOKEN: 'token_valido_123',
      DISCORD_CLIENT_ID: '123456789012345678',
    });

    expect(config.discordToken).toBe('token_valido_123');
    expect(config.discordClientId).toBe('123456789012345678');
    expect(config.commandPrefix).toBe('!');
    expect(config.maxQueueSize).toBe(25_000);
    expect(config.maxRamBufferBytes).toBe(25 * 1024 * 1024);
    expect(config.spotifyHasCredentials).toBe(false);
    expect(Array.isArray(config.ytdlpCookieArgs)).toBe(true);
  });

  it('ativa modo credenciado do Spotify apenas quando clientId e clientSecret estão presentes', () => {
    const config = parseEnvConfig({
      DISCORD_TOKEN: 'token_valido_123',
      DISCORD_CLIENT_ID: '123456789012345678',
      SPOTIFY_CLIENT_ID: 'sp_id',
      SPOTIFY_CLIENT_SECRET: 'sp_secret',
      COMMAND_PREFIX: '?',
      MAX_QUEUE_SIZE: '20000',
      MAX_RAM_BUFFER_MB: '30',
    });

    expect(config.spotifyHasCredentials).toBe(true);
    expect(config.spotifyClientId).toBe('sp_id');
    expect(config.spotifyClientSecret).toBe('sp_secret');
    expect(config.commandPrefix).toBe('?');
    expect(config.maxQueueSize).toBe(20_000);
    expect(config.maxRamBufferBytes).toBe(30 * 1024 * 1024);
  });

  it('lança erro descritivo quando DISCORD_TOKEN ou DISCORD_CLIENT_ID estão ausentes', () => {
    expect(() => parseEnvConfig({})).toThrow('DISCORD_TOKEN');
    expect(() =>
      parseEnvConfig({
        DISCORD_TOKEN: 'token_valido_123',
      }),
    ).toThrow('DISCORD_CLIENT_ID');
  });
});

