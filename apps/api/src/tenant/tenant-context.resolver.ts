import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { TenantContext } from '@vaarg/shared';
import type { StorefrontBinding } from '@vaarg/persistence';
import {
  TenantResolutionError,
  createDb,
  resolveStorefront,
  resolveTenantContext,
} from '@vaarg/persistence';
import { DatabaseClient } from '../infra/database-client.js';

/**
 * API-side tenant boundary: turns a raw Host header plus correlation id
 * into a verified TenantContext, or a structured HTTP error. Storefront
 * bindings are operator configuration; store state is verified in
 * PostgreSQL under the restricted runtime role with RLS enforced.
 */
@Injectable()
export class TenantContextResolver {
  constructor(
    @Inject(DatabaseClient) private readonly database: DatabaseClient,
    @Inject('STOREFRONT_BINDINGS') private readonly bindings: StorefrontBinding[],
  ) {}

  /** Host-only identification without a database round trip. */
  identify(host: unknown): StorefrontBinding | null {
    return resolveStorefront(this.bindings, host);
  }

  async resolve(host: unknown, correlationId: unknown): Promise<TenantContext> {
    try {
      return await resolveTenantContext(
        createDb(this.database.getPool()),
        this.bindings,
        { host, correlationId },
      );
    } catch (error) {
      throw mapTenantError(error);
    }
  }
}

function mapTenantError(error: unknown): unknown {
  if (!(error instanceof TenantResolutionError)) return error;
  switch (error.code) {
    case 'UNKNOWN_HOST':
    case 'STORE_MISSING':
      return new NotFoundException('Unknown storefront');
    case 'STORE_INACTIVE':
      return new ForbiddenException('Storefront unavailable');
    case 'INVALID_CORRELATION_ID':
      return new BadRequestException('Invalid correlation id');
    default:
      return error;
  }
}
