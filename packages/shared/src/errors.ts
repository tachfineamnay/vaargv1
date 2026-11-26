export type AppErrorKind =
  | 'bad_request'
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'unprocessable'
  | 'unavailable'
  | 'internal';

export interface AppErrorBody {
  error: {
    kind: AppErrorKind;
    message: string;
    details?: unknown;
    requestId: string;
  };
}

export class AppError extends Error {
  readonly kind: AppErrorKind;
  readonly status: number;
  readonly details?: unknown;

  constructor(kind: AppErrorKind, message: string, details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.kind = kind;
    this.details = details;
    this.status = statusForKind(kind);
    Object.setPrototypeOf(this, AppError.prototype);
  }

  toBody(requestId: string): AppErrorBody {
    return {
      error: {
        kind: this.kind,
        message: this.message,
        ...(this.details === undefined ? {} : { details: this.details }),
        requestId,
      },
    };
  }

  static badRequest(message: string, details?: unknown): AppError {
    return new AppError('bad_request', message, details);
  }

  static unauthorized(message = 'Authentication required'): AppError {
    return new AppError('unauthorized', message);
  }

  static forbidden(message = 'Not permitted'): AppError {
    return new AppError('forbidden', message);
  }

  static notFound(message = 'Resource not found'): AppError {
    return new AppError('not_found', message);
  }

  static conflict(message: string, details?: unknown): AppError {
    return new AppError('conflict', message, details);
  }

  static unprocessable(message: string, details?: unknown): AppError {
    return new AppError('unprocessable', message, details);
  }

  static unavailable(message: string, details?: unknown): AppError {
    return new AppError('unavailable', message, details);
  }
}

export function statusForKind(kind: AppErrorKind): number {
  switch (kind) {
    case 'bad_request':
      return 400;
    case 'unauthorized':
      return 401;
    case 'forbidden':
      return 403;
    case 'not_found':
      return 404;
    case 'conflict':
      return 409;
    case 'unprocessable':
      return 422;
    case 'unavailable':
      return 503;
    case 'internal':
    default:
      return 500;
  }
}
