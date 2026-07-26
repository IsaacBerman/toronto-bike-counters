import TransitMapClient from '../components/transit-live/TransitMapClient';

// In development and unlinked from the rest of the site — keep it out of search
// indexes until it's ready to launch.
export const metadata = {
  title: 'TTC Live (dev)',
  robots: { index: false, follow: false },
};

export default function TransitLivePage() {
  return (
    <main style={{ position: 'fixed', inset: 0 }}>
      <TransitMapClient />
    </main>
  );
}
