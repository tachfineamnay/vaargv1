import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { AppError, type TenantContext } from '@vaarg/shared';

/** Injects the verified tenant context attached by MerchantAuthGuard/resolvers. */
export const TenantContextParam = createParamDecorator(
  (_data: unknown, context: ExecutionContext): TenantContext => {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const tenant = request.vaarg?.tenant;
    if (!tenant) {
      throw new AppError('internal', 'Tenant context was not resolved for this request');
    }
    return tenant;
  },
);
