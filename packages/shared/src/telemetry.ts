import type { LogLevel } from './env.js';

export interface Logger {
  trace(message: string, fields?: Record<string, unknown>): void;
  debug(message: string, fields?: Record<string, unknown>): void;
  info(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
  fatal(message: string, fields?: Record<string, unknown>): void;
}

const LEVEL_ORDER: Record<LogLevel, number> = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  fatal: 60,
  silent: 100,
};

export function createJsonLogger(level: LogLevel): Logger {
  const threshold = LEVEL_ORDER[level];

  const emit = (
    target: 'stdout' | 'stderr',
    targetLevel: keyof typeof LEVEL_ORDER,
    message: string,
    fields?: Record<string, unknown>,
  ): void => {
    if (LEVEL_ORDER[targetLevel] < threshold) {
      return;
    }
    const line = JSON.stringify({
      level: targetLevel,
      message,
      ...(fields ?? {}),
    });
    if (target === 'stderr') {
      process.stderr.write(`${line}\n`);
    } else {
      process.stdout.write(`${line}\n`);
    }
  };

  return {
    trace: (message, fields) => emit('stdout', 'trace', message, fields),
    debug: (message, fields) => emit('stdout', 'debug', message, fields),
    info: (message, fields) => emit('stdout', 'info', message, fields),
    warn: (message, fields) => emit('stdout', 'warn', message, fields),
    error: (message, fields) => emit('stderr', 'error', message, fields),
    fatal: (message, fields) => emit('stderr', 'fatal', message, fields),
  };
}

export function createNoopLogger(): Logger {
  const noop = (): void => undefined;
  return {
    trace: noop,
    debug: noop,
    info: noop,
    warn: noop,
    error: noop,
    fatal: noop,
  };
}
