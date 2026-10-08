import SiteHeader from '../components/site-header';
import TravelExplorer from '../components/toronto-travel/TravelExplorer';

export const metadata = {
  title: 'TransformTO Tracking — Travel Modes by Ward',
  description:
    'Toronto travel mode share by ward, trip distance and year from the Transportation Tomorrow Survey, compared with the TransformTO goal of 75% of work and school trips under 5 km by walking, cycling or transit by 2030.',
};

export default function TransformTorontoPage() {
  return (
    <>
      <SiteHeader current="transform-toronto" />
      <TravelExplorer />
    </>
  );
}
