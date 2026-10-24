import {
  type AudioPlayer,
  AudioPlayerStatus,
  type AudioResource,
  NoSubscriberBehavior,
  type VoiceConnection,
  VoiceConnectionStatus,
  createAudioPlayer,
  getVoiceConnection,
} from '@discordjs/voice';
import { PrebufferCache } from '../audio/prebuffer-cache.js';
import { createLowJitterAudioResource } from '../audio/stream-pipeline.js';
import { getEnvConfig } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { TrackQueue } from './ring-queue.js';
import type { CompactTrack } from './track.js';

export type PlayResourceFn = (resource: AudioResource) => void;

/**
 * Orquestrador de reprodução por servidor Discord (Guild).
 * Coordena a fila de até 25.000 músicas, ingestão em background, pré-buffering em RAM (N e N+1)
 * e ciclo de vida do AudioPlayer sem desconectar ao fim da fila.
 */
export class GuildSession {
  public readonly guildId: string;
  public readonly queue: TrackQueue;
  public readonly player: AudioPlayer;

  private readonly prebufferCache: PrebufferCache;
  private readonly customPlayResource?: PlayResourceFn;

  private currentTrack?: CompactTrack;
  private trackAbortController?: AbortController;
  private ingestAbortController?: AbortController;
  private ingestingPlaylistCount = 0;
  private transitioning = false;
  private destroyed = false;

  constructor(
    guildId: string,
    maxQueueSize = getEnvConfig().maxQueueSize,
    prebufferCache?: PrebufferCache,
    customPlayResource?: PlayResourceFn,
  ) {
    this.guildId = guildId;
    this.queue = new TrackQueue(maxQueueSize);
    this.prebufferCache = prebufferCache ?? new PrebufferCache();
    this.customPlayResource = customPlayResource;

    this.player = createAudioPlayer({
      behaviors: {
        // Evita pausar ou acelerar pacotes caso o bot fique momentaneamente sem assinantes UDP.
        noSubscriber: NoSubscriberBehavior.Play,
        maxMissedFrames: 250,
      },
    });

    this.player.on(AudioPlayerStatus.Idle, () => {
      if (!this.destroyed && !this.transitioning) {
        void this.advanceToNextTrack();
      }
    });

    this.player.on('error', (err) => {
      logger.error(
        'GuildSession',
        `Erro durante reprodução na guild ${this.guildId} (${this.currentTrack?.title ?? 'desconhecida'})`,
        err,
      );
      if (!this.destroyed && !this.transitioning) {
        void this.advanceToNextTrack();
      }
    });
  }

  // Faixa atualmente em reprodução.
  public get nowPlaying(): CompactTrack | undefined {
    return this.currentTrack;
  }

  // Indica se há uma playlist grande sendo ingerida em segundo plano.
  public get isIngestingPlaylist(): boolean {
    return this.ingestingPlaylistCount > 0;
  }

  // Indica se a sessão foi destruída.
  public get isDestroyed(): boolean {
    return this.destroyed;
  }

  // Vincula o AudioPlayer da sessão a uma VoiceConnection ativa.
  public bindVoiceConnection(connection: VoiceConnection): void {
    connection.subscribe(this.player);
  }

  // Adiciona um lote de faixas à fila e inicia a reprodução imediatamente caso o player esteja ocioso.
  public async enqueueAndPlay(tracks: readonly CompactTrack[]): Promise<number> {
    if (tracks.length === 0 || this.destroyed) {
      return 0;
    }

    const added = this.queue.enqueueBatch(tracks);

    if (!this.currentTrack && !this.transitioning) {
      await this.advanceToNextTrack();
    } else {
      // Se já está tocando uma música e a fila estava vazia antes, pré-carrega a nova N+1 em RAM.
      this.triggerNextTrackPrefetch();
    }

    return added;
  }

  /**
   * Consome um stream assíncrono de lotes de faixas (playlists de até 25.000 músicas):
   * - O 1º lote (1ª música) inicia a reprodução imediatamente.
   * - Os lotes seguintes entram na fila em background sem bloquear comandos ou áudio.
   */
  public async ingestTrackStream(
    stream: AsyncGenerator<CompactTrack[], void, undefined>,
  ): Promise<{ firstTrack?: CompactTrack; initialAdded: number }> {
    const controller = new AbortController();
    this.ingestAbortController = controller;
    this.ingestingPlaylistCount += 1;

    try {
      const firstIteration = await stream.next();
      if (firstIteration.done || !firstIteration.value || firstIteration.value.length === 0) {
        this.ingestingPlaylistCount = Math.max(0, this.ingestingPlaylistCount - 1);
        return { initialAdded: 0 };
      }

      const firstBatch = firstIteration.value;
      const firstTrack = firstBatch[0];
      const initialAdded = await this.enqueueAndPlay(firstBatch);

      // Continua ingerindo o restante da playlist em segundo plano até 25.000 itens.
      void (async () => {
        try {
          for await (const batch of stream) {
            if (this.destroyed || controller.signal.aborted || this.queue.remainingCapacity <= 0) {
              break;
            }
            const inserted = this.queue.enqueueBatch(batch);
            if (inserted > 0 && this.queue.size === inserted) {
              this.triggerNextTrackPrefetch();
            }
          }
        } catch (err) {
          logger.warn('GuildSession', `Ingestão em background interrompida na guild ${this.guildId}`, {
            error: err instanceof Error ? err.message : String(err),
          });
        } finally {
          this.ingestingPlaylistCount = Math.max(0, this.ingestingPlaylistCount - 1);
        }
      })();

      return { firstTrack, initialAdded };
    } catch (err) {
      this.ingestingPlaylistCount = Math.max(0, this.ingestingPlaylistCount - 1);
      throw err;
    }
  }

