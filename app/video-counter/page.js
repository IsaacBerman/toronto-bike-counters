import SiteHeader from '../components/site-header';
import VideoCounterContent from '../components/video-counter/VideoCounterContent';

export const metadata = {
  title: 'Video Traffic Counter',
  description:
    'Upload a street video, draw a counting line, and tally the vehicles, bikes and pedestrians that cross it.',
};

export default function VideoCounterPage() {
  return (
    <>
      <SiteHeader current="video-counter" />
      <VideoCounterContent />
    </>
  );
}
