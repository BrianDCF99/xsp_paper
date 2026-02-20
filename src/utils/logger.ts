export interface Logger {
  info(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
  error(msg: string, meta?: Record<string, unknown>): void;
}

function line(level: string, msg: string, meta?: Record<string, unknown>): void {
  const stamp = new Date().toISOString();
  if (!meta || Object.keys(meta).length === 0) {
    console.log(`[${stamp}] [${level}] ${msg}`);
    return;
  }
  console.log(`[${stamp}] [${level}] ${msg} ${JSON.stringify(meta)}`);
}

export const logger: Logger = {
  info: (m, meta) => line("INFO", m, meta),
  warn: (m, meta) => line("WARN", m, meta),
  error: (m, meta) => line("ERROR", m, meta)
};