  // Avança para a próxima faixa da fila, utilizando o buffer já pré-carregado em RAM quando disponível.
  public async advanceToNextTrack(forceSkipLoopTrack = false): Promise<CompactTrack | undefined> {
    if (this.destroyed) {
      return undefined;
    }

    this.transitioning = true;
    this.trackAbortController?.abort();

    try {
      let nextTrack: CompactTrack | undefined;

      if (!forceSkipLoopTrack && this.queue.loopMode === 'track' && this.currentTrack) {
        nextTrack = this.currentTrack;
      } else {
        if (this.queue.loopMode === 'queue' && this.currentTrack) {
          this.queue.enqueue(this.currentTrack);
        }
        nextTrack = this.queue.dequeue();
      }

      if (!nextTrack) {
        this.currentTrack = undefined;
        this.prebufferCache.clearGuild(this.guildId);
        // Nota: A VoiceConnection NÃO é destruída quando a fila acaba (permanece no canal enquanto houver humanos).
        return undefined;
      }

      this.currentTrack = nextTrack;
      const controller = new AbortController();
      this.trackAbortController = controller;

      // Carrega prioritariamente a faixa atual (N) e inicia a reprodução antes de disparar o pré-buffer de N+1.
      const prebuffered = await this.prebufferCache.acquire(this.guildId, nextTrack);
      if (controller.signal.aborted || this.destroyed) {
        return this.currentTrack;
      }

      const resource = createLowJitterAudioResource(prebuffered, controller.signal);

      if (this.customPlayResource) {
        this.customPlayResource(resource);
      } else {
        this.player.play(resource);
      }

      // Com a faixa N já tocando na RAM, dispara em background o pré-carregamento da faixa N+1.
      this.triggerNextTrackPrefetch();

      return nextTrack;
    } catch (err) {
      logger.warn('GuildSession', `Falha ao reproduzir "${this.currentTrack?.title}"; pulando para a próxima.`, {
        error: err instanceof Error ? err.message : String(err),
      });
      this.transitioning = false;
      if (this.queue.size > 0 && !this.destroyed) {
        return this.advanceToNextTrack(true);
      }
      this.currentTrack = undefined;
      return undefined;
    } finally {
      this.transitioning = false;
    }
  }

  // Dispara em background o pré-carregamento da faixa N+1 na memória RAM e limpa faixas antigas.
  public triggerNextTrackPrefetch(): void {
    const upcoming =
      this.queue.loopMode === 'track' && this.currentTrack
        ? this.currentTrack
        : this.queue.peek(0);

    const keepIds: string[] = [];
    if (this.currentTrack) keepIds.push(this.currentTrack.id);
    if (upcoming && !keepIds.includes(upcoming.id)) keepIds.push(upcoming.id);

    void this.prebufferCache.prefetch(this.guildId, upcoming, keepIds);
  }

  // Pula a faixa atual imediatamente.
  public async skip(): Promise<CompactTrack | undefined> {
    this.trackAbortController?.abort();
    this.player.stop(true);
    return this.advanceToNextTrack(true);
  }

  // Pausa a reprodução atual.
  public pause(): boolean {
    return this.player.pause(true);
  }

  // Retoma a reprodução pausada.
  public resume(): boolean {
    return this.player.unpause();
  }

  // Limpa a fila e cancela ingestões de playlists em andamento sem parar a faixa atual.
  public clearQueue(): void {
    this.ingestAbortController?.abort();
    this.queue.clear();
    if (this.currentTrack) {
      this.prebufferCache.retainOnly(this.guildId, [this.currentTrack.id]);
    } else {
      this.prebufferCache.clearGuild(this.guildId);
    }
  }

  // Para a reprodução, limpa a fila/RAM e desconecta do canal de voz (quando solicitado via /stop ou canal vazio).
  public stopAndDisconnect(): void {
    this.destroyed = true;
    this.ingestAbortController?.abort();
    this.trackAbortController?.abort();
    this.queue.clear();
    this.currentTrack = undefined;
    this.player.stop(true);
    this.prebufferCache.clearGuild(this.guildId);

    const conn = getVoiceConnection(this.guildId);
    if (conn && conn.state.status !== VoiceConnectionStatus.Destroyed) {
      conn.destroy();
    }
  }
}

// Registro global de sessões ativas por servidor.
const activeSessions = new Map<string, GuildSession>();

export function getOrCreateGuildSession(guildId: string): GuildSession {
  let session = activeSessions.get(guildId);
  if (!session || session.isDestroyed) {
    session = new GuildSession(guildId);
    activeSessions.set(guildId, session);
  }
  return session;
}

export function getGuildSession(guildId: string): GuildSession | undefined {
  const session = activeSessions.get(guildId);
  return session && !session.isDestroyed ? session : undefined;
}

export function destroyGuildSession(guildId: string): void {
  const session = activeSessions.get(guildId);
  if (session) {
    session.stopAndDisconnect();
    activeSessions.delete(guildId);
  }
}

export function destroyAllGuildSessions(): void {
  for (const [guildId, session] of activeSessions.entries()) {
    session.stopAndDisconnect();
    activeSessions.delete(guildId);
  }
}
