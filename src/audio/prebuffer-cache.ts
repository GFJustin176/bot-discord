import { getEnvConfig } from '../config/env.js';
import type { CompactTrack } from '../queue/track.js';
import { logger } from '../utils/logger.js';
import { runProcessToBuffer } from '../utils/process-runner.js';

// Resultado do carregamento de áudio para reprodução.
export type PrebufferedAudio =
  | {
      readonly mode: 'ram';
      readonly buffer: Buffer;
    }
  | {
      readonly mode: 'direct-url';
      readonly streamUrl: string;
    };

export type TrackAudioLoader = (
  track: CompactTrack,
  maxRamBytes: number,
  signal: AbortSignal,
) => Promise<PrebufferedAudio>;

interface GuildCacheState {
  readonly entries: Map<string, PrebufferedAudio>;
  readonly inFlight: Map<
    string,
    {
      readonly promise: Promise<PrebufferedAudio>;
      readonly controller: AbortController;
    }
  >;
}

const MAX_RAM_TRACK_DURATION_MS = 15 * 60 * 1000;

/**
 * Loader padrão que utiliza o yt-dlp para baixar o stream de áudio (priorizando formato 251 WebM/Opus)
 * diretamente para um Buffer em memória RAM, sem tocar no disco/SSD.
 * Para faixas acima de 15 minutos, extrai a URL direta para stream assistido.
 */
export async function defaultYtDlpRamLoader(
  track: CompactTrack,
  maxRamBytes: number,
  signal: AbortSignal,
  processRunner = runProcessToBuffer,
): Promise<PrebufferedAudio> {
  const { ytdlpPath, ytdlpCookieArgs } = getEnvConfig();
  const isHttp = track.locator.startsWith('http://') || track.locator.startsWith('https://');
  const initialTarget = isHttp ? track.locator : `ytsearch1:${track.locator}`;

  const fetchTarget = async (target: string): Promise<PrebufferedAudio> => {
    // Faixas muito longas (> 15 min) usam URL de stream para evitar alocar dezenas de MB na RAM.
    if (track.durationMs > MAX_RAM_TRACK_DURATION_MS) {
      const urlBuf = await processRunner(
        ytdlpPath,
        [
          '-f',
          '251/bestaudio[acodec=opus]/bestaudio',
          '-g',
          '--no-playlist',
          '--no-warnings',
          ...ytdlpCookieArgs,
          target,
        ],
        { signal, timeoutMs: 20_000, maxBytes: 64 * 1024 },
      );
      const streamUrl = urlBuf.toString('utf-8').trim().split(/\r?\n/)[0]?.trim();
      if (!streamUrl) {
        throw new Error(`Não foi possível obter URL de stream para faixa longa: ${track.title}`);
      }
      return { mode: 'direct-url', streamUrl };
    }

    // Baixa os pacotes WebM/Opus (formato 251) diretamente via stdout para a memória RAM.
    const audioBuffer = await processRunner(
      ytdlpPath,
      [
        '-f',
        '251/250/249/bestaudio[acodec=opus]/bestaudio',
        '-o',
        '-',
        '--no-playlist',
        '--no-warnings',
        '--no-part',
        '--concurrent-fragments',
        '4',
        ...ytdlpCookieArgs,
        target,
      ],
      {
        signal,
        timeoutMs: 45_000,
        maxBytes: maxRamBytes,
      },
    );

    if (audioBuffer.length === 0) {
      throw new Error(`Buffer de áudio vazio retornado para a faixa: ${track.title}`);
    }

    return {
      mode: 'ram',
      buffer: audioBuffer,
    };
  };

  try {
    return await fetchTarget(initialTarget);
  } catch (err) {
    // shortcut: busca alternativa se o ID direto da playlist foi removido ou bloqueado na regiao
    if (isHttp && !signal.aborted) {
      const query =
        track.artist && !track.title.toLowerCase().includes(track.artist.toLowerCase())
          ? `ytsearch1:${track.artist} - ${track.title} audio`
          : `ytsearch1:${track.title} audio`;
      return await fetchTarget(query);
    }
    throw err;
  }
}

