import { getLatestDay } from './lib/slow-zones/db';
import visionZero from '../public/vision-zero-ksi.json';
import tmc from '../public/tmc-counts.json';
import modeShare from '../public/tts/mode-share.json';
import mayor2026 from '../public/elections/mayor-2026.json';

const SITE = 'https://www.observingthecity.ca';

// Rebuilt daily so the Slow Zones and Bike Share dates keep up.
export const revalidate = 86400;

// The day before today in Toronto: the last full day of live Bike Share data.
function yesterdayInToronto() {
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Toronto' });
  const d = new Date(`${today}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

async function slowZonesDay() {
  try {
    return await getLatestDay();
  } catch (error) {
    console.error('Sitemap: slow-zone date unavailable:', error);
    return null;
  }
}

// Tools first: these are the pages worth finding in search. The dynamic
// /downtown-definer/[city] routes are left out deliberately, since they are
// generated per submission rather than being pages we want indexed.
//
// `lastModified` is when a page's data last changed, so search engines can
// trust it. Pages without data that changes on a schedule leave it out: a
// date that is always "today" teaches Google to ignore it.
export default async function sitemap() {
  const routes = [
    { path: '', priority: 1, changeFrequency: 'weekly' },
    { path: '/slow-zones', priority: 0.9, changeFrequency: 'daily', lastModified: await slowZonesDay() },
    { path: '/vision-zero', priority: 0.9, changeFrequency: 'weekly', lastModified: visionZero.builtAt },
    { path: '/bike-counters', priority: 0.9, changeFrequency: 'daily', lastModified: yesterdayInToronto() },
    { path: '/intersection-counts', priority: 0.8, changeFrequency: 'monthly', lastModified: tmc.generated },
    { path: '/elections', priority: 0.9, changeFrequency: 'daily', lastModified: mayor2026.generated },
    { path: '/transform-toronto', priority: 0.8, changeFrequency: 'monthly', lastModified: modeShare.meta.generated },
    { path: '/council-boards', priority: 0.7, changeFrequency: 'monthly' },
    { path: '/downtown-definer', priority: 0.8, changeFrequency: 'weekly' },
    { path: '/where-would-you-live', priority: 0.8, changeFrequency: 'weekly' },
    { path: '/video-counter', priority: 0.8, changeFrequency: 'monthly' },
    { path: '/about', priority: 0.4, changeFrequency: 'yearly' },
    { path: '/contact', priority: 0.4, changeFrequency: 'yearly' },
    { path: '/privacy', priority: 0.2, changeFrequency: 'yearly' },
  ];
  return routes.map(({ path, priority, changeFrequency, lastModified }) => ({
    url: `${SITE}${path}`,
    ...(lastModified ? { lastModified } : {}),
    changeFrequency,
    priority,
  }));
}
