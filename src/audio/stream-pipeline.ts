import { spawn } from 'node:child_process';
import { Readable } from 'node:stream';
import { type AudioResource, StreamType, createAudioResource } from '@discordjs/voice';
import { getEnvConfig } from '../config/env.js';
import type { PrebufferedAudio } from './prebuffer-cache.js';

export type ContainerFormat = 'webm' | 'ogg' | 'unknown';

/**
 * Inspeciona os primeiros 4 bytes (Magic Bytes) do Buffer em RAM para identificar
 * se o container já é WebM/Matroska (0x1A 0x45 0xDF 0xA3) ou Ogg (OggS).
 */
export function detectContainerFormat(buffer: Buffer): ContainerFormat {
  if (buffer.length >= 4) {
    if (
      buffer[0] === 0x1a &&
      buffer[1] === 0x45 &&
      buffer[2] === 0xdf &&
      buffer[3] === 0xa3
    ) {
      return 'webm';
    }
    if (
      buffer[0] === 0x4f &&
      buffer[1] === 0x67 &&
      buffer[2] === 0x67 &&
      buffer[3] === 0x53
    ) {
      return 'ogg';
    }
  }
  return 'unknown';
}

/**
 * Cria um AudioResource do @discordjs/voice priorizando leitura direta da RAM sem abrir o ffmpeg:
 * - Se o Buffer em RAM for WebM/Opus (formato 251 do YouTube), usa StreamType.WebmOpus direto.
 * - Se o Buffer em RAM for Ogg/Opus, usa StreamType.OggOpus direto.
 * - Caso contrário (fallback para M4A/AAC ou faixas longas > 15 min), converte via ffmpeg para WebM/Opus.
 */
export function createLowJitterAudioResource(
  audio: PrebufferedAudio,
  signal?: AbortSignal,
): AudioResource {
  if (audio.mode === 'ram') {
    const container = detectContainerFormat(audio.buffer);

    if (container === 'webm') {
      const stream = Readable.from(audio.buffer, { objectMode: false });
      return createAudioResource(stream, {
        inputType: StreamType.WebmOpus,
        inlineVolume: false,
      });
    }

    if (container === 'ogg') {
      const stream = Readable.from(audio.buffer, { objectMode: false });
      return createAudioResource(stream, {
        inputType: StreamType.OggOpus,
        inlineVolume: false,
      });
    }

    // Fallback via ffmpeg lendo do Buffer na memória e emitindo WebM/Opus para evitar uso de addon C++.
    const { ffmpegPath } = getEnvConfig();
    const ffmpeg = spawn(
      ffmpegPath,
      [
        '-hide_banner',
        '-loglevel',
        'error',
        '-i',
        'pipe:0',
        '-vn',
        '-ar',
        '48000',
        '-ac',
        '2',
        '-c:a',
        'libopus',
        '-b:a',
        '128k',
        '-vbr',
        'on',
        '-f',
        'webm',
        'pipe:1',
      ],
      {
        shell: false,
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'ignore'],
      },
    );

    const killFfmpeg = (): void => {
      if (!ffmpeg.killed) {
        ffmpeg.kill('SIGKILL');
      }
    };

    signal?.addEventListener('abort', killFfmpeg, { once: true });
    ffmpeg.stdout.once('close', () => {
      signal?.removeEventListener('abort', killFfmpeg);
      killFfmpeg();
    });

    Readable.from(audio.buffer, { objectMode: false }).pipe(ffmpeg.stdin).on('error', () => {
      // Ignora erro de pipe fechado caso o usuário pule a música durante a leitura.
    });

    return createAudioResource(ffmpeg.stdout, {
      inputType: StreamType.WebmOpus,
      inlineVolume: false,
    });
  }

  // Fallback para faixas muito longas (> 15 min) com reconexão automática de socket no ffmpeg.
  const { ffmpegPath } = getEnvConfig();
  const ffmpeg = spawn(
    ffmpegPath,
    [
      '-hide_banner',
      '-loglevel',
      'error',
      '-reconnect',
      '1',
      '-reconnect_streamed',
      '1',
      '-reconnect_delay_max',
      '5',
      '-i',
      audio.streamUrl,
      '-vn',
      '-ar',
      '48000',
      '-ac',
      '2',
      '-c:a',
      'libopus',
      '-b:a',
      '128k',
      '-vbr',
      'on',
      '-f',
      'webm',
      'pipe:1',
    ],
    {
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore'],
    },
  );

  const killFfmpeg = (): void => {
    if (!ffmpeg.killed) {
      ffmpeg.kill('SIGKILL');
    }
  };

  signal?.addEventListener('abort', killFfmpeg, { once: true });
  ffmpeg.stdout.once('close', () => {
    signal?.removeEventListener('abort', killFfmpeg);
    killFfmpeg();
  });

  return createAudioResource(ffmpeg.stdout, {
    inputType: StreamType.WebmOpus,
    inlineVolume: false,
  });
}

