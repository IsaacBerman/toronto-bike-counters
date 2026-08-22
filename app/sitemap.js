const SITE = 'https://www.observingthecity.ca';

// Tools first: these are the pages worth finding in search. The dynamic
// /downtown-definer/[city] routes are left out deliberately, since they are
// generated per submission rather than being pages we want indexed.
const ROUTES = [
  { path: '', priority: 1, changeFrequency: 'weekly' },
  { path: '/slow-zones', priority: 0.9, changeFrequency: 'daily' },
  { path: '/bike-counters', priority: 0.9, changeFrequency: 'daily' },
  { path: '/transform-toronto', priority: 0.8, changeFrequency: 'monthly' },
  { path: '/downtown-definer', priority: 0.8, changeFrequency: 'weekly' },
  { path: '/where-would-you-live', priority: 0.8, changeFrequency: 'weekly' },
  { path: '/video-counter', priority: 0.8, changeFrequency: 'monthly' },
  { path: '/about', priority: 0.4, changeFrequency: 'yearly' },
  { path: '/contact', priority: 0.4, changeFrequency: 'yearly' },
  { path: '/privacy', priority: 0.2, changeFrequency: 'yearly' },
];

export default function sitemap() {
  const lastModified = new Date();
  return ROUTES.map(({ path, priority, changeFrequency }) => ({
    url: `${SITE}${path}`,
    lastModified,
    changeFrequency,
    priority,
  }));
}
