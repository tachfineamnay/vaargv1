import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { issueCatalogDelegation, verifyCatalogDelegation } from '../src/commerce/delegation.js';
const secret='synthetic-signing-secret-at-least-32-bytes';
const claims={host:'synthetic.example',storeId:randomUUID(),merchantUserId:randomUUID(),sessionId:randomUUID(),jobId:randomUUID(),action:'step' as const,expiresAt:Date.now()+60000};
describe('catalog job delegation', () => {
  it('verifies an expiring store and job bound delegation and rejects tampering', () => {
    const ticket=issueCatalogDelegation(claims,secret);
    expect(verifyCatalogDelegation(ticket,secret)).toEqual(claims);
    expect(() => verifyCatalogDelegation(`${ticket}x`,secret)).toThrow('UNAUTHORIZED');
    expect(() => verifyCatalogDelegation(ticket,'wrong-secret-at-least-32-characters')).toThrow('UNAUTHORIZED');
    expect(() => issueCatalogDelegation({...claims,expiresAt:Date.now()-1},secret)).toThrow();
  });
});
