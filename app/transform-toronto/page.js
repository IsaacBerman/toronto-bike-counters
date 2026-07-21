import SiteHeader from '../components/site-header';
import TravelExplorer from '../components/toronto-travel/TravelExplorer';

export const metadata = {
  title: 'Transform Toronto Tracking — Travel Modes by Ward',
  description:
    'Track Toronto transportation mode share by ward, trip distance and year from the Transportation Tomorrow Survey, and progress toward the TransformTO 2030 goal of 75% of work and school trips by walking, cycling or transit.',
};

export default function TransformTorontoPage() {
  return (
    <>
      <SiteHeader current="transform-toronto" />
      <TravelExplorer />
    </>
  );
}
