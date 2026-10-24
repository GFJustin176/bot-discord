// Logger estruturado minimalista com carimbo de tempo ISO para diagnóstico de áudio e fila.
export const logger = {
  info(context: string, message: string, meta?: Record<string, unknown>): void {
    const suffix = meta ? ` ${JSON.stringify(meta)}` : '';
    console.log(`[${new Date().toISOString()}] [INFO] [${context}] ${message}${suffix}`);
  },

  warn(context: string, message: string, meta?: Record<string, unknown>): void {
    const suffix = meta ? ` ${JSON.stringify(meta)}` : '';
    console.warn(`[${new Date().toISOString()}] [WARN] [${context}] ${message}${suffix}`);
  },

  error(context: string, message: string, error?: unknown): void {
    const detail =
      error instanceof Error ? `${error.message}` : error !== undefined ? String(error) : '';
    console.error(
      `[${new Date().toISOString()}] [ERROR] [${context}] ${message}${detail ? ` | ${detail}` : ''}`,
    );
  },
};

