import { Suspense } from 'react';
import SiteHeader from '../components/site-header';
import ElectionsContent from '../components/elections/ElectionsContent';

const DESCRIPTION =
  'Poll-by-poll maps of the 2023 Toronto mayoral by-election and the 2022 city council races: '
  + 'who led each election-day poll, and each candidate’s share of the vote.';

export const metadata = {
  title: 'Toronto Poll-by-Poll Election Results Map',
  description: DESCRIPTION,
  alternates: { canonical: '/elections' },
  openGraph: {
    title: 'Toronto Poll-by-Poll Election Results Map',
    description: DESCRIPTION,
    url: 'https://www.observingthecity.ca/elections',
    siteName: 'Observing the City',
    locale: 'en_CA',
    type: 'website',
  },
};

export default function ElectionsPage() {
  return (
    <>
      <SiteHeader current="elections" />
      <Suspense fallback={
        <div className="min-h-screen flex items-center justify-center" style={{ background: 'var(--paper)' }}>
          <div className="text-xl font-sans">Loading election results…</div>
        </div>
      }>
        <ElectionsContent />
      </Suspense>
    </>
  );
}
