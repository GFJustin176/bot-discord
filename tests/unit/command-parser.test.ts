import { describe, expect, it } from 'vitest';
import { parsePrefixMessage } from '../../src/bot/command-context.js';
import {
  buildSlashCommandsJson,
  formatCommandsHelp,
  normalizeCommandAlias,
} from '../../src/bot/commands/index.js';
import {
  buildGuildConfigReport,
  parseAutoplayModeArg,
  parseBlacklistCommandArgs,
} from '../../src/bot/commands/queue-commands.js';

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
    expect(slashNames).toContain('skipto');

    expect(normalizeCommandAlias('skipto')).toBe('skipto');
    expect(normalizeCommandAlias('st')).toBe('skipto');
    expect(normalizeCommandAlias('jumpto')).toBe('skipto');
    expect(normalizeCommandAlias('jump')).toBe('skipto');
    expect(normalizeCommandAlias('pularpara')).toBe('skipto');
    expect(normalizeCommandAlias('irpara')).toBe('skipto');
    expect(parsePrefixMessage('!skipto Stay Rihanna', '!')?.rawArgs).toBe('Stay Rihanna');

    expect(slashNames).toContain('blacklist');
    expect(normalizeCommandAlias('blacklist')).toBe('blacklist');
    expect(normalizeCommandAlias('bl')).toBe('blacklist');

    expect(parseBlacklistCommandArgs(undefined, undefined)).toEqual({ kind: 'list' });
    expect(parseBlacklistCommandArgs('clear', undefined)).toEqual({ kind: 'clear' });
    expect(parseBlacklistCommandArgs('slowed', undefined)).toEqual({
      kind: 'update',
      action: 'toggle',
      category: 'slowed',
    });
    expect(parseBlacklistCommandArgs('add slowed intensificado', 'slowed')).toEqual({
      kind: 'update',
      action: 'add',
      category: 'slowed_intensificado',
    });
    expect(parseBlacklistCommandArgs('remove', 'speed_up_intensificado')).toEqual({
      kind: 'update',
      action: 'remove',
      category: 'speed_up_intensificado',
    });
    expect(parseBlacklistCommandArgs('add remix', 'remix')).toEqual({
      kind: 'invalid-category',
      rawInput: 'remix',
    });
    expect(parseBlacklistCommandArgs('rock', undefined)).toEqual({
      kind: 'invalid-category',
      rawInput: 'rock',
    });
  });

  it('exibe status/configuração do servidor e lista completa de comandos no help', () => {
    expect(normalizeCommandAlias('config')).toBe('config');
    expect(normalizeCommandAlias('status')).toBe('config');
    expect(normalizeCommandAlias('cfg')).toBe('config');
    expect(normalizeCommandAlias('help')).toBe('help');
    expect(normalizeCommandAlias('ajuda')).toBe('help');
    expect(normalizeCommandAlias('comandos')).toBe('help');
    expect(normalizeCommandAlias('h')).toBe('help');

    const slashNames = buildSlashCommandsJson().map((c) => c.name);
    expect(slashNames).toContain('config');
    expect(slashNames).toContain('help');

    const emptyReport = buildGuildConfigReport({
      autoplay: false,
      blacklist: [],
    });
    expect(emptyReport).toContain('Desativado');
    expect(emptyReport).toContain('Nenhuma');

    const activeReport = buildGuildConfigReport({
      autoplay: true,
      blacklist: ['slowed', 'speed_up_intensificado'],
    });
    expect(activeReport).toContain('Ativado');
    expect(activeReport).toContain('slowed');
    expect(activeReport).toContain('speed_up_intensificado');

    const helpText = formatCommandsHelp('!');
    for (const cmd of slashNames) {
      expect(helpText).toContain(`/${cmd}`);
    }
    expect(helpText.length).toBeLessThanOrEqual(2000);
  });
});
