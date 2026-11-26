import type { FastifyRequest } from 'fastify';
import { AppError } from '@vaarg/shared';

export interface RequestContext {
  requestId: string;
}

export const REQUEST_ID_HEADER = 'x-request-id';

export function extractRequestId(request: FastifyRequest): string {
  const header = request.headers[REQUEST_ID_HEADER];
  const raw = Array.isArray(header) ? header[0] : header;
  if (typeof raw !== 'string' || raw.trim().length < 8) {
    throw AppError.badRequest(`${REQUEST_ID_HEADER} header must be a safe string of at least 8 characters`);
  }
  return raw.trim();
}
