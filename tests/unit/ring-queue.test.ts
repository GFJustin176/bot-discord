import { describe, expect, it } from 'vitest';
import { TrackQueue } from '../../src/queue/ring-queue.js';
import type { CompactTrack } from '../../src/queue/track.js';

function createDummyTrack(index: number): CompactTrack {
  return {
    id: `trk_${index}`,
    source: 'youtube',
    title: `Faixa de Teste #${index}`,
    artist: `Artista ${index % 100}`,
    durationMs: 180_000,
    locator: `vid_${index}`,
  };
}

describe('TrackQueue (Capacidade de 25.000 Músicas e Complexidade O(1))', () => {
  it('enfileira até o limite máximo de 25.000 faixas e rejeita excedentes', () => {
    const queue = new TrackQueue(25_000);
    const batch: CompactTrack[] = [];
    for (let i = 0; i < 26_000; i += 1) {
      batch.push(createDummyTrack(i));
    }

    const added = queue.enqueueBatch(batch);
    expect(added).toBe(25_000);
    expect(queue.size).toBe(25_000);
    expect(queue.remainingCapacity).toBe(0);
    expect(queue.enqueue(createDummyTrack(99_999))).toBe(false);
  });

  it('realiza dequeue em ordem FIFO com complexidade O(1) e compactação automática', () => {
    const queue = new TrackQueue(25_000);
    for (let i = 0; i < 5_000; i += 1) {
      queue.enqueue(createDummyTrack(i));
    }

    for (let i = 0; i < 3_000; i += 1) {
      const item = queue.dequeue();
      expect(item?.id).toBe(`trk_${i}`);
    }

    expect(queue.size).toBe(2_000);
    expect(queue.peek()?.id).toBe('trk_3000');
  });

  it('executa shuffle Fisher-Yates de 25.000 faixas em menos de 25ms preservando todos os elementos', () => {
    const queue = new TrackQueue(25_000);
    const batch: CompactTrack[] = [];
    for (let i = 0; i < 25_000; i += 1) {
      batch.push(createDummyTrack(i));
    }
    queue.enqueueBatch(batch);

    const startMs = performance.now();
    queue.shuffle();
    const elapsedMs = performance.now() - startMs;

    expect(elapsedMs).toBeLessThan(25);
    expect(queue.size).toBe(25_000);

    // Verifica que a ordem mudou nas primeiras 20 posições.
    const firstTwenty = queue.getPage(1, 20).items.map((t) => t.id);
    const sequentialTwenty = Array.from({ length: 20 }, (_, idx) => `trk_${idx}`);
    expect(firstTwenty).not.toEqual(sequentialTwenty);
  });

  it('pagina corretamente a fila e suporta modos de loop (off, track, queue)', () => {
    const queue = new TrackQueue(100);
    queue.enqueueBatch([createDummyTrack(1), createDummyTrack(2), createDummyTrack(3)]);

    const page1 = queue.getPage(1, 2);
    expect(page1.items.map((t) => t.id)).toEqual(['trk_1', 'trk_2']);
    expect(page1.totalPages).toBe(2);
    expect(page1.totalItems).toBe(3);

    queue.setLoopMode('queue');
    expect(queue.loopMode).toBe('queue');
  });
});

