import SiteHeader from '../components/site-header';
import DowntownDefinerApp from '../components/downtown-definer/DowntownDefinerApp';
import TilePreconnect from '../components/downtown-definer/TilePreconnect';

export const metadata = {
  title: 'Where is Downtown?',
  description: 'Map tool for drawing your definition of downtown, aggregated into a heatmap of all submissions.',
  openGraph: {
    title: 'Where is Downtown? — Observing the City',
    description: 'Map tool for drawing your definition of downtown, aggregated into a heatmap of all submissions.',
    url: 'https://www.observingthecity.ca/downtown-definer',
    siteName: 'Observing the City',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Where is Downtown? — Observing the City',
    description: 'Map tool for drawing your definition of downtown, aggregated into a heatmap of all submissions.',
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
