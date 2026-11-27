import SiteHeader from '../components/site-header';
import BicycleCountersContent from '../components/bicycle-counters-content';
import LinkCover from '../components/link-cover';
import { fetchLiveBikeshare } from '../lib/dataUtils';
import bikeshareDaily from '../../public/bikeshare-daily.json';
import cyclingCounts from '../../public/cycling-counts.json';

export const metadata = {
  title: 'Toronto Bicycle Counters',
  description: 'Dashboard of Toronto permanent bicycle counter data and Bike Share ridership.',
  // Shared links (?counter=, ?tab=) are the same page.
  alternates: { canonical: '/bike-counters' },
};

// Rendered with the Bike Share series in its HTML. The live days after the
// City's archive come from bikeraccoon, so the page is rebuilt hourly; the
// browser also refreshes them, so a visitor never sees an older day than before.
export const revalidate = 3600;

// The dropdown's names. Each counter's daily data loads in the browser.
// Counters with no recorded days are left out, as loadCounterSeries does.
const counterList = cyclingCounts.counters
  .filter((c) => c.volumes.some(Boolean))
  .map(({ location }) => ({
    location,
    isOperational: !location.toLowerCase().includes('retired'),
  }));

export default async function BikeCountersPage() {
  const live = await fetchLiveBikeshare(bikeshareDaily.cutoff);
  return (
    <>
      <SiteHeader current="bike-counters" width="max-w-7xl" />
      {/* A link to another counter or tab hides the page until it's
          showing (see link-cover.js). */}
      <LinkCover when="(q.get('counter') && q.get('counter') !== 'Bike Share Toronto') || q.get('tab') || q.get('ward')" />
      <div className="link-cover">
        <BicycleCountersContent archive={bikeshareDaily} live={live} counterList={counterList} />
      </div>
    </>
  );
}
