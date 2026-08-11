import SlowZonesContent from '../components/slow-zones/SlowZonesContent';

export const metadata = {
  title: 'TTC Slow Zones',
  description:
    'Daily tracking of TTC subway reduced speed zones — where trains are slowed, by how much, and how the slow zones change over time.',
};

export default function SlowZonesPage() {
  return <SlowZonesContent />;
}
