import SiteHeader from '../components/site-header';
import CouncilBoardsContent from '../components/council-boards/CouncilBoardsContent';

const DESCRIPTION =
  'Who sits on each Toronto City Council committee, board and corporation for the '
  + '2026–2030 term, and how members answered the TTCriders and Cycle Toronto surveys.';

// Standalone: not in site-header's nav or sitemap.js. Reached by link only.
// To publish it: add a sitemap entry and add it to PAGES in
// app/components/site-header.js.
export const metadata = {
  title: 'Council Boards and Committees, 2026–2030',
  description: DESCRIPTION,
};

export default function CouncilBoardsPage() {
  return (
    <>
      <SiteHeader />
      <CouncilBoardsContent />
    </>
  );
}
