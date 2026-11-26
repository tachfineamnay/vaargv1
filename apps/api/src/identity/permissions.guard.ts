import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { FastifyRequest } from 'fastify';
import type { Permission } from '@vaarg/shared';

export const PERMISSIONS_KEY = 'vaarg:required_permissions';

/** Declares the permissions a route requires (checked server-side only). */
export const RequirePermissions = (...permissions: Permission[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);

/**
 * Purpose/permission guard for merchant routes. Runs after
 * MerchantAuthGuard; the permission set is derived from the server-side
 * role map, never from client input.
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(@Inject(Reflector) private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Permission[] | undefined>(
      PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!required || required.length === 0) return true;
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const merchant = request.vaarg?.merchant;
    if (!merchant) throw new UnauthorizedException();
    const granted = new Set<string>(merchant.permissions);
    const missing = required.filter((permission) => !granted.has(permission));
    if (missing.length > 0) throw new ForbiddenException('Insufficient permissions');
    return true;
  }
}
