import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

// Opções para execução segura de processos externos (yt-dlp / ffmpeg).
export interface ProcessRunOptions {
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
  readonly maxBytes?: number;
}

/**
 * Executa um binário externo sem interpolação de shell (shell: false) e coleta stdout em memória RAM (Buffer).
 * Usado para carregar os bytes da faixa diretamente na RAM no pré-buffer ou ler metadados curtos.
 */
export async function runProcessToBuffer(
  command: string,
  args: readonly string[],
  options: ProcessRunOptions = {},
): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    if (options.signal?.aborted) {
      reject(new Error('Execução cancelada antes de iniciar o subprocesso.'));
      return;
    }

    const child = spawn(command, [...args], {
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let totalBytes = 0;
    let settled = false;

    const cleanup = (): void => {
      if (timer) clearTimeout(timer);
      options.signal?.removeEventListener('abort', onAbort);
    };

    const killChild = (): void => {
      if (!child.killed) {
        child.kill('SIGKILL');
      }
    };

    const onAbort = (): void => {
      if (settled) return;
      settled = true;
      killChild();
      cleanup();
      reject(new Error('Subprocesso interrompido via AbortSignal.'));
    };

    options.signal?.addEventListener('abort', onAbort, { once: true });

    const timer =
      options.timeoutMs && options.timeoutMs > 0
        ? setTimeout(() => {
            if (settled) return;
            settled = true;
            killChild();
            cleanup();
            reject(new Error(`Subprocesso excedeu o tempo limite de ${options.timeoutMs}ms.`));
          }, options.timeoutMs)
        : undefined;

    child.stdout.on('data', (chunk: Buffer) => {
      totalBytes += chunk.length;
      if (options.maxBytes && totalBytes > options.maxBytes) {
        if (!settled) {
          settled = true;
          killChild();
          cleanup();
          reject(
            new Error(
              `Saída do subprocesso excedeu o limite máximo de ${options.maxBytes} bytes em RAM.`,
            ),
          );
        }
        return;
      }
      stdoutChunks.push(chunk);
    });

    child.stderr.on('data', (chunk: Buffer) => {
      if (stderrChunks.length < 16) {
        stderrChunks.push(chunk);
      }
    });

    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(err);
    });

    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      cleanup();

      if (code === 0) {
        resolve(Buffer.concat(stdoutChunks, totalBytes));
      } else {
        const stderrText = Buffer.concat(stderrChunks).toString('utf-8').trim();
        reject(
          new Error(
            `Subprocesso finalizou com código ${code}${stderrText ? `: ${stderrText}` : ''}`,
          ),
        );
      }
    });
  });
}

/**
 * Executa um binário externo e emite cada linha de stdout de forma assíncrona (NDJSON streaming).
 * Ideal para ingerir playlists de até 25.000 músicas sem bloquear o Event Loop nem acumular texto gigante.
 */
export async function* streamProcessLines(
  command: string,
  args: readonly string[],
  options: ProcessRunOptions = {},
): AsyncGenerator<string, void, undefined> {
  if (options.signal?.aborted) {
    return;
  }

  const child = spawn(command, [...args], {
    shell: false,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'ignore'],
  });

  const killChild = (): void => {
    if (!child.killed) {
      child.kill('SIGKILL');
    }
  };

  const onAbort = (): void => {
    killChild();
  };

  options.signal?.addEventListener('abort', onAbort, { once: true });

  const rl = createInterface({
    input: child.stdout,
    crlfDelay: Number.POSITIVE_INFINITY,
  });

  try {
    for await (const line of rl) {
      if (options.signal?.aborted) {
        killChild();
        break;
      }
      const trimmed = line.trim();
      if (trimmed.length > 0) {
        yield trimmed;
      }
    }
  } finally {
    options.signal?.removeEventListener('abort', onAbort);
    rl.close();
    killChild();
  }
}

