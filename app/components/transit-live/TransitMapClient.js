'use client';

import dynamic from 'next/dynamic';

// Client-only wrapper: MapLibre + deck.gl need the browser (WebGL, window),
// so we defer loading until the client. `ssr: false` is only allowed inside a
// Client Component, which is why this indirection exists.
const TransitMap = dynamic(() => import('./TransitMap'), {
  ssr: false,
  loading: () => (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#111114',
        color: '#fff',
        font: '15px system-ui, sans-serif',
      }}
    >
      Loading live map…
    </div>
  ),
});

export default function TransitMapClient() {
  return <TransitMap />;
}
