import SiteHeader from '../components/site-header';
import IntersectionCountsContent from '../components/intersection-counts/IntersectionCountsContent';
import tmc from '../../public/tmc-counts.json';

// What the page shows before the full file arrives in the browser: the default
// intersection and the dataset totals. Built at build time, so the page's HTML
// has real content without carrying all 2.4 MB.
const preview = {
  intersections: tmc.intersections.slice(0, 1),
  totalCounts: tmc.intersections.reduce((s, i) => s + i.counts.length, 0),
  intersectionCount: tmc.intersections.length,
  latestYear: tmc.intersections[0]?.counts[0][0].slice(0, 4),
  peakWindow: tmc.peakWindow,
};

export const metadata = {
  title: 'Toronto Intersection Counts',
  description:
    'Map of all intersections in Toronto that have ever had a modal count taken, and charts showing splits over time.',
};

export default function IntersectionCountsPage() {
  return (
    <>
      <SiteHeader current="intersection-counts" width="max-w-7xl" />
      <IntersectionCountsContent preview={preview} />
    </>
  );
}
