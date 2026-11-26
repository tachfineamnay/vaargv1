import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { AppError, type MerchantIdentity } from '@vaarg/shared';

/** Injects the authenticated merchant identity attached by MerchantAuthGuard. */
export const MerchantIdentityParam = createParamDecorator(
  (_data: unknown, context: ExecutionContext): MerchantIdentity => {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const merchant = request.vaarg?.merchant;
    if (!merchant) {
      throw new AppError('unauthorized', 'Authentication required');
    }
    return merchant;
  },
);
