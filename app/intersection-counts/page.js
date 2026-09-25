import { Suspense } from 'react';
import SiteHeader from '../components/site-header';
import IntersectionCountsContent from '../components/intersection-counts/IntersectionCountsContent';

export const metadata = {
  title: 'Toronto Intersection Counts',
  description:
    'Every Toronto intersection the City has counted, mapped by how its traffic splits between cars, trucks, buses, people walking and people cycling.',
};

export default function IntersectionCountsPage() {
  return (
    <>
      <SiteHeader current="intersection-counts" />
      <Suspense fallback={
        <div className="min-h-screen flex items-center justify-center" style={{ background: 'var(--paper)' }}>
          <div className="text-xl font-sans">Loading intersection counts…</div>
        </div>
      }>
        <IntersectionCountsContent />
      </Suspense>
    </>
  );
}
