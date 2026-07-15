// Preconnect hints for the map tile CDN, rendered by the downtown-definer
// pages so they land in the SSR <head> (React 19 hoists them). Warming
// DNS/TLS before any Leaflet map mounts means tiles start downloading
// immediately instead of paying connection setup during the empty-container
// moment. One hint per subdomain Leaflet rotates through.
export default function TilePreconnect() {
  return (
    <>
      {['a', 'b', 'c', 'd'].map((s) => (
        <link key={s} rel="preconnect" href={`https://${s}.basemaps.cartocdn.com`} />
      ))}
    </>
  );
}
