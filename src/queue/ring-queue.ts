import type { CompactTrack, LoopMode } from './track.js';

// Estrutura de retorno para consulta paginada da fila.
export interface QueuePage {
  readonly items: readonly CompactTrack[];
  readonly currentPage: number;
  readonly totalPages: number;
  readonly totalItems: number;
}

const COMPACTION_THRESHOLD = 2048;

/**
 * Fila indexada baseada em ponteiro lógico (head) para garantir desenfileiramento O(1)
 * sem realocação de memória a cada avanço em filas de até 25.000 músicas.
 */
export class TrackQueue {
  private readonly maxCapacity: number;
  private items: CompactTrack[] = [];
  private head = 0;
  private currentLoopMode: LoopMode = 'off';

  constructor(maxCapacity = 25_000) {
    this.maxCapacity = maxCapacity;
  }

  // Quantidade atual de faixas aguardando na fila.
  public get size(): number {
    return this.items.length - this.head;
  }

  // Quantidade de vagas restantes até atingir o limite máximo configurado.
  public get remainingCapacity(): number {
    return Math.max(0, this.maxCapacity - this.size);
  }

  // Obtém o modo de repetição ativo.
  public get loopMode(): LoopMode {
    return this.currentLoopMode;
  }

  // Altera o modo de repetição ativo.
  public setLoopMode(mode: LoopMode): void {
    this.currentLoopMode = mode;
  }

  // Insere uma única faixa no final da fila caso haja capacidade disponível.
  public enqueue(track: CompactTrack): boolean {
    if (this.size >= this.maxCapacity) {
      return false;
    }
    this.items.push(track);
    return true;
  }

  // Insere um lote de faixas respeitando o limite máximo de 25.000 itens e retorna quantas foram inseridas.
  public enqueueBatch(tracks: readonly CompactTrack[]): number {
    const available = this.remainingCapacity;
    if (available <= 0 || tracks.length === 0) {
      return 0;
    }

    const countToInsert = Math.min(tracks.length, available);
    for (let i = 0; i < countToInsert; i += 1) {
      const track = tracks[i];
      if (track) {
        this.items.push(track);
      }
    }
    return countToInsert;
  }

  // Retorna a próxima faixa sem removê-la da fila (usado pelo pré-buffer da faixa N+1).
  public peek(offset = 0): CompactTrack | undefined {
    const targetIndex = this.head + offset;
    if (targetIndex < this.head || targetIndex >= this.items.length) {
      return undefined;
    }
    return this.items[targetIndex];
  }

  // Remove e retorna a próxima faixa da fila em tempo O(1).
  public dequeue(): CompactTrack | undefined {
    if (this.size === 0) {
      return undefined;
    }

    const track = this.items[this.head];
    this.head += 1;

    // Compacta o vetor subjacente apenas quando o prefixo consumido acumula ao menos 2.048 posições.
    if (this.head >= COMPACTION_THRESHOLD && this.head * 2 >= this.items.length) {
      this.items = this.items.slice(this.head);
      this.head = 0;
    } else if (this.size === 0) {
      this.items = [];
      this.head = 0;
    }

    return track;
  }

  // Embaralha todas as faixas pendentes in-place usando o algoritmo Fisher-Yates O(n).
  public shuffle(): void {
    const activeLength = this.size;
    if (activeLength <= 1) {
      return;
    }

    for (let i = this.items.length - 1; i > this.head; i -= 1) {
      const randomIndex = this.head + Math.floor(Math.random() * (i - this.head + 1));
      const temp = this.items[i];
      const swapped = this.items[randomIndex];
      if (temp !== undefined && swapped !== undefined) {
        this.items[i] = swapped;
        this.items[randomIndex] = temp;
      }
    }
  }

  // Limpa completamente a fila e libera referências para coleta de lixo imediata.
  public clear(): void {
    this.items = [];
    this.head = 0;
  }

  // Retorna uma fatia paginada da fila sem clonar toda a estrutura.
  public getPage(page = 1, pageSize = 10): QueuePage {
    const totalItems = this.size;
    const safePageSize = Math.max(1, Math.min(50, pageSize));
    const totalPages = Math.max(1, Math.ceil(totalItems / safePageSize));
    const currentPage = Math.max(1, Math.min(page, totalPages));

    const startOffset = (currentPage - 1) * safePageSize;
    const startIndex = this.head + startOffset;
    const endIndex = Math.min(this.items.length, startIndex + safePageSize);

    const slice = startIndex < this.items.length ? this.items.slice(startIndex, endIndex) : [];

    return {
      items: slice,
      currentPage,
      totalPages,
      totalItems,
    };
  }
}

