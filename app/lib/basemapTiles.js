// CARTO now requires an API key on their basemap tiles; without one every tile
// comes back stamped "API KEY REQUIRED" (still HTTP 200, so the map renders —
// it just renders the watermark). The key is free and has no approval queue:
// request one at https://carto.com/basemaps/apikey, then set it as
// NEXT_PUBLIC_CARTO_BASEMAP_KEY. Free tier is 5M tile requests/month and
// requires the CARTO + OpenStreetMap attribution to stay visible.
//
// Next.js inlines NEXT_PUBLIC_* at build time only when referenced literally,
// hence the direct property read rather than a dynamic lookup. Every map in the
// app is client-rendered, so one public var covers all of them.
const KEY = process.env.NEXT_PUBLIC_CARTO_BASEMAP_KEY;

// Query suffix appended to every CARTO tile URL. Empty when unset, which leaves
// the watermarked tiles in place rather than breaking the basemap outright —
// local dev and previews still get a usable (if branded) map.
export const CARTO_KEY_QUERY = KEY ? `?key=${KEY}` : '';

export const CARTO_HOST = 'basemaps.cartocdn.com';

// Leaflet rotates through these to parallelize tile fetches; TilePreconnect
// warms one connection per subdomain.
export const CARTO_SUBDOMAINS = 'abcd';

// Required by the free tier — do not drop this from any tileLayer.
export const CARTO_ATTRIBUTION = '© OpenStreetMap contributors © CARTO';

// Leaflet tile URL template for a CARTO raster style. `style` is the path
// segment after the host, e.g. 'rastertiles/voyager' or 'light_all'.
export function cartoTileUrl(style) {
  return `https://{s}.${CARTO_HOST}/${style}/{z}/{x}/{y}{r}.png${CARTO_KEY_QUERY}`;
}
