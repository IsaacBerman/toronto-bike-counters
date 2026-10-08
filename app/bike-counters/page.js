import { Suspense } from 'react';
import SiteHeader from '../components/site-header';
import BicycleCountersContent from '../components/bicycle-counters-content';

export const metadata = {
  title: 'Toronto Bicycle Counters',
  description: 'Dashboard of Toronto permanent bicycle counter data and Bike Share ridership.',
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
