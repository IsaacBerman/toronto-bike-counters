import SiteHeader from '../components/site-header';
import DowntownDefinerApp from '../components/downtown-definer/DowntownDefinerApp';

export const metadata = {
  title: 'DowntownDefiner',
  description: 'Draw what you consider "downtown" for a city and see how it compares to everyone else\'s',
};

export default function DowntownDefinerPage() {
  return (
    <>
      <SiteHeader current="downtown-definer" />
      <DowntownDefinerApp />
    </>
  );
}
