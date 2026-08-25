'use client';

import { useEffect, useState } from 'react';
import CityMap from './CityMap';
import ShareButton from './ShareButton';
import CityPicker from '../city-picker/CityPicker';
import { displayCityName, resolveCitySlug } from '../../lib/cities-client';
import { expandCompactGrid } from '../../lib/downtown-definer/heatmapGrid';

// Mirrors identity.js's IDENTITY_COOKIE — duplicated as a literal here so
// this client component never imports the server-only identity module.
const IDENTITY_COOKIE = 'dd_identity';
// Mirrors identity.js's SUBMITTED_CITIES_COOKIE (same reason). Set by the
// submissions API; lists the city slugs this browser has submitted for.
const SUBMITTED_CITIES_COOKIE = 'dd_submitted';

function readCookie(name) {
  if (typeof document === 'undefined') return null;
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]+)`));
  return match ? decodeURIComponent(match[1]) : null;
}

// Whether this browser has submitted for the city, per the cookie. When false
// we skip the status call entirely — no function invocation, no DB wake. The
// rare false negative (cookie cleared) is corrected at submit time by the
// 409 flow.
function hasSubmittedCity(slug) {
  return (readCookie(SUBMITTED_CITIES_COOKIE) || '').split('|').includes(slug);
}

// The browser's own copy of the shape it submitted, keyed by city. "Your map"
// on the results view renders from this first, so this browser only ever
// shows a map it actually drew — and repeat visits skip the status call
// entirely (no function invocation, no DB wake). The status endpoint stays as
// the fallback for when localStorage was cleared but cookies survive.
const STORED_POINTS_PREFIX = 'dd_points:';

function readStoredPoints(slug) {
  try {
    const raw = localStorage.getItem(STORED_POINTS_PREFIX + slug);
    const points = raw ? JSON.parse(raw) : null;
    return Array.isArray(points) && points.length >= 3 ? points : null;
  } catch {
    return null;
  }
}

function storeSubmittedPoints(slug, points) {
  try {
    localStorage.setItem(STORED_POINTS_PREFIX + slug, JSON.stringify(points));
  } catch {
    // Best-effort: the status endpoint remains the fallback.
  }
}

function clearAllStoredPoints() {
  try {
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith(STORED_POINTS_PREFIX)) localStorage.removeItem(key);
    }
  } catch {}
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

// Ray-casting point-in-polygon. point: [lng, lat]; polygon: array of [lng, lat].
function pointInPolygon(x, y, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i][0];
    const yi = polygon[i][1];
    const xj = polygon[j][0];
    const yj = polygon[j][1];
    if (((yi > y) !== (yj > y)) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

// Similarity between the user's drawing and the consensus "downtown" (union of
// the top 6 buckets), as Intersection-over-Union over equal-area grid cells,
// scaled 0-100. 100 = same shape in the same place; 0 = no overlap.
const CONSENSUS_MIN_BUCKET = 7; // buckets 7..12 = the 6 highest of 13
function computeSimilarityScore(yourPoints, grid) {
  if (!yourPoints || yourPoints.length < 3 || !grid?.features?.length) return null;
  const poly = yourPoints.map(([lat, lng]) => [lng, lat]);
  let intersection = 0;
  let union = 0;
  for (const f of grid.features) {
    const inConsensus = (f.properties.b ?? -1) >= CONSENSUS_MIN_BUCKET;
    const ring = f.geometry.coordinates[0];
    const cx = (ring[0][0] + ring[1][0] + ring[2][0] + ring[3][0]) / 4;
    const cy = (ring[0][1] + ring[1][1] + ring[2][1] + ring[3][1]) / 4;
    const inUser = pointInPolygon(cx, cy, poly);
    if (inUser || inConsensus) union++;
    if (inUser && inConsensus) intersection++;
  }
  if (union === 0) return 0;
  return Math.round((100 * intersection) / union);
}

// Frame for the results maps: the union of the "second-lowest contour" (cells in
// the 2nd-lowest bucket or higher — trims sparse 1-vote outliers) and the user's
// drawn shape, with a small margin. Returns [minLng, minLat, maxLng, maxLat] or null.
function computeResultsFrame(grid, yourPoints) {
  if (!grid?.features?.length) return null;
  const buckets = new Set();
  for (const f of grid.features) {
    if (!f.properties.noData && f.properties.b != null) buckets.add(f.properties.b);
  }
  const sorted = [...buckets].sort((a, b) => a - b);
  const level = sorted.length >= 2 ? sorted[1] : (sorted[0] ?? 0);

  let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
  const extend = (lng, lat) => {
    if (lng < minLng) minLng = lng;
    if (lng > maxLng) maxLng = lng;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
  };

  for (const f of grid.features) {
    if (f.properties.noData || (f.properties.b ?? -1) < level) continue;
    for (const [lng, lat] of f.geometry.coordinates[0]) extend(lng, lat);
  }
  if (yourPoints) {
    for (const [lat, lng] of yourPoints) extend(lng, lat);
  }
  if (minLng === Infinity) return null;

  const padLng = (maxLng - minLng) * 0.02 || 0.002;
  const padLat = (maxLat - minLat) * 0.02 || 0.002;
  return [minLng - padLng, minLat - padLat, maxLng + padLng, maxLat + padLat];
}

export default function DowntownDefinerApp({ initialCitySlug }) {
  const [phase, setPhase] = useState('picking-city');
  // Only for the deep-link path (/downtown-definer/<slug>); the picker owns
  // its own loading and error state.
  const [cityLoading, setCityLoading] = useState(false);
  const [cityError, setCityError] = useState(null);

  const [selectedCity, setSelectedCity] = useState(null);
  const [points, setPoints] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(null);
  const [viewingResults, setViewingResults] = useState(false);

  const [results, setResults] = useState(null);
  const [devIdentity, setDevIdentity] = useState(null);

  useEffect(() => {
    setDevIdentity(readCookie(IDENTITY_COOKIE));
  }, [phase]);

  // Deep link support: if the URL carries a city slug, load it on mount.
  useEffect(() => {
    if (initialCitySlug) loadCityBySlug(initialCitySlug);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialCitySlug]);

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

  function updateUrl(slug) {
    if (typeof window !== 'undefined') {
      window.history.replaceState(null, '', slug ? `/downtown-definer/${slug}` : '/downtown-definer');
    }
  }

  // Once we have a city object, reflect it in the URL and either show the
  // results (if this visitor already submitted) or the drawing tools.
  async function enterCity(city) {
    setSelectedCity({ ...city, name: city.label || displayCityName(city.name) });
    updateUrl(city.slug);

    // This browser's own copy of its submitted shape means no status call at
    // all — straight to results with the map it drew. Deliberately not gated
    // on the submitted-cities cookie: if cookies were cleared but localStorage
    // survived, the visitor still sees the shape they drew (the server no
    // longer recognizes them, but what they see is what they expect).
    const storedPoints = readStoredPoints(city.slug);
    if (storedPoints) {
      await goToResults(city, storedPoints);
    } else {
      const status = hasSubmittedCity(city.slug)
        ? await fetch(`/api/downtown-definer/status?city=${city.slug}`)
            .then((r) => r.json())
            .catch(() => ({ submitted: false }))
        : { submitted: false };

      if (status.submitted) {
        await goToResults(city, polygonToPoints(status.yourPolygon));
      } else {
        setPoints([]);
        setPhase('drawing');
      }
    }
  }

  // Deep link: /downtown-definer/<slug>. Uses the cached city if we have one,
  // otherwise resolves the slug as a city name (fetching its boundary).
  async function loadCityBySlug(slug) {
    setCityError(null);
    setCityLoading(true);
    try {
      const { city, error } = await resolveCitySlug(slug);
      if (error) {
        setCityError(error);
        setPhase('picking-city');
        updateUrl(null);
        return;
      }
      await enterCity(city);
    } finally {
      setCityLoading(false);
    }
  }

  async function fetchHeatmap(citySlug, fresh) {
    // `fresh` cache-busts the edge cache so a just-submitted vote is reflected
    // immediately for the submitter; normal views hit the shared CDN cache.
    const url = fresh
      ? `/api/downtown-definer/heatmap?city=${citySlug}&t=${Date.now()}`
      : `/api/downtown-definer/heatmap?city=${citySlug}`;
    const res = await fetch(url, fresh ? { cache: 'no-store' } : undefined);
    const data = await res.json();
    // The API sends a compact { params, counts } grid; expand it back into the
    // GeoJSON FeatureCollection the rest of the UI expects.
    if (data?.grid?.params) {
      data.grid = expandCompactGrid(data.grid, data.submissionCount);
    }
    return data;
  }

  // Fetch the heatmap for a city and switch to the results view. `yourPoints`
  // is the visitor's own shape (from a fresh submission or a stored one); when
  // omitted it's fetched from the status endpoint. `fresh` bypasses the CDN
  // cache (used right after submitting).
  async function goToResults(city, yourPoints, fresh, viewOnly) {
    const heatmap = await fetchHeatmap(city.slug, fresh);
    // View-only ("Show results"): the consensus heatmap only — no "my downtown",
    // no score, no share. Otherwise resolve the visitor's own shape: what was
    // just drawn, else this browser's stored copy, else (localStorage cleared
    // but cookies intact) the status endpoint.
    let mine = null;
    if (!viewOnly) {
      mine = yourPoints ?? readStoredPoints(city.slug);
      if (!mine && hasSubmittedCity(city.slug)) {
        const status = await fetch(`/api/downtown-definer/status?city=${city.slug}`)
          .then((r) => r.json())
          .catch(() => null);
        mine = polygonToPoints(status?.yourPolygon);
      }
    }
    setResults({
      grid: heatmap.grid,
      submissionCount: heatmap.submissionCount,
      yourPoints: mine,
      score: viewOnly ? null : computeSimilarityScore(mine, heatmap.grid),
      frame: computeResultsFrame(heatmap.grid, mine),
      viewOnly: !!viewOnly,
    });
    setPhase('results');
    setDevIdentity(readCookie(IDENTITY_COOKIE));
  }

  // "Show results": view the consensus heatmap without drawing/submitting.
  async function showResults() {
    if (!selectedCity) return;
    setViewingResults(true);
    try {
      await goToResults(selectedCity, null, false, true);
    } finally {
      setViewingResults(false);
    }
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
          // Already submitted from this browser: show its earlier map (stored
          // copy or, failing that, the status endpoint's), not the new drawing.
          await goToResults(selectedCity);
        }
        return;
      }

      storeSubmittedPoints(selectedCity.slug, points);
      await goToResults(selectedCity, points, true); // fresh: reflect the new vote
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
    setCityError(null);
    updateUrl(null);
  }

  function resetDevIdentity() {
    document.cookie = `${IDENTITY_COOKIE}=; Max-Age=0; path=/`;
    // Also forget which cities "this submitter" submitted for (and its stored
    // shapes), so the fresh identity starts at the drawing phase instead of a
    // stale results view.
    document.cookie = `${SUBMITTED_CITIES_COOKIE}=; Max-Age=0; path=/`;
    clearAllStoredPoints();
    setDevIdentity(null);
  }

  return (
    <div className="min-h-screen" style={{ background: 'var(--paper)' }}>
      <div className="container mx-auto px-4 max-w-4xl lg:max-w-6xl pt-4 pb-10">
        <div className="mb-6">
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
              <CityPicker onCity={enterCity} />
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
                <div className="flex items-center gap-3">
                  <button onClick={showResults} disabled={viewingResults} className="dd-btn dd-btn-ghost">
                    {viewingResults ? 'Loading…' : 'Show results'}
                  </button>
                  <button onClick={resetToCityPicker} className="dd-btn dd-btn-ghost">
                    Change city
                  </button>
                </div>
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
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setPoints((p) => p.slice(0, -1))}
                    disabled={points.length === 0}
                    className="dd-btn dd-btn-ghost"
                  >
                    ↶ Undo point
                  </button>
                  <button
                    onClick={handleSubmit}
                    disabled={points.length < 3 || submitting}
                    className="dd-btn dd-btn-primary ml-auto"
                  >
                    {submitting ? 'Submitting…' : 'Submit definition'}
                  </button>
                </div>
                <span className="text-sm font-mono" style={{ color: 'var(--ink-3)' }}>
                  {points.length} point{points.length === 1 ? '' : 's'}
                  {points.length > 0 && ', click and drag to edit an already-placed point'}
                </span>
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

              <div className={results.yourPoints ? 'grid sm:grid-cols-2 gap-4' : 'grid gap-4'}>
                {results.yourPoints && (
                  <div>
                    <p className="dd-kicker mb-1.5" style={{ color: 'var(--ink-2)' }}>
                      Your downtown
                      {results.score != null && (
                        <>
                          {' · '}
                          <span className="dd-tip" style={{ color: 'var(--accent)' }}>
                            Score: {results.score}
                            <span className="dd-tip-bubble">
                              {
                                // A JS string, not JSX text, so HTML entities are never decoded —
                                // "&apos;" rendered literally. Real characters, and joined rather
                                // than line-continued, which was baking the source indentation
                                // into the sentence as runs of spaces.
                                'Similarity of your drawing to the consensus downtown (>50%) regions, from 0 to 100. ' +
                                'It\u2019s the overlapping area ÷ the combined area (intersection over union) of ' +
                                'the two shapes. 100 = same shape in the same place; 0 = no overlap.'
                              }
                            </span>
                          </span>
                        </>
                      )}
                    </p>
                    <CityMap
                      mode="static"
                      boundary={selectedCity.boundary}
                      bbox={selectedCity.bbox}
                      fitBbox={results.frame}
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
                    fitBbox={results.frame}
                    grid={results.grid}
                    className="h-72 lg:h-[32rem] w-full rounded-sm"
                  />
                </div>
              </div>

              <p className="text-xs -mt-1" style={{ color: 'var(--ink-3)' }}>
                <span className="dd-hover-only">Hover over</span>
                <span className="dd-touch-only">Tap</span> a cell to see the percentage of people who
                believe it&apos;s &ldquo;downtown&rdquo;.
              </p>

              {!results.viewOnly && (
                <ShareButton
                  cityName={selectedCity.name}
                  citySlug={selectedCity.slug}
                  boundary={selectedCity.boundary}
                  bbox={selectedCity.bbox}
                  yourPoints={results.yourPoints}
                  grid={results.grid}
                  submissionCount={results.submissionCount}
                  score={results.score}
                />
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
