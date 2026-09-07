import type { MetadataRoute } from 'next';
import { siteUrl } from '@/lib/site';

/**
 * Crawlers get the marketing page and the two legal pages, and nothing else.
 *
 * The disallow list is not a security control — the routes it names are all
 * guarded server-side, and a crawler that ignores this file gets the same 401
 * or 404 as anyone else. It is here so that search results do not fill up with
 * login walls and empty dashboards, and so `/embed/` widgets stop being indexed
 * as if they were pages of this site.
 */
export default function robots(): MetadataRoute.Robots {
  const base = siteUrl();
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: ['/api/', '/admin', '/account', '/bots', '/create', '/embed/', '/reset', '/verify'],
      },
    ],
    sitemap: `${base}/sitemap.xml`,
    host: base,
  };
}
