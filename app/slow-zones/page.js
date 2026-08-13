import SiteHeader from '../components/site-header';
import SlowZonesContent from '../components/slow-zones/SlowZonesContent';

export const metadata = {
  title: 'TTC Slow Zones'
};

export default function SlowZonesPage() {
  return (
    <>
      <SiteHeader current="slow-zones" />
      <SlowZonesContent />
    </>
  );
}
