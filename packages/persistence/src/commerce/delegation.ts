import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
const schema = z.strictObject({ host:z.string().min(1).max(260), storeId:z.uuid(), merchantUserId:z.uuid(), sessionId:z.uuid(), jobId:z.uuid(), action:z.enum(['start','step']), expiresAt:z.number().int().positive() });
export type CatalogDelegation = z.infer<typeof schema>;
const secretSchema = z.string().min(32).max(1024);
function validTime(expiresAt: number): boolean { const remaining=expiresAt-Date.now(); return remaining>0 && remaining<=15*60*1000; }
export function issueCatalogDelegation(raw: CatalogDelegation, secret: string): string {
  const claims=schema.parse(raw); secretSchema.parse(secret);
  if (!validTime(claims.expiresAt)) throw new Error('INVALID_DELEGATION_EXPIRY');
  const payload=Buffer.from(JSON.stringify(claims)).toString('base64url');
  const signature=createHmac('sha256',secret).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}
export function verifyCatalogDelegation(ticket: string, secret: string): CatalogDelegation {
  try {
    secretSchema.parse(secret);
    if (ticket.length>4096) throw new Error();
    const parts=ticket.split('.');
    if (parts.length!==2 || !/^[A-Za-z0-9_-]+$/.test(parts[0]!) || !/^[A-Za-z0-9_-]{43}$/.test(parts[1]!)) throw new Error();
    const actual=Buffer.from(parts[1]!, 'base64url');
    const expected=createHmac('sha256',secret).update(parts[0]!).digest();
    if (actual.length!==expected.length || !timingSafeEqual(actual,expected)) throw new Error();
    const claims=schema.parse(JSON.parse(Buffer.from(parts[0]!, 'base64url').toString('utf8')));
    if (!validTime(claims.expiresAt)) throw new Error();
    return claims;
  } catch { throw new Error('UNAUTHORIZED'); }
}
