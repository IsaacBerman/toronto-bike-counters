import { bbox as turfBbox } from '@turf/turf';

export function slugify(name) {
  return name
    .normalize('NFD') // strip accents so "Montréal" and "Montreal" slug the same
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function getUserAgent() {
  // A contact address is always included (Nominatim's policy asks for one and it
  // lowers block risk); override with NOMINATIM_CONTACT_EMAIL if desired.
  const contact = process.env.NOMINATIM_CONTACT_EMAIL || 'observingthecity@gmail.com';
  return `observingthecity.ca DowntownDefiner${contact ? ` (${contact})` : ''}`;
}

// Prefer an actual city/town over larger administrative areas (state, region,
// county) so e.g. "New York" resolves to New York City rather than the state —
// which also lets OSM-id de-duplication collapse "New York" / "New York City".
const CITY_TYPES = ['city', 'town', 'municipality', 'borough', 'village'];

function pickBestResult(results) {
  const withPolygon = results.filter(
    (r) => r.geojson && (r.geojson.type === 'Polygon' || r.geojson.type === 'MultiPolygon')
  );
  if (withPolygon.length === 0) return null;

  const cityLike = withPolygon.find(
    (r) => CITY_TYPES.includes(r.addresstype) || CITY_TYPES.includes(r.type)
  );
  if (cityLike) return cityLike;

  const administrative = withPolygon.find((r) => r.class === 'boundary' && r.type === 'administrative');
  return administrative || withPolygon[0];
}

// Live autocomplete: return city-like matches for a typed query (no geometry),
// so typing "Mexico" surfaces "Ciudad de México" etc. Each suggestion carries a
// concise label and a disambiguated query string to resolve it on selection.
// Throws on a Nominatim/network failure (so the caller can distinguish "OSM is
// down/throttling" from a genuine "no city matches"). Returns [] only when the
// lookup succeeds but nothing city-like matched.
export async function searchCities(query) {
  const params = new URLSearchParams({
    q: query,
    format: 'jsonv2',
    addressdetails: '1',
    'accept-language': 'en', // English names so non-Latin cities (Kyiv, ...) slug correctly
    limit: '10',
  });
  const response = await fetch(`https://nominatim.openstreetmap.org/search?${params}`, {
    headers: { 'User-Agent': getUserAgent() },
  });
  if (!response.ok) throw new Error(`Nominatim search failed: ${response.status}`);

  const results = await response.json();
  const seen = new Set();
  const suggestions = [];

  for (const r of results) {
    const kind = r.addresstype || r.type;
    if (!CITY_TYPES.includes(kind)) continue;

    const key = `${r.osm_type}/${r.osm_id}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const name = r.name || String(r.display_name || '').split(',')[0];
    const addr = r.address || {};
    const region = addr.state && addr.state !== name ? addr.state : addr.country;
    const label = region ? `${name}, ${region}` : name;
    // Don't repeat the name (e.g. state "Shanghai" == name "Shanghai") — an
    // over-qualified query can resolve to a point with no boundary.
    const state = addr.state && addr.state !== name ? addr.state : null;
    const searchQuery = [name, state, addr.country].filter(Boolean).join(', ');

    suggestions.push({ key, label, query: searchQuery, osmId: r.osm_id != null ? String(r.osm_id) : null });
    if (suggestions.length >= 6) break;
  }

  return suggestions;
}

async function queryBoundary(q) {
  const params = new URLSearchParams({
    q,
    format: 'jsonv2',
    polygon_geojson: '1',
    polygon_threshold: '0.005',
    addressdetails: '1',
    'accept-language': 'en',
    limit: '5',
  });
  const response = await fetch(`https://nominatim.openstreetmap.org/search?${params}`, {
    headers: { 'User-Agent': getUserAgent() },
  });
  if (!response.ok) throw new Error(`Nominatim request failed: ${response.status}`);

  const results = await response.json();
  const best = pickBestResult(results);
  if (!best) return null;

  return {
    displayName: best.display_name,
    boundary: best.geojson,
    bbox: turfBbox(best.geojson),
    osmType: best.osm_type || null,
    osmId: best.osm_id != null ? String(best.osm_id) : null,
  };
}

// A very specific query (e.g. "Shanghai, Shanghai, China") can resolve to a
// point with no polygon. Try the given name, then progressively broaden
// ("City, Country", then "City") until one yields an actual boundary.
export async function fetchCityBoundary(name) {
  const parts = name.split(',').map((s) => s.trim()).filter(Boolean);
  const candidates = [name];
  if (parts.length >= 3) candidates.push(`${parts[0]}, ${parts[parts.length - 1]}`);
  if (parts.length >= 2) candidates.push(parts[0]);

  const tried = new Set();
  try {
    for (const q of candidates) {
      if (tried.has(q)) continue;
      tried.add(q);
      const result = await queryBoundary(q);
      if (result) return result;
    }
    return null;
  } catch (error) {
    console.error('Error fetching city boundary:', error);
    return null;
  }
}
