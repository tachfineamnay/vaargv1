import type { MetadataRoute } from 'next';
import { absoluteBaseUrl } from '../lib/seo';

export default function robots(): MetadataRoute.Robots {
  const base = absoluteBaseUrl();
  return {
    rules: [{ userAgent: '*', allow: '/', disallow: ['/api/', '/health/ready'] }],
    ...(base ? { sitemap: new URL('/sitemap.xml', base).toString() } : {}),
  };
}
