import SiteHeader from '../../components/site-header';
import WhereWouldYouLiveApp from '../../components/where-would-you-live/WhereWouldYouLiveApp';
import TilePreconnect from '../../components/downtown-definer/TilePreconnect';
import { cityRobots } from '../../lib/topCities';

function prettifyCity(slug) {
  return slug
    .split('-')
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

export async function generateMetadata({ params }) {
  const { city } = await params;
  const name = prettifyCity(city);
  // Only the most-used cities are indexable (see lib/topCities.js).
  const robots = await cityRobots('live', city);
  const title = `Where would you live in ${name}?`;
  const description = `Map tool for drawing the parts of ${name} you would want to live in, aggregated into a heatmap of everyone's answers.`;
  return {
    title,
    description,
    robots,
    openGraph: {
      title: `${title} — Observing the City`,
      description,
      url: `https://www.observingthecity.ca/where-would-you-live/${city}`,
      siteName: 'Observing the City',
      type: 'website',
    },
    twitter: {
      card: 'summary_large_image',
      title: `${title} — Observing the City`,
      description,
    },
  };
}

export default async function WhereWouldYouLiveCityPage({ params }) {
  const { city } = await params;
  return (
    <>
      <TilePreconnect />
      <SiteHeader current="where-would-you-live" width="max-w-4xl lg:max-w-6xl" />
      <WhereWouldYouLiveApp initialCitySlug={city} />
    </>
  );
}
