import { Suspense } from 'react';
import SiteHeader from '../components/site-header';
import BicycleCountersContent from '../components/bicycle-counters-content';

export const metadata = {
  title: 'Toronto Bicycle Counters',
  description: 'Explore bicycle traffic data from permanent counting stations across Toronto',
};

export default function BikeCountersPage() {
  return (
    <>
      <SiteHeader current="bike-counters" />
      <Suspense fallback={
        <div className="min-h-screen bg-gray-50 flex items-center justify-center">
          <div className="text-xl font-sans ">Loading bicycle counter data...</div>
        </div>
      }>
        <BicycleCountersContent />
      </Suspense>
    </>
  );
}
