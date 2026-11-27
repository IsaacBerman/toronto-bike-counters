import SiteHeader from '../components/site-header';
import VisionZeroContent from '../components/vision-zero/VisionZeroContent';
// Read at build time and handed to the client component, so the page's HTML
// carries the dashboard's numbers instead of a loading state.
import data from '../../public/vision-zero-ksi.json';

const DESCRIPTION =
  'Toronto traffic deaths and serious injuries since 2006, by road user, ward, age and time, '
  + 'before and after the Vision Zero Road Safety Plan.';

export const metadata = {
  title: 'Toronto Vision Zero Dashboard',
  description: DESCRIPTION,
  alternates: { canonical: '/vision-zero' },
  openGraph: {
    title: 'Toronto Vision Zero Dashboard',
    description: DESCRIPTION,
    url: 'https://www.observingthecity.ca/vision-zero',
    siteName: 'Observing the City',
    locale: 'en_CA',
    type: 'website',
  },
};

export default function VisionZeroPage() {
  return (
    <>
      <SiteHeader current="vision-zero" width="max-w-6xl" />
      <VisionZeroContent data={data} />
    </>
  );
}
