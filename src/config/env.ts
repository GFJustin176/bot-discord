import { existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import dotenv from 'dotenv';

dotenv.config();

// Estrutura imutável de configuração validada da aplicação.
export interface AppEnvConfig {
  readonly discordToken: string;
  readonly discordClientId: string;
  readonly discordGuildId?: string;
  readonly commandPrefix: string;
  readonly maxQueueSize: number;
  readonly maxRamBufferBytes: number;
  readonly spotifyClientId?: string;
  readonly spotifyClientSecret?: string;
  readonly spotifyHasCredentials: boolean;
  readonly ytdlpPath: string;
  readonly ffmpegPath: string;
  readonly ytdlpCookieArgs: readonly string[];
}

const DEFAULT_MAX_QUEUE_SIZE = 25_000;
const DEFAULT_MAX_RAM_BUFFER_MB = 25;

// Localiza o caminho do executável priorizando variável de ambiente, caminhos conhecidos do Windows ou PATH global.
function resolveBinaryPath(
  configuredPath: string | undefined,
  knownFallbackPaths: readonly string[],
  defaultCommandName: string,
): string {
  const trimmed = configuredPath?.trim();
  if (trimmed && trimmed.length > 0) {
    return trimmed;
  }

  for (const candidate of knownFallbackPaths) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  return defaultCommandName;
}

// Analisa e valida um dicionário de variáveis de ambiente, aplicando limites seguros.
export function parseEnvConfig(rawEnv: Record<string, string | undefined>): AppEnvConfig {
  const discordToken = rawEnv.DISCORD_TOKEN?.trim();
  if (!discordToken) {
    throw new Error('Variável obrigatória ausente: DISCORD_TOKEN não foi definida no ambiente.');
  }

  const discordClientId = rawEnv.DISCORD_CLIENT_ID?.trim();
  if (!discordClientId) {
    throw new Error(
      'Variável obrigatória ausente: DISCORD_CLIENT_ID não foi definida no ambiente.',
    );
  }

  const discordGuildId = rawEnv.DISCORD_GUILD_ID?.trim() || undefined;
  const commandPrefix = rawEnv.COMMAND_PREFIX?.trim() || '!';

  const parsedMaxQueue = Number.parseInt(rawEnv.MAX_QUEUE_SIZE ?? '', 10);
  const maxQueueSize =
    Number.isFinite(parsedMaxQueue) && parsedMaxQueue > 0 && parsedMaxQueue <= 25_000
      ? parsedMaxQueue
      : DEFAULT_MAX_QUEUE_SIZE;

  const parsedRamMb = Number.parseInt(rawEnv.MAX_RAM_BUFFER_MB ?? '', 10);
  const ramMb =
    Number.isFinite(parsedRamMb) && parsedRamMb >= 5 && parsedRamMb <= 256
      ? parsedRamMb
      : DEFAULT_MAX_RAM_BUFFER_MB;

  const spotifyClientId = rawEnv.SPOTIFY_CLIENT_ID?.trim() || undefined;
  const spotifyClientSecret = rawEnv.SPOTIFY_CLIENT_SECRET?.trim() || undefined;
  const spotifyHasCredentials = Boolean(spotifyClientId && spotifyClientSecret);

  const ytdlpPath = resolveBinaryPath(
    rawEnv.YTDLP_PATH,
    ['c:\\ytdl\\yt-dlp.exe', 'C:\\ytdl\\yt-dlp.exe'],
    'yt-dlp',
  );

  const ffmpegPath = resolveBinaryPath(
    rawEnv.FFMPEG_PATH,
    [
      'D:\\ffmpeg-2026-06-29-git-de6bcf5c05-full_build\\ffmpeg-2026-06-29-git-de6bcf5c05-full_build\\bin\\ffmpeg.exe',
    ],
    'ffmpeg',
  );

  const cookiesCandidate = rawEnv.COOKIES_FILE?.trim() || resolve(process.cwd(), 'cookies.txt');
  let ytdlpCookieArgs: readonly string[] = [];
  try {
    if (existsSync(cookiesCandidate) && statSync(cookiesCandidate).size > 0) {
      ytdlpCookieArgs = ['--cookies', cookiesCandidate];
    }
  } catch {
    ytdlpCookieArgs = [];
  }

  return {
    discordToken,
    discordClientId,
    discordGuildId,
    commandPrefix,
    maxQueueSize,
    maxRamBufferBytes: ramMb * 1024 * 1024,
    spotifyClientId,
    spotifyClientSecret,
    spotifyHasCredentials,
    ytdlpPath,
    ffmpegPath,
    ytdlpCookieArgs,
  };
}

let cachedEnvConfig: AppEnvConfig | undefined;

// Obtém a configuração global carregada a partir de process.env.
export function getEnvConfig(): AppEnvConfig {
  if (!cachedEnvConfig) {
    cachedEnvConfig = parseEnvConfig(process.env);
  }
  return cachedEnvConfig;
}

