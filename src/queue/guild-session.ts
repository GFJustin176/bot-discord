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
import type { TextBasedChannel } from 'discord.js';
import { PrebufferCache } from '../audio/prebuffer-cache.js';
import { createLowJitterAudioResource } from '../audio/stream-pipeline.js';
import { getEnvConfig } from '../config/env.js';
import { type GuildAutoplayStore, defaultGuildAutoplayStore } from '../config/guild-settings.js';
import {
  type AutoplayOptions,
  buildTrackDedupeKey,
  fetchAutoplayRecommendations,
} from '../resolvers/autoplay-resolver.js';
import { logger } from '../utils/logger.js';
import { TrackQueue } from './ring-queue.js';
import { type CompactTrack, formatDuration, getSourceLabel } from './track.js';

export type PlayResourceFn = (resource: AudioResource) => void;
export type TextSender = { send(content: string): Promise<unknown> };
export type AutoplayRecommendationFn = (
  seedTrack: CompactTrack,
  options?: AutoplayOptions,
) => Promise<CompactTrack[]>;

const MAX_AUTOPLAY_HISTORY = 500;

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
  private readonly autoplayFetcher: AutoplayRecommendationFn;
  private readonly autoplayStore: GuildAutoplayStore;

  private currentTrack?: CompactTrack;
  private lastPlayedTrack?: CompactTrack;
  private trackAbortController?: AbortController;
  private ingestAbortController?: AbortController;
  private autoplayAbortController?: AbortController;
  private autoplayInFlight?: Promise<CompactTrack[]>;
  private readonly historyIds = new Set<string>();
  private readonly historyKeys = new Set<string>();
  private readonly historyOrder: Array<{ readonly id: string; readonly key: string }> = [];
  private autoplayEnabled: boolean;
  private ingestingPlaylistCount = 0;
  private transitioning = false;
  private destroyed = false;
  private textChannel?: TextSender | null;

  constructor(
    guildId: string,
    maxQueueSize = getEnvConfig().maxQueueSize,
    prebufferCache?: PrebufferCache,
    customPlayResource?: PlayResourceFn,
    autoplayFetcher?: AutoplayRecommendationFn,
    autoplayStore?: GuildAutoplayStore,
  ) {
    this.guildId = guildId;
    this.queue = new TrackQueue(maxQueueSize);
    this.prebufferCache = prebufferCache ?? new PrebufferCache();
    this.customPlayResource = customPlayResource;
    this.autoplayFetcher = autoplayFetcher ?? fetchAutoplayRecommendations;
    this.autoplayStore = autoplayStore ?? defaultGuildAutoplayStore;
    this.autoplayEnabled = this.autoplayStore.getAutoplay(guildId);

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

  // Indica se o modo de reprodução contínua (Autoplay) está ativo.
  public get autoplay(): boolean {
    return this.autoplayEnabled;
  }

  // Ativa ou desativa o modo Autoplay de forma persistente para o servidor e preenche recomendações imediatas se aplicável.
  public setAutoplay(enabled: boolean): void {
    this.autoplayEnabled = enabled;
    this.autoplayStore.setAutoplay(this.guildId, enabled);
    if (!enabled) {
      this.autoplayAbortController?.abort();
      return;
    }

    const seed = this.currentTrack ?? this.lastPlayedTrack;
    if (seed) {
      void this.maybeFillAutoplay(seed);
    }
  }

  private recordHistory(track: CompactTrack): void {
    const key = buildTrackDedupeKey(track);
    if (this.historyIds.has(track.id) && (!key || this.historyKeys.has(key))) {
      return;
    }

    this.historyIds.add(track.id);
    if (key) {
      this.historyKeys.add(key);
    }
    this.historyOrder.push({ id: track.id, key });

    if (this.historyOrder.length > MAX_AUTOPLAY_HISTORY) {
      const removed = this.historyOrder.shift();
      if (removed) {
        this.historyIds.delete(removed.id);
        if (removed.key) {
          this.historyKeys.delete(removed.key);
        }
      }
    }
  }

  private canTriggerAutoplay(): boolean {
    return (
      !this.destroyed &&
      this.autoplayEnabled &&
      this.queue.loopMode === 'off' &&
      this.queue.size === 0 &&
      !this.isIngestingPlaylist
    );
  }

  private maybeFillAutoplay(seedTrack: CompactTrack): Promise<CompactTrack[]> {
    if (!this.canTriggerAutoplay()) {
      return Promise.resolve([]);
    }

    if (this.autoplayInFlight) {
      return this.autoplayInFlight;
    }

    const controller = new AbortController();
    this.autoplayAbortController = controller;

    const task = this.autoplayFetcher(seedTrack, {
      limit: 5,
      excludeIds: new Set(this.historyIds),
      excludeKeys: new Set(this.historyKeys),
      signal: controller.signal,
    })
      .then(async (recommendations) => {
        if (
          controller.signal.aborted ||
          !this.canTriggerAutoplay() ||
          recommendations.length === 0
        ) {
          return [];
        }

        for (const item of recommendations) {
          this.recordHistory(item);
        }

        if (!this.currentTrack && !this.transitioning) {
          await this.enqueueAndPlay(recommendations);
        } else {
          this.queue.enqueueBatch(recommendations);
          this.triggerNextTrackPrefetch();
        }
        return recommendations;
      })
      .catch((err) => {
        if (!controller.signal.aborted) {
          logger.warn(
            'GuildSession',
            `Falha ao gerar recomendações de Autoplay na guild ${this.guildId}`,
            {
              error: err instanceof Error ? err.message : String(err),
            },
          );
        }
        return [];
      })
      .finally(() => {
        if (this.autoplayAbortController === controller) {
          this.autoplayAbortController = undefined;
        }
        this.autoplayInFlight = undefined;
      });

    this.autoplayInFlight = task;
    return task;
  }

  // Define o canal de texto onde as notificações de troca de música serão enviadas.
  public setTextChannel(channel: TextSender | TextBasedChannel | null | undefined): void {
    this.textChannel = channel && 'send' in channel ? (channel as TextSender) : null;
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

    // Cancela busca de autoplay em andamento caso uma adição manual chegue na fila.
    if (tracks.some((t) => t.requestedBy !== 'Autoplay')) {
      this.autoplayAbortController?.abort();
    }

    for (const track of tracks) {
      this.recordHistory(track);
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
            if (inserted > 0) {
              if (!this.currentTrack && !this.transitioning) {
                // Inicia o próximo lote caso o lote inicial tenha falhado e deixado a sessão ociosa.
                await this.advanceToNextTrack();
              } else if (this.queue.size === inserted) {
                this.triggerNextTrackPrefetch();
              }
            }
          }
        } catch (err) {
          logger.warn(
            'GuildSession',
            `Ingestão em background interrompida na guild ${this.guildId}`,
            {
              error: err instanceof Error ? err.message : String(err),
            },
          );
        } finally {
          this.ingestingPlaylistCount = Math.max(0, this.ingestingPlaylistCount - 1);
          if (this.currentTrack && this.canTriggerAutoplay()) {
            void this.maybeFillAutoplay(this.currentTrack);
          }
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
    if (this.transitioning) {
      return this.currentTrack;
    }

    this.transitioning = true;
    let isFirstAttempt = true;
    let consecutiveFailures = 0;

    try {
      while (!this.destroyed) {
        this.trackAbortController?.abort();

        let nextTrack: CompactTrack | undefined;
        if (
          isFirstAttempt &&
          !forceSkipLoopTrack &&
          this.queue.loopMode === 'track' &&
          this.currentTrack
        ) {
          nextTrack = this.currentTrack;
        } else {
          if (this.queue.loopMode === 'queue' && this.currentTrack) {
            this.queue.enqueue(this.currentTrack);
          }
          nextTrack = this.queue.dequeue();
        }
        isFirstAttempt = false;

        if (!nextTrack) {
          const seed = this.currentTrack ?? this.lastPlayedTrack;
          if (seed && this.canTriggerAutoplay()) {
            await this.maybeFillAutoplay(seed);
            nextTrack = this.queue.dequeue();
          }

          if (!nextTrack) {
            this.currentTrack = undefined;
            this.prebufferCache.clearGuild(this.guildId);
            return undefined;
          }
        }

        this.currentTrack = nextTrack;
        const controller = new AbortController();
        this.trackAbortController = controller;

        try {
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

          // Reinicia o contador de falhas consecutivas ao obter sucesso.
          consecutiveFailures = 0;
          this.lastPlayedTrack = nextTrack;
          this.recordHistory(nextTrack);

          // Com a faixa N já tocando na RAM, dispara em background o pré-carregamento da faixa N+1.
          this.triggerNextTrackPrefetch();

          // Quando a fila esvazia na faixa atual (música única ou última faixa da playlist), abastece o Autoplay.
          if (this.canTriggerAutoplay()) {
            void this.maybeFillAutoplay(nextTrack);
          }

          // Notifica no chat a música que começou a tocar no momento
          if (this.textChannel && 'send' in this.textChannel) {
            const sourceLabel = getSourceLabel(nextTrack.source);
            const autoplayTag = nextTrack.requestedBy === 'Autoplay' ? ' | **Autoplay**' : '';
            void this.textChannel
              .send(
                `🎶 Tocando agora: **${nextTrack.title}** — *${nextTrack.artist}* (\`${formatDuration(nextTrack.durationMs)}\`) [Origem: **${sourceLabel}**${autoplayTag}]`,
              )
              .catch(() => undefined);
          }

          return nextTrack;
        } catch (err) {
          consecutiveFailures += 1;
          logger.warn(
            'GuildSession',
            `Falha ao reproduzir "${nextTrack.title}"; pulando para a próxima.`,
            {
              error: err instanceof Error ? err.message : String(err),
              consecutiveFailures,
            },
          );

          if (consecutiveFailures >= 3) {
            this.currentTrack = undefined;
            if (this.textChannel && 'send' in this.textChannel) {
              void this.textChannel
                .send(
                  '⚠️ Reprodução interrompida após múltiplas falhas consecutivas de extração (bloqueio do YouTube ou erro de rede). As faixas restantes continuam salvas na fila.',
                )
                .catch(() => undefined);
            }
            return undefined;
          }

          if (this.queue.size === 0) {
            this.currentTrack = undefined;
            return undefined;
          }
        }
      }
      return undefined;
    } finally {
      this.transitioning = false;
    }
  }

  // Dispara em background o pré-carregamento da faixa N+1 na memória RAM e limpa faixas antigas.
  public triggerNextTrackPrefetch(): void {
    const upcoming =
      this.queue.loopMode === 'track' && this.currentTrack ? this.currentTrack : this.queue.peek(0);

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
    this.autoplayAbortController?.abort();
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
    this.autoplayAbortController?.abort();
    this.trackAbortController?.abort();
    this.queue.clear();
    this.currentTrack = undefined;
    this.lastPlayedTrack = undefined;
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
