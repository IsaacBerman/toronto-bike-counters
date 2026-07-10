import SiteHeader from '../../components/site-header';
import DowntownDefinerApp from '../../components/downtown-definer/DowntownDefinerApp';

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
  const title = `Where is Downtown ${name}?`;
  const description = `Draw what you consider "downtown" in ${name} and see how it compares to everyone else's.`;
  return {
    title,
    description,
    openGraph: {
      title: `${title} — Observing the City`,
      description,
      url: `https://www.observingthecity.ca/downtown-definer/${city}`,
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

export default async function DowntownDefinerCityPage({ params }) {
  const { city } = await params;
  return (
    <>
      <SiteHeader current="downtown-definer" />
      <DowntownDefinerApp initialCitySlug={city} />
    </>
  );
}
