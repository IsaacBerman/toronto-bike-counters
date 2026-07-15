import SiteHeader from '../components/site-header';
import DowntownDefinerApp from '../components/downtown-definer/DowntownDefinerApp';
import TilePreconnect from '../components/downtown-definer/TilePreconnect';

export const metadata = {
  title: 'Where is Downtown?',
  description: 'Draw what you consider "downtown" for a city and see how it compares to everyone else\'s.',
  openGraph: {
    title: 'Where is Downtown? — Observing the City',
    description: 'Draw the boundary of what you call "downtown" and watch it merge into a crowd heatmap.',
    url: 'https://www.observingthecity.ca/downtown-definer',
    siteName: 'Observing the City',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Where is Downtown? — Observing the City',
    description: 'Draw the boundary of what you call "downtown" and watch it merge into a crowd heatmap.',
  },
};

export default function DowntownDefinerPage() {
  return (
    <>
      <TilePreconnect />
      <SiteHeader current="downtown-definer" />
      <DowntownDefinerApp />
    </>
  );
}
