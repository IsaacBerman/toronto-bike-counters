import SiteHeader from '../components/site-header';
import VideoCounterContent from '../components/video-counter/VideoCounterContent';

export const metadata = {
  title: 'Video Traffic Counter',
  description:
    'Count vehicles, bikes and pedestrians crossing a line in your own video. Runs entirely in your browser — nothing is uploaded or stored.',
};

export default function VideoCounterPage() {
  return (
    <>
      <SiteHeader current="video-counter" />
      <VideoCounterContent />
    </>
  );
}
