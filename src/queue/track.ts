// Origem de mídia suportada pelo bot.
export type TrackSource = 'youtube' | 'ytmusic' | 'spotify';

// Modo de repetição da fila de reprodução.
export type LoopMode = 'off' | 'track' | 'queue';

// Representação compacta de uma faixa para permitir 25.000 itens com consumo mínimo de memória RAM (< 5 MB).
export interface CompactTrack {
  readonly id: string;
  readonly source: TrackSource;
  readonly title: string;
  readonly artist: string;
  readonly durationMs: number;
  // Para YouTube/YT Music armazena a URL ou videoId; para Spotify armazena a query de busca para resolução tardia.
  readonly locator: string;
  readonly webpageUrl?: string;
  readonly requestedBy?: string;
}

// Formata duração em milissegundos para o padrão legível MM:SS ou HH:MM:SS.
export function formatDuration(durationMs: number): string {
  if (!Number.isFinite(durationMs) || durationMs <= 0) {
    return 'Ao vivo / Desconhecido';
  }
  const totalSeconds = Math.floor(durationMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const pad = (n: number): string => n.toString().padStart(2, '0');
  if (hours > 0) {
    return `${hours}:${pad(minutes)}:${pad(seconds)}`;
  }
  return `${minutes}:${pad(seconds)}`;
}

