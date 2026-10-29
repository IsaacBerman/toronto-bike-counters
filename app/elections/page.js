import { Suspense } from 'react';
import SiteHeader from '../components/site-header';
import ElectionsContent from '../components/elections/ElectionsContent';

const TITLE = '2026 Toronto Election Results: Mayor and Council Map, Poll by Poll';
const DESCRIPTION =
  'Official 2026 Toronto mayor and council results, poll by poll and ward by ward: vote share, swing from 2023, '
  + 'turnout and advance and mail-in votes. Plus every mayor and council race since 2006.';

export const metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: '/elections' },
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    url: 'https://www.observingthecity.ca/elections',
    siteName: 'Observing the City',
    locale: 'en_CA',
    type: 'website',
  },
  twitter: { card: 'summary_large_image', title: TITLE, description: DESCRIPTION },
};

export default function ElectionsPage() {
  return (
    <>
      <SiteHeader current="elections" />
      {/* The results are drawn in the browser; until then (and for crawlers
          and link previews that don't run scripts) this says what the page is. */}
      <Suspense fallback={
        <div className="min-h-screen pt-4 pb-10" style={{ background: 'var(--paper)' }}>
          <div className="container mx-auto px-4 max-w-7xl">
            <h1 className="dd-title text-4xl sm:text-5xl mb-2" style={{ color: 'var(--ink)' }}>
              2026 Toronto Election Results
            </h1>
            <p className="max-w-2xl" style={{ color: 'var(--ink-2)' }}>
              Official results for the 2026 Toronto mayor and council races, poll by poll and ward by ward,
              with vote share, swing from 2023, turnout, and advance and mail-in votes. Plus every mayor and
              council race since 2006.
            </p>
            <p className="mt-6 text-xl font-sans" style={{ color: 'var(--ink-3)' }}>Loading election results…</p>
          </div>
        </div>
      }>
        <ElectionsContent />
      </Suspense>
    </>
  );
}
