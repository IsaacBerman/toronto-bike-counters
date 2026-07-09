import { bbox as turfBbox } from '@turf/turf';

export function slugify(name) {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function getUserAgent() {
  const contact = process.env.NOMINATIM_CONTACT_EMAIL;
  return `observingthecity.ca DowntownDefiner${contact ? ` (${contact})` : ''}`;
}

function pickBestResult(results) {
  const withPolygon = results.filter(
    (r) => r.geojson && (r.geojson.type === 'Polygon' || r.geojson.type === 'MultiPolygon')
  );
  if (withPolygon.length === 0) return null;

  const administrative = withPolygon.find((r) => r.class === 'boundary' && r.type === 'administrative');
  return administrative || withPolygon[0];
}

export async function fetchCityBoundary(name) {
  try {
    const params = new URLSearchParams({
      q: name,
      format: 'jsonv2',
      polygon_geojson: '1',
      polygon_threshold: '0.005',
      addressdetails: '1',
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
    };
  } catch (error) {
    console.error('Error fetching city boundary:', error);
    return null;
  }
}
