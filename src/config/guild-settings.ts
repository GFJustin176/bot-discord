import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { logger } from '../utils/logger.js';

export interface GuildAutoplayStore {
  getAutoplay(guildId: string): boolean;
  setAutoplay(guildId: string, enabled: boolean): void;
}

const DEFAULT_SETTINGS_FILE = path.resolve(process.cwd(), 'data', 'guild-settings.json');

/**
 * Cria um armazenamento persistente em arquivo JSON para o estado do Autoplay por servidor.
 * Inicia desativado (false) caso o servidor ainda não possua preferência registrada.
 */
export function createGuildAutoplayStore(filePath = DEFAULT_SETTINGS_FILE): GuildAutoplayStore {
  let cache: Record<string, { autoplay?: boolean }> | undefined;

  const ensureLoaded = (): Record<string, { autoplay?: boolean }> => {
    if (cache) {
      return cache;
    }

    try {
      const raw = readFileSync(filePath, 'utf-8');
      const parsed = JSON.parse(raw) as Record<string, { autoplay?: boolean }>;
      cache = parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      cache = {};
    }
    return cache;
  };

  return {
    getAutoplay(guildId: string): boolean {
      const data = ensureLoaded();
      return Boolean(data[guildId]?.autoplay);
    },

    setAutoplay(guildId: string, enabled: boolean): void {
      const data = ensureLoaded();
      data[guildId] = { ...data[guildId], autoplay: enabled };

      try {
        mkdirSync(path.dirname(filePath), { recursive: true });
        writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
      } catch (err) {
        logger.warn('GuildSettings', `Falha ao persistir configuração da guild ${guildId}`, {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    },
  };
}

export const defaultGuildAutoplayStore = createGuildAutoplayStore();