/**
 * Gerenciador de pré-buffering 100% em memória RAM para as faixas N (atual) e N+1 (próxima).
 * Evita escrita em SSD/HD e garante transição instantânea sem oscilações de velocidade por rede.
 */
export class PrebufferCache {
  private readonly maxRamBytes: number;
  private readonly loader: TrackAudioLoader;
  private readonly guilds = new Map<string, GuildCacheState>();

  constructor(maxRamBytes?: number, customLoader?: TrackAudioLoader) {
    this.maxRamBytes = maxRamBytes ?? getEnvConfig().maxRamBufferBytes;
    this.loader = customLoader ?? defaultYtDlpRamLoader;
  }

  private getGuildState(guildId: string): GuildCacheState {
    let state = this.guilds.get(guildId);
    if (!state) {
      state = {
        entries: new Map(),
        inFlight: new Map(),
      };
      this.guilds.set(guildId, state);
    }
    return state;
  }

  // Obtém o áudio da faixa (do cache em RAM, de um download já em andamento ou iniciando novo).
  public async acquire(guildId: string, track: CompactTrack): Promise<PrebufferedAudio> {
    const state = this.getGuildState(guildId);

    const cached = state.entries.get(track.id);
    if (cached) {
      return cached;
    }

    const existingFlight = state.inFlight.get(track.id);
    if (existingFlight) {
      return existingFlight.promise;
    }

    const controller = new AbortController();
    const promise = this.loader(track, this.maxRamBytes, controller.signal)
      .then((result) => {
        state.inFlight.delete(track.id);
        state.entries.set(track.id, result);
        return result;
      })
      .catch((err) => {
        state.inFlight.delete(track.id);
        throw err;
      });

    state.inFlight.set(track.id, { promise, controller });
    return promise;
  }

  // Pré-carrega a próxima faixa (N+1) em segundo plano e descarta da RAM quaisquer faixas fora de keepTrackIds.
  public async prefetch(
    guildId: string,
    nextTrack: CompactTrack | undefined,
    keepTrackIds: readonly string[],
  ): Promise<void> {
    this.retainOnly(guildId, keepTrackIds);
    if (!nextTrack) {
      return;
    }

    try {
      await this.acquire(guildId, nextTrack);
    } catch (err) {
      logger.warn('PrebufferCache', `Falha no pré-carregamento da faixa N+1 (${nextTrack.title})`, {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Mantém na RAM apenas os IDs informados (tipicamente [faixaAtual.id, proximaFaixa.id]).
  public retainOnly(guildId: string, keepTrackIds: readonly string[]): void {
    const state = this.guilds.get(guildId);
    if (!state) return;

    const allowed = new Set(keepTrackIds);

    for (const key of state.entries.keys()) {
      if (!allowed.has(key)) {
        state.entries.delete(key);
      }
    }

    for (const [key, flight] of state.inFlight.entries()) {
      if (!allowed.has(key)) {
        flight.controller.abort();
        state.inFlight.delete(key);
      }
    }
  }

  // Retorna os IDs atualmente armazenados em RAM para um servidor (útil para diagnóstico e testes).
  public getCachedTrackIds(guildId: string): string[] {
    const state = this.guilds.get(guildId);
    return state ? Array.from(state.entries.keys()) : [];
  }

  // Libera imediatamente toda a memória RAM e cancela downloads pendentes do servidor.
  public clearGuild(guildId: string): void {
    const state = this.guilds.get(guildId);
    if (!state) return;

    for (const flight of state.inFlight.values()) {
      flight.controller.abort();
    }
    state.inFlight.clear();
    state.entries.clear();
    this.guilds.delete(guildId);
  }
}

