import { describe, expect, it } from 'vitest';
import { shouldAutoLeaveVoiceChannel } from '../../src/bot/events/voice-state-update.js';

describe('shouldAutoLeaveVoiceChannel (Desconexão Estrita Somente em Canal Vazio)', () => {
  it('retorna true somente quando não restam membros humanos (não-bots) no canal de voz', () => {
    expect(
      shouldAutoLeaveVoiceChannel([
        { isBot: true }, // O próprio bot de música
        { isBot: true }, // Outro bot qualquer
      ]),
    ).toBe(true);
  });

  it('retorna false enquanto houver pelo menos 1 usuário humano no canal de voz', () => {
    expect(
      shouldAutoLeaveVoiceChannel([
        { isBot: true },
        { isBot: false }, // Usuário humano ouvindo
      ]),
    ).toBe(false);
  });
});

