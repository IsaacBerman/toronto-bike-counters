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

export default function DowntownDefinerApp() {
  const [phase, setPhase] = useState('picking-city');
  const [cities, setCities] = useState([]);
  const [selectValue, setSelectValue] = useState('Toronto');
  const [newCityInput, setNewCityInput] = useState('');
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

  const cityOptions = (() => {
    const names = cities.map((c) => c.name);
    return names.includes('Toronto') ? names : ['Toronto', ...names];
  })();

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
      setSelectedCity(data.city);

      // If this visitor already submitted for the city, skip drawing and go
      // straight to the results/heatmap view showing their previous shape.
      const status = await fetch(`/api/downtown-definer/status?city=${data.city.slug}`)
        .then((r) => r.json())
        .catch(() => ({ submitted: false }));

      if (status.submitted) {
        await goToResults(data.city, polygonToPoints(status.yourPolygon));
      } else {
        setPoints([]);
        setPhase('drawing');
      }

      fetch('/api/downtown-definer/cities')
        .then((r) => r.json())
        .then((d) => setCities(d.cities || []))
        .catch(() => {});
    } catch {
      setCityError('Could not load that city.');
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
  }

  function resetDevIdentity() {
    document.cookie = `${DEV_IDENTITY_COOKIE}=; Max-Age=0; path=/`;
    setDevIdentity(null);
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-blue-50 py-8">
      <div className="container mx-auto px-4 max-w-4xl">
        <div className="text-center mb-6">
          <h1 className="text-3xl font-bold text-gray-900 mb-1 tracking-tight">DowntownDefiner</h1>
          <p className="text-base text-gray-600 max-w-2xl mx-auto leading-relaxed">
            Draw what you consider &ldquo;downtown&rdquo; and see how it compares to everyone else&apos;s.
          </p>
        </div>

        {process.env.NODE_ENV !== 'production' && (
          <div className="text-xs bg-amber-50 border border-amber-200 rounded-lg p-2 mb-4 flex items-center justify-between gap-2">
            <span>
              Dev mode — test identity: <code>{devIdentity || 'not set yet'}</code> (submissions are keyed to this
              instead of your IP so you can test locally)
            </span>
            <button onClick={resetDevIdentity} className="underline shrink-0">
              New test identity
            </button>
          </div>
        )}

        <div className="bg-white p-4 rounded-2xl shadow-lg border border-gray-100 mb-4">
          {phase === 'picking-city' && (
            <div className="flex flex-col gap-3">
              <label className="text-sm font-semibold text-gray-700 uppercase tracking-wide">Choose a city</label>
              <div className="flex flex-wrap gap-2">
                <select
                  className="border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  value={selectValue}
                  onChange={(e) => setSelectValue(e.target.value)}
                >
                  {cityOptions.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                  <option value="__new__">+ Add a new city…</option>
                </select>
                {selectValue !== '__new__' && (
                  <button
                    onClick={() => loadCity(selectValue)}
                    disabled={cityLoading}
                    className="bg-blue-600 text-white text-sm px-4 py-2 rounded-lg hover:bg-blue-700 disabled:opacity-50"
                  >
                    {cityLoading ? 'Loading…' : 'Show map'}
                  </button>
                )}
              </div>

              {selectValue === '__new__' && (
                <div className="flex flex-wrap gap-2">
                  <input
                    type="text"
                    placeholder="City name, e.g. Ottawa"
                    value={newCityInput}
                    onChange={(e) => setNewCityInput(e.target.value)}
                    className="border border-gray-300 rounded-lg px-3 py-2 text-sm flex-1 min-w-48"
                  />
                  <button
                    onClick={() => loadCity(newCityInput)}
                    disabled={cityLoading || !newCityInput.trim()}
                    className="bg-blue-600 text-white text-sm px-4 py-2 rounded-lg hover:bg-blue-700 disabled:opacity-50"
                  >
                    {cityLoading ? 'Looking up…' : 'Add city'}
                  </button>
                </div>
              )}

              {cityError && <p className="text-sm text-red-600">{cityError}</p>}
            </div>
          )}

          {phase === 'drawing' && selectedCity && (
            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <h2 className="font-semibold text-gray-900">Draw your &ldquo;downtown&rdquo; for {selectedCity.name}</h2>
                <button onClick={resetToCityPicker} className="text-sm text-gray-500 hover:text-blue-600 underline">
                  Choose a different city
                </button>
              </div>
              <p className="text-sm text-gray-600">
                Click on the map to place points. You can submit once you have at least 3 points.
              </p>
              <CityMap
                mode="drawing"
                boundary={selectedCity.boundary}
                bbox={selectedCity.bbox}
                points={points}
                onMapClick={(point) => setPoints((p) => [...p, point])}
              />
              <div className="flex items-center gap-2 flex-wrap">
                <button
                  onClick={() => setPoints((p) => p.slice(0, -1))}
                  disabled={points.length === 0}
                  className="bg-gray-100 text-gray-700 text-sm px-4 py-2 rounded-lg hover:bg-gray-200 disabled:opacity-50"
                >
                  Undo last point
                </button>
                <span className="text-sm text-gray-500">{points.length} point{points.length === 1 ? '' : 's'}</span>
                <button
                  onClick={handleSubmit}
                  disabled={points.length < 3 || submitting}
                  className="ml-auto bg-blue-600 text-white text-sm px-4 py-2 rounded-lg hover:bg-blue-700 disabled:opacity-50"
                >
                  {submitting ? 'Submitting…' : 'Submit'}
                </button>
              </div>
              {submitError && <p className="text-sm text-red-600">{submitError}</p>}
            </div>
          )}

          {phase === 'results' && selectedCity && results && (
            <div className="flex flex-col gap-4">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <h2 className="font-semibold text-gray-900">
                  {selectedCity.name} — based on {results.submissionCount} submission
                  {results.submissionCount === 1 ? '' : 's'}
                </h2>
                <button onClick={resetToCityPicker} className="text-sm text-gray-500 hover:text-blue-600 underline">
                  Try another city
                </button>
              </div>

              <div className="grid sm:grid-cols-2 gap-4">
                {results.yourPoints && (
                  <div>
                    <p className="text-sm font-semibold text-gray-700 mb-1">Your downtown</p>
                    <CityMap
                      mode="static"
                      boundary={selectedCity.boundary}
                      bbox={selectedCity.bbox}
                      staticPoints={results.yourPoints}
                      className="h-72 w-full rounded-lg border border-gray-200"
                    />
                  </div>
                )}
                <div>
                  <p className="text-sm font-semibold text-gray-700 mb-1">Everyone&apos;s downtown</p>
                  <CityMap
                    mode="choropleth"
                    boundary={selectedCity.boundary}
                    bbox={selectedCity.bbox}
                    grid={results.grid}
                    className="h-72 w-full rounded-lg border border-gray-200"
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
