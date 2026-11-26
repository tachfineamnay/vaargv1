import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { AppError } from '@vaarg/shared';
import { extractRequestId } from './request-context.js';

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const request = host.switchToHttp().getRequest<FastifyRequest>();
    const reply = host.switchToHttp().getResponse<FastifyReply>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let body: Record<string, unknown> = {
      error: { kind: 'internal', message: 'Internal server error' },
    };

    if (exception instanceof AppError) {
      status = exception.status;
      body = exception.toBody(safeRequestId(request)).error as Record<string, unknown>;
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      const response = exception.getResponse();
      body = {
        error: {
          kind: httpKind(status),
          message:
            typeof response === 'string'
              ? response
              : ((response as { message?: string | string[] }).message ?? exception.message),
        },
      };
    }

    reply.status(status).send(body);
  }
}

function httpKind(status: number): string {
  if (status === 400) return 'bad_request';
  if (status === 401) return 'unauthorized';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'not_found';
  if (status === 409) return 'conflict';
  if (status === 422) return 'unprocessable';
  if (status === 503) return 'unavailable';
  return 'internal';
}

function safeRequestId(request: FastifyRequest): string {
  try {
    return extractRequestId(request);
  } catch {
    return 'unknown';
  }
}
