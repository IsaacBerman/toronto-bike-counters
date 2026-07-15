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

// Largest bbox span (degrees) we'll treat as a "city" when a place is an
// administrative area rather than a tagged city — lets in city-counties /
// city-states / unitary authorities (Brighton and Hove, Kuala Lumpur, Shanghai)
// while excluding real states, provinces and countries, which are far larger.
const CITY_ADMIN_MAX_SPAN_DEG = 1.2;

function bboxSpanDeg(boundingbox) {
  if (!Array.isArray(boundingbox) || boundingbox.length < 4) return Infinity;
  const [south, north, west, east] = boundingbox.map(Number);
  if ([south, north, west, east].some(Number.isNaN)) return Infinity;
  return Math.max(Math.abs(north - south), Math.abs(east - west));
}

function isCityResult(r) {
  if (CITY_TYPES.includes(r.addresstype) || CITY_TYPES.includes(r.type)) return true;
  // A compact administrative area (city-county, unitary authority, city-state).
  return r.type === 'administrative' && bboxSpanDeg(r.boundingbox) <= CITY_ADMIN_MAX_SPAN_DEG;
}

function pickBestResult(results) {
  const withPolygon = results.filter(
    (r) => r.geojson && (r.geojson.type === 'Polygon' || r.geojson.type === 'MultiPolygon')
  );
  if (withPolygon.length === 0) return null;

  const cityLike = withPolygon.find(isCityResult);
  if (cityLike) return cityLike;

  const administrative = withPolygon.find((r) => r.type === 'administrative');
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
    if (!isCityResult(r)) continue;

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

function normalizeMatch(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

// True when a result plausibly belongs to the qualifier the user supplied
// (usually a country, sometimes a state/region): the qualifier must appear in
// the result's display name or one of its address fields. Guards every query
// against Nominatim fuzzy-matching a same-named city somewhere else — e.g.
// "Dunedin, New Zealand" must never resolve to Dunedin, Florida.
function matchesQualifier(result, qualifier) {
  if (!qualifier) return true;
  const needle = normalizeMatch(qualifier);
  if (normalizeMatch(result.display_name).includes(needle)) return true;
  const address = result.address || {};
  return Object.values(address).some(
    (value) => typeof value === 'string' && normalizeMatch(value).includes(needle)
  );
}

async function queryBoundary(q, qualifier) {
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
  const best = pickBestResult(results.filter((r) => matchesQualifier(r, qualifier)));
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
// point with no polygon, so we broaden by dropping the middle part -> "City,
// Country" (which still finds the real municipality). We deliberately DON'T
// broaden to the bare "City": that would cross countries and could return a
// different same-named city with a boundary (e.g. "Brighton" -> Brighton,
// Colorado) — and every query is additionally guarded by matchesQualifier so
// a broadened match can never leave the qualifier the user gave. Some cities
// exist in OSM only as a point node with the boundary under an administrative
// "<Name> City" area (Dunedin, Tauranga and other NZ territorial authorities),
// so that's tried as a last resort — the qualifier guard keeps it in-country.
// If no matching boundary exists, we return null (not addable).
export async function fetchCityBoundary(name) {
  const parts = name.split(',').map((s) => s.trim()).filter(Boolean);
  const qualifier = parts.length >= 2 ? parts[parts.length - 1] : null;
  const candidates = [name];
  if (parts.length >= 3) candidates.push(`${parts[0]}, ${qualifier}`);
  if (qualifier && !/\bcity$/i.test(parts[0])) candidates.push(`${parts[0]} City, ${qualifier}`);

  const tried = new Set();
  try {
    for (const q of candidates) {
      if (tried.has(q)) continue;
      tried.add(q);
      const result = await queryBoundary(q, qualifier);
      if (result) return result;
    }
    return null;
  } catch (error) {
    console.error('Error fetching city boundary:', error);
    return null;
  }
}
