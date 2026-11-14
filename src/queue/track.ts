// Origem de mídia suportada pelo bot.
export type TrackSource = 'youtube' | 'ytmusic' | 'spotify';

// Retorna o nome amigável da origem da música.
export function getSourceLabel(source: TrackSource): string {
  switch (source) {
    case 'ytmusic':
      return 'YouTube Music';
    case 'spotify':
      return 'Spotify';
    default:
      return 'YouTube';
  }
}

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

const BASE_VARIANT_TERMS = [
  'slowed',
  'sped up',
  'nightcore',
  '8d',
  'karaoke',
  'instrumental',
] as const;

const SLOWED_QUALIFIERS = ['ultra', 'super', 'extreme', 'mega'] as const;

export interface VariantMatchRules {
  readonly requiredPatterns: readonly string[];
  readonly excludedPatterns: readonly string[];
}

function hasWholeWord(text: string, term: string): boolean {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`\\b${escaped}\\b`, 'i').test(text);
}

/**
 * Deriva padrões de inclusão e exclusão de variantes (slowed puro vs super/ultra slowed vs normal)
 * a partir do título ou da consulta fornecida.
 */
export function buildVariantMatchRules(queryOrTitle: string): VariantMatchRules {
  const requiredPatterns: string[] = [];
  const excludedPatterns: string[] = [];

  if (hasWholeWord(queryOrTitle, 'slowed')) {
    const requestedQualifiers = SLOWED_QUALIFIERS.filter((q) => hasWholeWord(queryOrTitle, q));
    for (const qualifier of requestedQualifiers) {
      requiredPatterns.push(`\\b${qualifier}\\b`);
    }
    requiredPatterns.push('\\bslowed\\b');

    const otherQualifiers = SLOWED_QUALIFIERS.filter((q) => !requestedQualifiers.includes(q));
    if (otherQualifiers.length > 0) {
      const joined = otherQualifiers.join('|');
      excludedPatterns.push(`\\b(${joined})\\s+slowed\\b`, `\\bslowed[^\\w]+(${joined})\\b`);
    }
  } else {
    excludedPatterns.push('\\bslowed\\b');
  }

  for (const term of BASE_VARIANT_TERMS) {
    if (term === 'slowed' || hasWholeWord(queryOrTitle, term)) {
      continue;
    }
    excludedPatterns.push(`\\b${term}\\b`);
  }

  return { requiredPatterns, excludedPatterns };
}

/**
 * Verifica se o título candidato atende às regras de variante solicitadas.
 */
export function matchesVariantRules(candidateTitle: string, rules: VariantMatchRules): boolean {
  for (const pattern of rules.requiredPatterns) {
    if (!new RegExp(pattern, 'i').test(candidateTitle)) {
      return false;
    }
  }
  for (const pattern of rules.excludedPatterns) {
    if (new RegExp(pattern, 'i').test(candidateTitle)) {
      return false;
    }
  }
  return true;
}
