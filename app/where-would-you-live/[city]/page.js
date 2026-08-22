import SiteHeader from '../../components/site-header';
import WhereWouldYouLiveApp from '../../components/where-would-you-live/WhereWouldYouLiveApp';
import TilePreconnect from '../../components/downtown-definer/TilePreconnect';

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
  const title = `Where would you live in ${name}?`;
  const description = `Draw the parts of ${name} you'd actually want to live in, and see where everyone else would.`;
  return {
    title,
    description,
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
      <SiteHeader current="where-would-you-live" />
      <WhereWouldYouLiveApp initialCitySlug={city} />
    </>
  );
}
