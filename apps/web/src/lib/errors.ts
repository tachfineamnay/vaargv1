/**
 * Storefront error taxonomy (FL04). The API's app error kinds pass through
 * unchanged; the client adds transport-level kinds (network, timeout,
 * invalid_response) and two message-derived states the UI must distinguish:
 * unknown storefront (domain not bound) and not-configured catalog.
 */
export type StorefrontErrorKind =
  | 'network'
  | 'timeout'
  | 'invalid_response'
  | 'invalid_host'
  | 'unknown_storefront'
  | 'not_configured'
  | 'bad_request'
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'unprocessable'
  | 'unavailable'
  | 'internal';

const API_ERROR_KINDS: ReadonlySet<string> = new Set([
  'bad_request',
  'unauthorized',
  'forbidden',
  'not_found',
  'conflict',
  'unprocessable',
  'unavailable',
  'internal',
]);

export class StorefrontError extends Error {
  readonly kind: StorefrontErrorKind;
  readonly status: number | undefined;
  readonly requestId: string | undefined;

  constructor(kind: StorefrontErrorKind, message: string, options: { status?: number; requestId?: string } = {}) {
    super(message);
    this.name = 'StorefrontError';
    this.kind = kind;
    this.status = options.status;
    this.requestId = options.requestId;
  }
}

export function isStorefrontError(value: unknown): value is StorefrontError {
  return value instanceof StorefrontError;
}

/** Wrap any caught value into the storefront taxonomy (never invents detail). */
export function toStorefrontError(value: unknown, fallbackMessage = 'Unexpected storefront error'): StorefrontError {
  if (isStorefrontError(value)) return value;
  if (value instanceof Error && value.message) return new StorefrontError('internal', value.message);
  return new StorefrontError('internal', fallbackMessage);
}

function kindFromStatus(status: number): StorefrontErrorKind {
  switch (status) {
    case 400:
      return 'bad_request';
    case 401:
      return 'unauthorized';
    case 403:
      return 'forbidden';
    case 404:
      return 'not_found';
    case 409:
      return 'conflict';
    case 422:
      return 'unprocessable';
    case 503:
      return 'unavailable';
    default:
      return 'internal';
  }
}

/**
 * Map an upstream error response (status + raw body) into a StorefrontError.
 * Message-derived kinds win over the body kind so `404 Unknown storefront`
 * stays distinguishable from `404 Product not found`.
 */
export function storefrontErrorFromResponse(status: number, bodyText: string, fallbackMessage?: string): StorefrontError {
  let errorBody: { kind?: unknown; message?: unknown; requestId?: unknown } | undefined;
  try {
    const parsed: unknown = JSON.parse(bodyText);
    if (parsed && typeof parsed === 'object' && 'error' in parsed) {
      const inner = (parsed as { error?: unknown }).error;
      if (inner && typeof inner === 'object') errorBody = inner as { kind?: unknown; message?: unknown; requestId?: unknown };
    }
  } catch {
    // Non-JSON body: fall back to status-derived kind below.
  }
  const rawMessage = typeof errorBody?.message === 'string' ? errorBody.message.trim() : '';
  const message = rawMessage || fallbackMessage || `Request failed with HTTP ${status}`;
  const requestId = typeof errorBody?.requestId === 'string' ? errorBody.requestId : undefined;
  let kind: StorefrontErrorKind;
  if (message === 'Unknown storefront') kind = 'unknown_storefront';
  else if (message === 'Catalog provider is not configured') kind = 'not_configured';
  else if (typeof errorBody?.kind === 'string' && API_ERROR_KINDS.has(errorBody.kind)) kind = errorBody.kind as StorefrontErrorKind;
  else kind = kindFromStatus(status);
  return new StorefrontError(kind, message, { status, ...(requestId === undefined ? {} : { requestId }) });
}
