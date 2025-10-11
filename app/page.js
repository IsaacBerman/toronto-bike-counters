import { Suspense } from 'react';
import BicycleCountersContent from './components/bicycle-counters-content';

export default function Home() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-xl font-sans">Loading bicycle counter data...</div>
      </div>
    }>
      <BicycleCountersContent />
    </Suspense>
  );
}