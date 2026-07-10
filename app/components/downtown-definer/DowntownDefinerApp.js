'use client';

import { useEffect, useState } from 'react';
import CityMap from './CityMap';
import ShareButton from './ShareButton';

// Mirrors identity.js's DEV_IDENTITY_COOKIE — duplicated as a literal here so
// this client component never imports the server-only identity module.
const DEV_IDENTITY_COOKIE = 'dd_dev_identity';

function readCookie(name) {
  if (typeof document === 'undefined') return null;
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]+)`));
  return match ? decodeURIComponent(match[1]) : null;
}

// Title-case a city name for display (keeps apostrophes intact, capitalizes
// across spaces and hyphens): "new york" -> "New York", "st. john's" -> "St. John's".
function titleCaseCity(name) {
  if (!name) return '';
  return name
    .toLowerCase()
    .split(/(\s|-)/)
    .map((part) => (part ? part.charAt(0).toUpperCase() + part.slice(1) : part))
    .join('');
}

// Converts a stored GeoJSON Polygon/MultiPolygon (outer ring, [lng, lat]) into
// the [lat, lng] point list the map and share card expect. Drops the closing
// duplicate vertex.
function polygonToPoints(geometry) {
  if (!geometry) return null;
  const ring =
    geometry.type === 'Polygon'
      ? geometry.coordinates[0]
      : geometry.type === 'MultiPolygon'
        ? geometry.coordinates[0]?.[0]
        : null;
  if (!ring || ring.length < 3) return null;
  const points = ring.map(([lng, lat]) => [lat, lng]);
  const first = points[0];
  const last = points[points.length - 1];
  if (points.length > 1 && first[0] === last[0] && first[1] === last[1]) {
    points.pop();
  }
  return points;
}

export default function DowntownDefinerApp({ initialCitySlug }) {
  const [phase, setPhase] = useState('picking-city');
  const [cities, setCities] = useState([]);
  const [query, setQuery] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [suggestions, setSuggestions] = useState([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [cityLoading, setCityLoading] = useState(false);
  const [cityError, setCityError] = useState(null);

  const [selectedCity, setSelectedCity] = useState(null);
  const [points, setPoints] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(null);

  const [results, setResults] = useState(null);
  const [devIdentity, setDevIdentity] = useState(null);

  useEffect(() => {
    setDevIdentity(readCookie(DEV_IDENTITY_COOKIE));
  }, [phase]);

  useEffect(() => {
    fetch('/api/downtown-definer/cities')
      .then((res) => res.json())
      .then((data) => setCities(data.cities || []))
      .catch(() => setCities([]));
  }, []);

  // Deep link support: if the URL carries a city slug, load it on mount.
  useEffect(() => {
    if (initialCitySlug) loadCityBySlug(initialCitySlug);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialCitySlug]);

  // Live geocoder autocomplete (debounced) so typing surfaces cities not yet
  // added — e.g. "Mexico" -> "Ciudad de México".
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setSuggestions([]);
      setSearchLoading(false);
      return;
    }
    setSearchLoading(true);
    const timer = setTimeout(() => {
      fetch(`/api/downtown-definer/search?q=${encodeURIComponent(q)}`)
        .then((r) => r.json())
        .then((d) => setSuggestions(d.suggestions || []))
        .catch(() => setSuggestions([]))
        .finally(() => setSearchLoading(false));
    }, 400);
    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    if (phase !== 'drawing') return;
    function handleKeyDown(e) {
      if (e.key === 'Backspace' && document.activeElement?.tagName !== 'INPUT') {
        setPoints((p) => p.slice(0, -1));
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [phase]);

  // Cities shown in the picker (always include Toronto as a suggestion), each
  // with a title-cased display label, filtered by the search query.
  const cityList = (() => {
    const list = cities.map((c) => ({ slug: c.slug, name: c.name, label: titleCaseCity(c.name) }));
    if (!list.some((c) => c.slug === 'toronto')) {
      list.unshift({ slug: 'toronto', name: 'Toronto', label: 'Toronto' });
    }
    return list;
  })();
  const q = query.trim().toLowerCase();
  const filteredCities = q ? cityList.filter((c) => c.label.toLowerCase().includes(q)) : cityList;
  const hasExactMatch = cityList.some((c) => c.label.toLowerCase() === q);

  function updateUrl(slug) {
    if (typeof window !== 'undefined') {
      window.history.replaceState(null, '', slug ? `/downtown-definer/${slug}` : '/downtown-definer');
    }
  }

  // Once we have a city object, reflect it in the URL and either show the
  // results (if this visitor already submitted) or the drawing tools.
  async function enterCity(city) {
    setSelectedCity({ ...city, name: titleCaseCity(city.name) });
    updateUrl(city.slug);
    setPickerOpen(false);

    const status = await fetch(`/api/downtown-definer/status?city=${city.slug}`)
      .then((r) => r.json())
      .catch(() => ({ submitted: false }));

    if (status.submitted) {
      await goToResults(city, polygonToPoints(status.yourPolygon));
    } else {
      setPoints([]);
      setPhase('drawing');
    }

    fetch('/api/downtown-definer/cities')
      .then((r) => r.json())
      .then((d) => setCities(d.cities || []))
      .catch(() => {});
  }

  async function loadCity(name) {
    if (!name?.trim()) return;
    setCityError(null);
    setCityLoading(true);
    try {
      const res = await fetch('/api/downtown-definer/cities', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setCityError(data.error || 'Could not load that city.');
        return;
      }
      await enterCity(data.city);
    } catch {
      setCityError('Could not load that city.');
    } finally {
      setCityLoading(false);
    }
  }

  // Deep link: /downtown-definer/<slug>. Use the cached city if present,
  // otherwise resolve the slug as a city name (fetch its boundary and cache it).
  async function loadCityBySlug(slug) {
    setCityError(null);
    setCityLoading(true);
    try {
      const cached = await fetch(`/api/downtown-definer/cities/${slug}`);
      if (cached.ok) {
        const data = await cached.json();
        await enterCity(data.city);
        return;
      }
      const res = await fetch('/api/downtown-definer/cities', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: slug.replace(/-/g, ' ') }),
      });
      const data = await res.json();
      if (!res.ok) {
        setCityError(data.error || 'Could not find that city.');
        setPhase('picking-city');
        updateUrl(null);
        return;
      }
      await enterCity(data.city);
    } catch {
      setCityError('Could not load that city.');
      setPhase('picking-city');
    } finally {
      setCityLoading(false);
    }
  }

  async function fetchHeatmap(citySlug) {
    const res = await fetch(`/api/downtown-definer/heatmap?city=${citySlug}`);
    const data = await res.json();
    return data;
  }

  // Fetch the heatmap for a city and switch to the results view. `yourPoints`
  // is the visitor's own shape (from a fresh submission or a stored one); when
  // omitted it's fetched from the status endpoint.
  async function goToResults(city, yourPoints) {
    const heatmap = await fetchHeatmap(city.slug);
    let mine = yourPoints ?? null;
    if (!mine) {
      const status = await fetch(`/api/downtown-definer/status?city=${city.slug}`)
        .then((r) => r.json())
        .catch(() => null);
      mine = polygonToPoints(status?.yourPolygon);
    }
    setResults({ grid: heatmap.grid, submissionCount: heatmap.submissionCount, yourPoints: mine });
    setPhase('results');
    setDevIdentity(readCookie(DEV_IDENTITY_COOKIE));
  }

  async function handleSubmit() {
    setSubmitting(true);
    setSubmitError(null);
    try {
      const res = await fetch('/api/downtown-definer/submissions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ citySlug: selectedCity.slug, points }),
      });
      const data = await res.json();

      if (!res.ok) {
        setSubmitError(data.error || 'Something went wrong.');
        if (res.status === 409) {
          await goToResults(selectedCity);
        }
        return;
      }

      await goToResults(selectedCity, points);
    } catch {
      setSubmitError('Something went wrong.');
    } finally {
      setSubmitting(false);
    }
  }

  function resetToCityPicker() {
    setPhase('picking-city');
    setSelectedCity(null);
    setPoints([]);
    setResults(null);
    setSubmitError(null);
    setQuery('');
    updateUrl(null);
  }

  function resetDevIdentity() {
    document.cookie = `${DEV_IDENTITY_COOKIE}=; Max-Age=0; path=/`;
    setDevIdentity(null);
  }

  return (
    <div className="min-h-screen" style={{ background: 'var(--paper)' }}>
      <div className="container mx-auto px-4 max-w-4xl lg:max-w-6xl py-10">
        <div className="mb-6">
          <p className="dd-kicker mb-2">Community map</p>
          <h1 className="dd-title text-4xl sm:text-5xl mb-2" style={{ color: 'var(--ink)' }}>
            Where is Downtown?
          </h1>
          <p className="text-base max-w-2xl leading-relaxed" style={{ color: 'var(--ink-2)' }}>
            Draw what you consider &ldquo;downtown&rdquo; and see how it compares to everyone else&apos;s.
          </p>
        </div>

        {process.env.NODE_ENV !== 'production' && (
          <div
            className="text-xs p-2.5 mb-4 flex items-center justify-between gap-2 rounded-sm"
            style={{ background: '#fff7ed', border: '1px solid #fed7aa' }}
          >
            <span style={{ color: 'var(--ink-2)' }}>
              Dev mode — test identity: <code>{devIdentity || 'not set yet'}</code> (keyed instead of your IP)
            </span>
            <button onClick={resetDevIdentity} className="dd-link-accent shrink-0">
              New test identity
            </button>
          </div>
        )}

        <div className="dd-panel-ruled p-5">
          {phase === 'picking-city' && (
            <div className="flex flex-col gap-3">
              <label className="dd-kicker" style={{ color: 'var(--ink-2)' }}>
                Choose a city
              </label>

              <div className="relative max-w-md">
                <input
                  type="text"
                  placeholder="Search cities, or type a new one…"
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setPickerOpen(true);
                  }}
                  onFocus={() => setPickerOpen(true)}
                  onBlur={() => setTimeout(() => setPickerOpen(false), 150)}
                  className="dd-input w-full"
                  disabled={cityLoading}
                />

                {pickerOpen && (
                  <div
                    className="absolute z-[1000] left-0 right-0 mt-1 max-h-64 overflow-auto shadow-lg"
                    style={{ background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: '4px' }}
                  >
                    {filteredCities.map((c) => (
                      <button
                        key={c.slug}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => loadCityBySlug(c.slug)}
                        className="block w-full text-left px-3 py-2 text-sm font-semibold hover:bg-gray-50"
                        style={{ color: 'var(--ink)' }}
                      >
                        {c.label}
                      </button>
                    ))}

                    {/* Geocoder suggestions (cities not yet added) */}
                    {suggestions.length > 0 && (
                      <>
                        <p
                          className="px-3 pt-2 pb-1 text-xs font-bold uppercase tracking-wide"
                          style={{ color: 'var(--ink-3)', borderTop: filteredCities.length ? '1px solid var(--line)' : 'none' }}
                        >
                          Add a city
                        </p>
                        {suggestions.map((s) => (
                          <button
                            key={s.key}
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() => loadCity(s.query)}
                            className="block w-full text-left px-3 py-2 text-sm font-semibold hover:bg-gray-50"
                            style={{ color: 'var(--accent)' }}
                          >
                            + {s.label}
                          </button>
                        ))}
                      </>
                    )}

                    {searchLoading && (
                      <p className="px-3 py-2 text-sm" style={{ color: 'var(--ink-3)' }}>
                        Searching…
                      </p>
                    )}

                    {/* Fallback: add the raw text if the geocoder returned nothing */}
                    {query.trim() && !hasExactMatch && !searchLoading && suggestions.length === 0 && (
                      <button
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => loadCity(query)}
                        className="block w-full text-left px-3 py-2 text-sm font-semibold hover:bg-gray-50"
                        style={{ color: 'var(--accent)', borderTop: filteredCities.length ? '1px solid var(--line)' : 'none' }}
                      >
                        + Add &ldquo;{titleCaseCity(query.trim())}&rdquo;
                      </button>
                    )}

                    {!filteredCities.length && !query.trim() && (
                      <p className="px-3 py-2 text-sm" style={{ color: 'var(--ink-3)' }}>
                        No cities yet.
                      </p>
                    )}
                  </div>
                )}
              </div>

              {cityLoading && (
                <p className="text-sm" style={{ color: 'var(--ink-3)' }}>
                  Loading…
                </p>
              )}
              {cityError && <p className="text-sm" style={{ color: 'var(--accent)' }}>{cityError}</p>}
            </div>
          )}

          {phase === 'drawing' && selectedCity && (
            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <h2 className="dd-title text-lg" style={{ color: 'var(--ink)' }}>
                  Draw your &ldquo;downtown&rdquo; for {selectedCity.name}
                </h2>
                <button onClick={resetToCityPicker} className="dd-link-accent text-sm">
                  Change city
                </button>
              </div>
              <p className="text-sm" style={{ color: 'var(--ink-2)' }}>
                Tap the map to place points. Drag any point to adjust it. Submit once you have at least 3.
              </p>
              <CityMap
                mode="drawing"
                boundary={selectedCity.boundary}
                bbox={selectedCity.bbox}
                points={points}
                onMapClick={(point) => setPoints((p) => [...p, point])}
                onVertexMove={(index, point) =>
                  setPoints((p) => p.map((existing, i) => (i === index ? point : existing)))
                }
                className="h-96 lg:h-[34rem] w-full rounded-sm border border-gray-200"
              />
              <div className="flex items-center gap-2 flex-wrap">
                <button
                  onClick={() => setPoints((p) => p.slice(0, -1))}
                  disabled={points.length === 0}
                  className="dd-btn dd-btn-ghost"
                >
                  ↶ Undo point
                </button>
                <span className="text-sm font-mono" style={{ color: 'var(--ink-3)' }}>
                  {points.length} point{points.length === 1 ? '' : 's'}
                  {points.length > 0 && ', click and drag to edit an already-placed point'}
                </span>
                <button
                  onClick={handleSubmit}
                  disabled={points.length < 3 || submitting}
                  className="dd-btn dd-btn-primary ml-auto"
                >
                  {submitting ? 'Submitting…' : 'Submit definition'}
                </button>
              </div>
              {submitError && <p className="text-sm" style={{ color: 'var(--accent)' }}>{submitError}</p>}
            </div>
          )}

          {phase === 'results' && selectedCity && results && (
            <div className="flex flex-col gap-4">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <h2 className="dd-title text-lg" style={{ color: 'var(--ink)' }}>
                  {selectedCity.name}
                  <span className="font-mono font-normal text-sm ml-2" style={{ color: 'var(--ink-3)' }}>
                    {results.submissionCount} submission{results.submissionCount === 1 ? '' : 's'}
                  </span>
                </h2>
                <button onClick={resetToCityPicker} className="dd-link-accent text-sm">
                  Try another city
                </button>
              </div>

              <div className="grid sm:grid-cols-2 gap-4">
                {results.yourPoints && (
                  <div>
                    <p className="dd-kicker mb-1.5" style={{ color: 'var(--ink-2)' }}>Your downtown</p>
                    <CityMap
                      mode="static"
                      boundary={selectedCity.boundary}
                      bbox={selectedCity.bbox}
                      staticPoints={results.yourPoints}
                      className="h-72 lg:h-[32rem] w-full rounded-sm"
                    />
                  </div>
                )}
                <div>
                  <p className="dd-kicker mb-1.5" style={{ color: 'var(--ink-2)' }}>Everyone&apos;s downtown</p>
                  <CityMap
                    mode="choropleth"
                    boundary={selectedCity.boundary}
                    bbox={selectedCity.bbox}
                    grid={results.grid}
                    className="h-72 lg:h-[32rem] w-full rounded-sm"
                  />
                </div>
              </div>

              <ShareButton
                cityName={selectedCity.name}
                boundary={selectedCity.boundary}
                bbox={selectedCity.bbox}
                yourPoints={results.yourPoints}
                grid={results.grid}
                submissionCount={results.submissionCount}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
