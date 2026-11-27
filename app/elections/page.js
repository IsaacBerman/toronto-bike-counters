import SiteHeader from '../components/site-header';
import ElectionsContent from '../components/elections/ElectionsContent';
import mayor2026 from '../../public/elections/mayor-2026.json';
import wards from '../../public/elections/wards.json';
import needleBaseline from '../../public/elections/needle-baseline.json';
import night2026 from '../../public/elections/night-2026.json';

// The default race's results and the needle's files, built into the page so
// its HTML has the results in it. Poll and ward shapes are dropped (only the
// map draws them, and it fetches the full files), which keeps the page small;
// `partial` tells the client to still fetch those files.
const preview = {
  'mayor-2026': {
    ...mayor2026,
    partial: true,
    wardOutlines: null,
    polls: {
      ...mayor2026.polls,
      features: mayor2026.polls.features.map((f) => ({ ...f, geometry: null })),
    },
  },
  wards: { ...wards, partial: true, wardOutlines: null },
  'needle-baseline': needleBaseline,
  'night-2026': night2026,
};

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
      <SiteHeader current="elections" width="max-w-7xl" />
      <ElectionsContent preview={preview} />
    </>
  );
}
