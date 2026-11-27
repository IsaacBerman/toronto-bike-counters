import SiteHeader from '../components/site-header';
import SlowZonesContent from '../components/slow-zones/SlowZonesContent';
import { getHistory } from '../lib/slow-zones/db';

// Rendered with the zone history in its HTML. The ingest route revalidates
// this path after each snapshot, so the DB is read about twice a day; the
// timer is only a backstop in case a revalidation is missed.
export const revalidate = 43200;

async function loadHistory() {
  try {
    return await getHistory();
  } catch (error) {
    console.error('Slow-zone history unavailable at render; client will fetch:', error);
    return null;
  }
}

const URL = 'https://www.observingthecity.ca/slow-zones';
const TTC_SOURCE = 'https://www.ttc.ca/riding-the-ttc/Updates/Reduced-Speed-Zones';

// "Reduced speed zone" is the TTC's own term and what people search for;
// "slow zone" is what everyone calls them. Both need to appear, and the
// official one has to lead.
const DESCRIPTION =
  'Daily tracking of TTC subway reduced speed zones (slow zones), the delay each one adds, '
  + 'and when the TTC expects to remove them.';

export const metadata = {
  title: 'TTC Reduced Speed Zones (Slow Zones) Tracker',
  description: DESCRIPTION,
  keywords: [
    'TTC reduced speed zones',
    'TTC slow zones',
    'reduced speed zones TTC',
    'Toronto subway slow zones',
    'TTC subway delays',
    'TTC speed restrictions',
    'Line 1 slow zones',
    'Line 2 slow zones',
  ],
  alternates: { canonical: '/slow-zones' },
  openGraph: {
    title: 'TTC Reduced Speed Zones (Slow Zones) Tracker',
    description: DESCRIPTION,
    url: URL,
    siteName: 'Observing the City',
    locale: 'en_CA',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'TTC Reduced Speed Zones (Slow Zones) Tracker',
    description: DESCRIPTION,
  },
};

// Dataset markup is what makes a daily-updated public dataset eligible for
// Google Dataset Search as well as ordinary results.
const structuredData = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'Dataset',
      name: 'TTC Reduced Speed Zones',
      alternateName: 'TTC Slow Zones',
      description: DESCRIPTION,
      url: URL,
      keywords: ['TTC', 'reduced speed zones', 'slow zones', 'Toronto subway', 'public transit'],
      isAccessibleForFree: true,
      license: 'https://creativecommons.org/licenses/by/4.0/',
      creator: {
        '@type': 'Organization',
        name: 'Observing the City',
        url: 'https://www.observingthecity.ca',
      },
      spatialCoverage: {
        '@type': 'Place',
        name: 'Toronto, Ontario, Canada',
      },
      isBasedOn: TTC_SOURCE,
    },
    {
      '@type': 'BreadcrumbList',
      itemListElement: [
        {
          '@type': 'ListItem',
          position: 1,
          name: 'Observing the City',
          item: 'https://www.observingthecity.ca',
        },
        {
          '@type': 'ListItem',
          position: 2,
          name: 'TTC Reduced Speed Zones',
          item: URL,
        },
      ],
    },
  ],
};

export default async function SlowZonesPage() {
  const history = await loadHistory();
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
      />
      <SiteHeader current="slow-zones" width="max-w-5xl" />
      <SlowZonesContent initialHistory={history} />
    </>
  );
}
