import type { MetadataRoute } from 'next';
import { siteUrl } from '@/lib/site';

/**
 * Only the three pages a stranger can actually read.
 *
 * Everything else is either behind a login (the dashboard, the builder, the
 * admin panel), a one-time token (reset, verify), or belongs to somebody else's
 * chatbot — `/chat/:id` and `/embed/:id` are per-bot and unbounded, so listing
 * them would be a sitemap that grows with the database and advertises every
 * customer's bot id. Those stay out of here and out of robots.txt's allowance.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const base = siteUrl();
  const lastModified = new Date();
  return [
    { url: base, lastModified, changeFrequency: 'weekly', priority: 1 },
    { url: `${base}/privacy`, lastModified, changeFrequency: 'yearly', priority: 0.3 },
    { url: `${base}/terms`, lastModified, changeFrequency: 'yearly', priority: 0.3 },
  ];
}
