'use client';

// Client-side helpers for the shared city list. Both map tools ("Where is
// Downtown?" and "Where would you live?") read and write the same `cities`
// table, so they also share these endpoints: a second set of routes over the
// same rows would only split the edge cache and double the cold-start DB reads.
export const CITIES_ENDPOINT = '/api/downtown-definer/cities';
export const SEARCH_ENDPOINT = '/api/downtown-definer/search';

// Accent-insensitive, lowercased text for matching: "Montréal" -> "montreal".
export function normalizeText(text) {
  return (text || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}

// Mirrors the server's slugify so we can tell whether a geocoder suggestion
// (by its full "City, Region, Country" query) is already an added city.
export function slugifyCity(name) {
  return normalizeText(name).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

// Title-case a city name for display (keeps apostrophes intact, capitalizes
// across spaces and hyphens): "new york" -> "New York", "st. john's" -> "St. John's".
export function titleCaseCity(name) {
  if (!name) return '';
  return name
    .toLowerCase()
    .split(/(\s|-)/)
    .map((part) => (part ? part.charAt(0).toUpperCase() + part.slice(1) : part))
    .join('');
}

// Display name for a city: if it has 2+ commas (e.g. "Regina, Saskatchewan,
// Canada"), drop everything from the second comma on -> "Regina, Saskatchewan".
export function displayCityName(name) {
  const parts = (name || '').split(',');
  const trimmed = parts.length > 2 ? parts.slice(0, 2).join(',') : name;
  return titleCaseCity(trimmed);
}

// Cities added from this browser since load. The list endpoint is edge-cached
// for hours, so a city someone just created wouldn't come back in it yet;
// merging these in keeps it visible to the person who added it without asking
// for a shorter (more expensive) cache.
const sessionCities = [];

function rememberCity(city) {
  if (!city?.slug) return;
  if (!sessionCities.some((c) => c.slug === city.slug)) {
    sessionCities.push({ slug: city.slug, name: city.name, label: city.label || displayCityName(city.name) });
  }
}

export async function fetchCities() {
  try {
    const data = await fetch(CITIES_ENDPOINT).then((r) => r.json());
    const cities = (data.cities || []).map((c) => ({
      slug: c.slug,
      name: c.name,
      label: c.label || displayCityName(c.name),
    }));
    for (const city of sessionCities) {
      if (!cities.some((c) => c.slug === city.slug)) cities.push(city);
    }
    return cities;
  } catch {
    return [...sessionCities];
  }
}

export async function searchCitySuggestions(query) {
  const data = await fetch(`${SEARCH_ENDPOINT}?q=${encodeURIComponent(query)}`).then((r) => r.json());
  return { suggestions: data.suggestions || [], error: !!data.error };
}

// A known city, with its boundary, from the day-long edge cache. Returns null
// when the slug isn't a city we've stored yet.
export async function fetchCityBySlug(slug) {
  try {
    const res = await fetch(`${CITIES_ENDPOINT}/${slug}`);
    if (!res.ok) return null;
    const data = await res.json();
    return data.city || null;
  } catch {
    return null;
  }
}

// Resolve a free-text city name, geocoding and storing it if it's new.
// Returns { city } or { error }.
export async function createCityByName(name) {
  try {
    const res = await fetch(CITIES_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name.trim() }),
    });
    const data = await res.json();
    if (!res.ok) return { error: data.error || 'Could not load that city.' };
    rememberCity(data.city);
    return { city: data.city };
  } catch {
    return { error: 'Could not load that city.' };
  }
}

// Deep links (/tool/<slug>): the stored city if we have it, otherwise treat the
// slug as a city name and let the geocoder create it.
export async function resolveCitySlug(slug) {
  const cached = await fetchCityBySlug(slug);
  if (cached) return { city: cached };
  return createCityByName(slug.replace(/-/g, ' '));
}
