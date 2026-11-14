import { describe, expect, it } from 'vitest';
import { parsePrefixMessage } from '../../src/bot/command-context.js';
import { buildSlashCommandsJson, normalizeCommandAlias } from '../../src/bot/commands/index.js';
import { parseAutoplayModeArg } from '../../src/bot/commands/queue-commands.js';

describe('parsePrefixMessage & normalizeCommandAlias', () => {
  it('extrai comando e texto completo após o prefixo configurado', () => {
    expect(parsePrefixMessage('!play https://youtu.be/dQw4w9WgXcQ', '!')).toEqual({
      commandName: 'play',
      rawArgs: 'https://youtu.be/dQw4w9WgXcQ',
      argsList: ['https://youtu.be/dQw4w9WgXcQ'],
    });

    expect(parsePrefixMessage('!queue 3', '!')).toEqual({
      commandName: 'queue',
      rawArgs: '3',
      argsList: ['3'],
    });
  });

  it('retorna undefined quando a mensagem não inicia com o prefixo', () => {
    expect(parsePrefixMessage('olá pessoal', '!')).toBeUndefined();
    expect(parsePrefixMessage('!', '!')).toBeUndefined();
  });

  it('normaliza atalhos de comandos em português e inglês (ex: !p, !s, !q, !fila)', () => {
    expect(normalizeCommandAlias('p')).toBe('play');
    expect(normalizeCommandAlias('tocar')).toBe('play');
    expect(normalizeCommandAlias('s')).toBe('skip');
    expect(normalizeCommandAlias('pular')).toBe('skip');
    expect(normalizeCommandAlias('q')).toBe('queue');
    expect(normalizeCommandAlias('fila')).toBe('queue');
    expect(normalizeCommandAlias('stop')).toBe('stop');
    expect(normalizeCommandAlias('parar')).toBe('stop');
    expect(normalizeCommandAlias('embaralhar')).toBe('shuffle');
    expect(normalizeCommandAlias('limpar')).toBe('clear');
    expect(normalizeCommandAlias('autoplay')).toBe('autoplay');
    expect(normalizeCommandAlias('ap')).toBe('autoplay');
    expect(normalizeCommandAlias('radio')).toBe('autoplay');
  });

  it('interpreta argumentos enable/disable e registra o slash command /autoplay', () => {
    expect(parseAutoplayModeArg('enable', false)).toBe(true);
    expect(parseAutoplayModeArg('on', false)).toBe(true);
    expect(parseAutoplayModeArg('ativar', false)).toBe(true);
    expect(parseAutoplayModeArg('disable', true)).toBe(false);
    expect(parseAutoplayModeArg('off', true)).toBe(false);
    expect(parseAutoplayModeArg('desativar', true)).toBe(false);
    expect(parseAutoplayModeArg(undefined, false)).toBe(true);
    expect(parseAutoplayModeArg(undefined, true)).toBe(false);
    expect(parseAutoplayModeArg('invalido', false)).toBeUndefined();

    const slashNames = buildSlashCommandsJson().map((c) => c.name);
    expect(slashNames).toContain('autoplay');
  });
});
