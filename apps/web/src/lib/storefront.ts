import { headers } from 'next/headers';
import { parseStorefrontHost, storefrontOrigin } from './host';

export { parseStorefrontHost, storefrontOrigin };

/** Resolve the storefront host for the current request (server components). */
export async function storefrontHost(): Promise<string> {
  const requestHeaders = await headers();
  return parseStorefrontHost(requestHeaders.get('host'), requestHeaders.get('x-forwarded-host'));
}
