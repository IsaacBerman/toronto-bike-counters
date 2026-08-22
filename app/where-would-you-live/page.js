import SiteHeader from '../components/site-header';
import WhereWouldYouLiveApp from '../components/where-would-you-live/WhereWouldYouLiveApp';
import TilePreconnect from '../components/downtown-definer/TilePreconnect';

export const metadata = {
  title: 'Where Would You Live?',
  description:
    'Map tool for drawing the parts of a city you would want to live in, aggregated into a heatmap of everyone’s answers.',
  openGraph: {
    title: 'Where Would You Live? — Observing the City',
    description:
      'Map tool for drawing the parts of a city you would want to live in, aggregated into a heatmap of everyone’s answers.',
    url: 'https://www.observingthecity.ca/where-would-you-live',
    siteName: 'Observing the City',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Where Would You Live? — Observing the City',
    description:
      'Map tool for drawing the parts of a city you would want to live in, aggregated into a heatmap of everyone’s answers.',
  },
};

export default function WhereWouldYouLivePage() {
  return (
    <>
      <TilePreconnect />
      <SiteHeader current="where-would-you-live" />
      <WhereWouldYouLiveApp />
    </>
  );
}
