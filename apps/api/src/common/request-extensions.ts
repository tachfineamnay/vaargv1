import type { MerchantIdentity, TenantContext, VisitorSession } from '@vaarg/shared';

/**
 * Request-scoped VAARG state attached by the tenant resolver and auth
 * guards. Kept off URLs and logs; consumed through typed param decorators.
 */
declare module 'fastify' {
  interface FastifyRequest {
    vaarg?: {
      tenant?: TenantContext;
      merchant?: MerchantIdentity;
      visitor?: VisitorSession;
    };
  }
}

export {};
