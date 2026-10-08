import SiteHeader from '../components/site-header';
import MayorForecastContent from '../components/mayor-forecast/MayorForecastContent';

const DESCRIPTION =
  'Projection of the 2026 Toronto mayoral election from public polls, adjusted for each '
  + 'pollster\u2019s house effect.';

// Deliberately unlisted: not in site-header's nav, not in sitemap.js, and
// noindex here. It is a working model with assumptions that need the page's
// own caveats alongside them, so it should be reached by someone who was sent
// the link rather than by someone who landed on it from a search result.
// To publish it: drop `robots` below, add a sitemap entry, add it to PAGES in
// app/components/site-header.js.
export const metadata = {
  title: '2026 Toronto Mayoral Projection',
  description: DESCRIPTION,
  robots: { index: false, follow: false },
};

export default function MayorForecastPage() {
  return (
    <>
      <SiteHeader />
      <MayorForecastContent />
    </>
  );
}
