import type { FastifyRequest } from 'fastify';
import { AppError, REQUEST_ID_SCHEMA } from '@vaarg/shared';

export const REQUEST_ID_HEADER = 'x-request-id';

export function extractRequestId(request: FastifyRequest): string {
  const header = request.headers[REQUEST_ID_HEADER];
  const raw = Array.isArray(header) ? header[0] : header;
  const result = REQUEST_ID_SCHEMA.safeParse(raw);
  if (!result.success) {
    throw AppError.badRequest(
      `${REQUEST_ID_HEADER} header must be a safe string of at least 8 characters`,
    );
  }
  return result.data;
}
