export interface Logger {
  trace(message: string, fields?: Record<string, unknown>): void;
  debug(message: string, fields?: Record<string, unknown>): void;
  info(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
  fatal(message: string, fields?: Record<string, unknown>): void;
}

export interface JsonLoggerOptions {
  level: 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';
}

const LEVEL_ORDER: Record<JsonLoggerOptions['level'], number> = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  fatal: 60,
};

export function createJsonLogger(options: JsonLoggerOptions): Logger {
  const threshold = LEVEL_ORDER[options.level];

  const emit = (
    level: keyof typeof LEVEL_ORDER,
    message: string,
    fields?: Record<string, unknown>,
  ): void => {
    if (LEVEL_ORDER[level] < threshold) {
      return;
    }
    const line = JSON.stringify({
      level,
      message,
      ...(fields ?? {}),
    });
    if (level === 'error' || level === 'fatal') {
      process.stderr.write(`${line}\n`);
    } else {
      process.stdout.write(`${line}\n`);
    }
  };

  return {
    trace: emit.bind(null, 'trace'),
    debug: emit.bind(null, 'debug'),
    info: emit.bind(null, 'info'),
    warn: emit.bind(null, 'warn'),
    error: emit.bind(null, 'error'),
    fatal: emit.bind(null, 'fatal'),
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
