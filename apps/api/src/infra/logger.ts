import pino, { type Logger as PinoLogger } from 'pino';
import type { LogLevel } from '@vaarg/shared';

export type ApiLogger = PinoLogger;

export function createApiLogger(level: LogLevel): ApiLogger {
  return pino({
    level,
    formatters: {
      level: (label) => ({ level: label }),
    },
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        '*.apiKey',
        '*.api_key',
        '*.token',
        '*.password',
      ],
      censor: '[redacted]',
    },
  });
}
