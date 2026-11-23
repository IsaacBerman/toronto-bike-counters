import SiteHeader from '../components/site-header';
import CouncilBoardsContent from '../components/council-boards/CouncilBoardsContent';

const DESCRIPTION =
  'Who sits on each Toronto City Council committee, board and corporation for the '
  + '2026–2030 term, and how members answered advocacy groups\u2019 election surveys.';

export const metadata = {
  title: 'Council Boards and Committees, 2026–2030',
  description: DESCRIPTION,
};

export default function CouncilBoardsPage() {
  return (
    <>
      <SiteHeader current="council-boards" width="max-w-5xl" />
      <CouncilBoardsContent />
    </>
  );
}
