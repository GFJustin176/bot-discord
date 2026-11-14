import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { AUTOPLAY_BLACKLIST_CATEGORIES, type AutoplayBlacklistCategory } from '../queue/track.js';
import { logger } from '../utils/logger.js';

export interface GuildAutoplayStore {
  getAutoplay(guildId: string): boolean;
  setAutoplay(guildId: string, enabled: boolean): void;
  getAutoplayBlacklist(guildId: string): AutoplayBlacklistCategory[];
  setAutoplayBlacklist(guildId: string, categories: readonly AutoplayBlacklistCategory[]): void;
}

interface GuildSettingsRecord {
  autoplay?: boolean;
  autoplayBlacklist?: string[];
}

const DEFAULT_SETTINGS_FILE = path.resolve(process.cwd(), 'data', 'guild-settings.json');
const VALID_CATEGORIES = new Set<string>(AUTOPLAY_BLACKLIST_CATEGORIES);

/**
 * Cria um armazenamento persistente em arquivo JSON para o estado e blacklist do Autoplay por servidor.
 * Inicia com Autoplay desativado (false) e blacklist vazia caso não haja preferência salva.
 */
export function createGuildAutoplayStore(filePath = DEFAULT_SETTINGS_FILE): GuildAutoplayStore {
  let cache: Record<string, GuildSettingsRecord> | undefined;

  const ensureLoaded = (): Record<string, GuildSettingsRecord> => {
    if (cache) {
      return cache;
    }

    try {
      const raw = readFileSync(filePath, 'utf-8');
      const parsed = JSON.parse(raw) as Record<string, GuildSettingsRecord>;
      cache = parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      cache = {};
    }
    return cache;
  };

  const persist = (guildId: string, data: Record<string, GuildSettingsRecord>): void => {
    try {
      mkdirSync(path.dirname(filePath), { recursive: true });
      writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
    } catch (err) {
      logger.warn('GuildSettings', `Falha ao persistir configuração da guild ${guildId}`, {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  };

  return {
    getAutoplay(guildId: string): boolean {
      const data = ensureLoaded();
      return Boolean(data[guildId]?.autoplay);
    },

    setAutoplay(guildId: string, enabled: boolean): void {
      const data = ensureLoaded();
      data[guildId] = { ...data[guildId], autoplay: enabled };
      persist(guildId, data);
    },

    getAutoplayBlacklist(guildId: string): AutoplayBlacklistCategory[] {
      const raw = ensureLoaded()[guildId]?.autoplayBlacklist;
      if (!Array.isArray(raw)) {
        return [];
      }
      return raw.filter((item): item is AutoplayBlacklistCategory => VALID_CATEGORIES.has(item));
    },

    setAutoplayBlacklist(guildId: string, categories: readonly AutoplayBlacklistCategory[]): void {
      const data = ensureLoaded();
      const unique = Array.from(new Set(categories)).filter((item) => VALID_CATEGORIES.has(item));
      data[guildId] = { ...data[guildId], autoplayBlacklist: unique };
      persist(guildId, data);
    },
  };
}

export const defaultGuildAutoplayStore = createGuildAutoplayStore();
