import { Suspense } from 'react';
import SiteHeader from '../components/site-header';
import IntersectionCountsContent from '../components/intersection-counts/IntersectionCountsContent';

export const metadata = {
  title: 'Toronto Intersection Counts',
  description:
    'Map of all intersections in Toronto that have ever had a modal count taken, and charts showing splits over time.',
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
