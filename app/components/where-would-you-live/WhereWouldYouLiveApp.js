'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import CityMap from '../downtown-definer/CityMap';
import CityPicker from '../city-picker/CityPicker';
import ShareButton from './ShareButton';
import { displayCityName, resolveCitySlug } from '../../lib/cities-client';
import {
  expandCompactGrid,
  decodeRLE,
  colorForIntensity,
  opacityForIntensity,
  NO_DATA_COLOR,
} from '../../lib/downtown-definer/heatmapGrid';
import { expandZoneLayout, zoneIdAt } from '../../lib/where-would-you-live/zoneGrid';

// Mirrors identity.js's IDENTITY_COOKIE — duplicated as a literal here so this
// client component never imports the server-only identity module.
const IDENTITY_COOKIE = 'dd_identity';
// Mirrors identity.js's LIVE_SUBMITTED_CITIES_COOKIE (same reason). Set by the
// submissions API; lists the city slugs this browser has answered for.
const SUBMITTED_CITIES_COOKIE = 'wl_submitted';

const MAX_AREAS = 12; // matches the submissions route

function readCookie(name) {
  if (typeof document === 'undefined') return null;
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]+)`));
  return match ? decodeURIComponent(match[1]) : null;
}

// Whether this browser has answered for the city, per the cookie. When false we
// skip the status call entirely — no function invocation, no DB wake. The rare
// false negative (cookie cleared) is corrected at submit time by the 409 flow.
function hasSubmittedCity(slug) {
  return (readCookie(SUBMITTED_CITIES_COOKIE) || '').split('|').includes(slug);
}

// This browser's own copy of what it submitted, keyed by city, so the results
// view can show it back without a status round-trip. The status endpoint stays
// as the fallback for when localStorage was cleared but cookies survived.
const STORED_PREFIX = 'wl_areas:';

function readStored(slug) {
  try {
    const raw = localStorage.getItem(STORED_PREFIX + slug);
    const parsed = raw ? JSON.parse(raw) : null;
    const areas = parsed?.areas?.filter((area) => Array.isArray(area) && area.length >= 3);
    if (!areas?.length) return null;
    return { areas, resident: parsed.resident ?? null };
  } catch {
    return null;
  }
}

function storeSubmitted(slug, areas, resident) {
  try {
    localStorage.setItem(STORED_PREFIX + slug, JSON.stringify({ areas, resident }));
  } catch {
    // Best-effort: the status endpoint remains the fallback.
  }
}

function clearAllStored() {
  try {
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith(STORED_PREFIX)) localStorage.removeItem(key);
    }
  } catch {}
}

// Stored GeoJSON polygons (outer rings, [lng, lat]) -> the [lat, lng] point
// lists the map expects. Drops each ring's closing duplicate vertex.
function polygonsToAreas(geometries) {
  if (!Array.isArray(geometries)) return null;
  const areas = [];
  for (const geometry of geometries) {
    const ring =
      geometry?.type === 'Polygon'
        ? geometry.coordinates[0]
        : geometry?.type === 'MultiPolygon'
          ? geometry.coordinates[0]?.[0]
          : null;
    if (!ring || ring.length < 3) continue;
    const points = ring.map(([lng, lat]) => [lat, lng]);
    const first = points[0];
    const last = points[points.length - 1];
    if (points.length > 1 && first[0] === last[0] && first[1] === last[1]) points.pop();
    if (points.length >= 3) areas.push(points);
  }
  return areas.length ? areas : null;
}

// Frame for the results maps: the union of the "second-lowest contour" (cells in
// the 2nd-lowest bucket or higher — trims sparse 1-vote outliers) and the areas
// this visitor drew, with a small margin. [minLng, minLat, maxLng, maxLat] or null.
function computeResultsFrame(grid, yourAreas) {
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
  for (const area of yourAreas || []) {
    for (const [lat, lng] of area) extend(lng, lat);
  }
  if (minLng === Infinity) return null;

  const padLng = (maxLng - minLng) * 0.02 || 0.002;
  const padLat = (maxLat - minLat) * 0.02 || 0.002;
  return [minLng - padLng, minLat - padLat, maxLng + padLng, maxLat + padLat];
}

const FILTERS = [
  { key: 'all', label: 'Everyone' },
  { key: 'resident', label: 'Live in the city' },
  { key: 'outside', label: 'Live outside it' },
];

export default function WhereWouldYouLiveApp({ initialCitySlug }) {
  const [phase, setPhase] = useState('picking-city');
  // Only for the deep-link path (/where-would-you-live/<slug>); the picker owns
  // its own loading and error state.
  const [cityLoading, setCityLoading] = useState(false);
  const [cityError, setCityError] = useState(null);

  const [selectedCity, setSelectedCity] = useState(null);
  const [areas, setAreas] = useState([[]]);
  const [activeArea, setActiveArea] = useState(0);
  const [resident, setResident] = useState(null); // true = lives inside the city
  const [zoneLayout, setZoneLayout] = useState(null); // coarse squares for the picker
  const [myZone, setMyZone] = useState(null); // optional: the square they live in
  // Which of the two things the ONE drawing-phase map is showing. Stacking a
  // second map under the first pushed Submit off the bottom of the screen, so
  // the zone picker takes over the map that's already there instead.
  const [mapView, setMapView] = useState('areas'); // 'areas' | 'zones'
  // Results: which zones' answers to show. Several can be selected by sweeping
  // across the grid — nobody lives in two zones, so their grids simply add.
  const [selectedZones, setSelectedZones] = useState([]);
  const [zoneCounts, setZoneCounts] = useState({}); // zoneId -> raw count array
  const [zoneLoading, setZoneLoading] = useState(false);
  // Sweeping has to take the drag gesture away from the map, so it's opt-in —
  // by default the zone map pans like any other map and a tap still selects.
  const [zonePaintMode, setZonePaintMode] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(null);
  const [viewingResults, setViewingResults] = useState(false);

  const [results, setResults] = useState(null);
  const [filter, setFilter] = useState('all');
  const [devIdentity, setDevIdentity] = useState(null);

  useEffect(() => {
    setDevIdentity(readCookie(IDENTITY_COOKIE));
  }, [phase]);

  // Deep link support: if the URL carries a city slug, load it on mount.
  useEffect(() => {
    if (initialCitySlug) loadCityBySlug(initialCitySlug);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialCitySlug]);

  // The zone layout is a pure function of the boundary, so it's a few hundred
  // bytes off a week-long edge cache — and it's only fetched once someone says
  // they live in the city, which is the only time the picker is shown.
  useEffect(() => {
    if (phase !== 'drawing' || resident !== true || zoneLayout || !selectedCity) return;
    let cancelled = false;
    fetch(`/api/where-would-you-live/zones?city=${selectedCity.slug}`)
      .then((r) => r.json())
      .then((d) => {
        if (!cancelled) setZoneLayout(d.zoneLayout || null);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [phase, resident, zoneLayout, selectedCity]);

  // Backspace removes the last point of the area being drawn.
  useEffect(() => {
    if (phase !== 'drawing') return undefined;
    function handleKeyDown(e) {
      if (e.key === 'Backspace' && document.activeElement?.tagName !== 'INPUT') {
        setAreas((current) =>
          current.map((area, i) => (i === activeArea ? area.slice(0, -1) : area))
        );
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [phase, activeArea]);

  function updateUrl(slug) {
    if (typeof window !== 'undefined') {
      window.history.replaceState(null, '', slug ? `/where-would-you-live/${slug}` : '/where-would-you-live');
    }
  }

  // Once we have a city, reflect it in the URL and either show the results (if
  // this visitor already answered) or the drawing tools.
  async function enterCity(city) {
    setSelectedCity({ ...city, name: city.label || displayCityName(city.name) });
    updateUrl(city.slug);

    // This browser's own copy of its answer means no status call at all —
    // straight to the results with the areas it drew. Deliberately not gated on
    // the submitted-cities cookie: if cookies were cleared but localStorage
    // survived, the visitor still sees what they drew.
    const stored = readStored(city.slug);
    if (stored) {
      await goToResults(city, stored.areas);
      return;
    }

    const status = hasSubmittedCity(city.slug)
      ? await fetch(`/api/where-would-you-live/status?city=${city.slug}`)
          .then((r) => r.json())
          .catch(() => ({ submitted: false }))
      : { submitted: false };

    if (status.submitted) {
      await goToResults(city, polygonsToAreas(status.yourPolygons));
    } else {
      setAreas([[]]);
      setActiveArea(0);
      setResident(null);
      setMyZone(null);
      setMapView('areas');
      setPhase('drawing');
    }
  }

  // Deep link: /where-would-you-live/<slug>. Uses the cached city if we have
  // one, otherwise resolves the slug as a city name (fetching its boundary).
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
    // `fresh` cache-busts the edge cache so a just-submitted answer shows up
    // immediately for its submitter; everyone else hits the shared CDN cache.
    const url = fresh
      ? `/api/where-would-you-live/heatmap?city=${citySlug}&t=${Date.now()}`
      : `/api/where-would-you-live/heatmap?city=${citySlug}`;
    const res = await fetch(url, fresh ? { cache: 'no-store' } : undefined);
    return res.json();
  }

  // One request carries both count arrays over one cell layout, so the three
  // filters are a client-side switch rather than three fetches.
  async function goToResults(city, yourAreas, fresh, viewOnly) {
    const data = await fetchHeatmap(city.slug, fresh);
    let mine = viewOnly ? null : yourAreas ?? readStored(city.slug)?.areas ?? null;
    if (!viewOnly && !mine && hasSubmittedCity(city.slug)) {
      const status = await fetch(`/api/where-would-you-live/status?city=${city.slug}`)
        .then((r) => r.json())
        .catch(() => null);
      mine = polygonsToAreas(status?.yourPolygons);
    }
    setResults({
      compact: data.grid || null,
      zoneLayout: data.zoneLayout || null,
      zoneTotals: data.zoneTotals || {},
      residentCount: data.residentCount || 0,
      nonResidentCount: data.nonResidentCount || 0,
      yourAreas: mine,
      viewOnly: !!viewOnly,
    });
    setFilter('all');
    setSelectedZones([]);
    setZoneCounts({});
    setZonePaintMode(false);
    setPhase('results');
    setDevIdentity(readCookie(IDENTITY_COOKIE));
  }

  // "Show results": see the map without answering first.
  async function showResults() {
    if (!selectedCity) return;
    setViewingResults(true);
    try {
      await goToResults(selectedCity, null, false, true);
    } finally {
      setViewingResults(false);
    }
  }

  // Both count arrays share the grid layout, so "everyone" is their elementwise
  // sum. Decoded once per payload; the per-filter grids are cached so flipping
  // between tabs doesn't re-expand tens of thousands of hexagons.
  const counts = useMemo(() => {
    if (!results?.compact?.rleIn) return null;
    const inCounts = decodeRLE(results.compact.rleIn);
    const outCounts = decodeRLE(results.compact.rleOut);
    const all = inCounts.map((v, i) => (v < 0 ? -1 : v + outCounts[i]));
    return { resident: inCounts, outside: outCounts, all };
  }, [results?.compact]);

  const gridCacheRef = useRef({ compact: null, grids: {} });
  if (gridCacheRef.current.compact !== results?.compact) {
    gridCacheRef.current = { compact: results?.compact ?? null, grids: {} };
  }

  function gridFor(key) {
    if (!counts || !results) return null;
    const total =
      key === 'resident'
        ? results.residentCount
        : key === 'outside'
          ? results.nonResidentCount
          : results.residentCount + results.nonResidentCount;
    if (total === 0) return null;
    const cache = gridCacheRef.current.grids;
    if (!cache[key]) {
      cache[key] = expandCompactGrid({ params: results.compact.params, counts: counts[key] }, total);
    }
    return cache[key];
  }

  const allGrid = gridFor('all');
  // Results: the zone squares double as a filter control, shaded by how many
  // answers came from each.
  const resultsLayout = results?.zoneLayout;
  const zoneTotals = results?.zoneTotals || {};
  const declaredCount = Object.values(zoneTotals).reduce((sum, n) => sum + n, 0);

  // Selected zone grids add straight together: everyone declared exactly one
  // zone, so no answer can appear in two of them and nothing is double counted.
  const zoneGrid = useMemo(() => {
    if (!selectedZones.length || !results?.compact?.params) return null;
    const arrays = selectedZones.map((id) => zoneCounts[id]);
    if (arrays.some((a) => !a)) return null; // still fetching
    const total = selectedZones.reduce((sum, id) => sum + (zoneTotals[id] || 0), 0);
    if (!total) return null;
    const summed = arrays[0].map((value, i) => {
      if (value < 0) return -1; // outside the city
      let n = 0;
      for (const a of arrays) n += a[i];
      return n;
    });
    return expandCompactGrid({ params: results.compact.params, counts: summed }, total);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedZones, zoneCounts, results?.compact, results?.zoneTotals]);

  const grid = selectedZones.length ? zoneGrid : gridFor(filter);
  const frame = useMemo(
    () => computeResultsFrame(allGrid, results?.yourAreas),
    [allGrid, results?.yourAreas]
  );

  // Squares for the "which part of town do you live in?" picker.
  const pickerZones = useMemo(() => {
    if (!zoneLayout) return [];
    return expandZoneLayout(zoneLayout).map((zone) => ({
      ...zone,
      color: zone.id === myZone ? '#e8590c' : '#94a3b8',
      fillOpacity: zone.id === myZone ? 0.35 : 0.06,
      label: zone.id === myZone ? 'You live around here' : 'Pick this area',
    }));
  }, [zoneLayout, myZone]);

  const resultZones = useMemo(() => {
    if (!resultsLayout || !declaredCount) return [];
    const all = expandZoneLayout(resultsLayout);
    const max = Math.max(1, ...Object.values(zoneTotals));
    return all.map((zone) => {
      const n = zoneTotals[zone.id] || 0;
      return {
        ...zone,
        color: n ? colorForIntensity(n / max) : NO_DATA_COLOR,
        fillOpacity: n ? opacityForIntensity(n / max) * 0.75 : 0.06,
        label: n
          ? `${n} answer${n === 1 ? '' : 's'} from here — click to filter the map to them`
          : 'No answers from here yet',
      };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resultsLayout, results?.zoneTotals, declaredCount]);

  // How the share card describes the active filter, and the zone squares it
  // should outline. A null label means no filter is on, so the card carries no
  // filtered panel.
  const zoneFilterOn = selectedZones.length > 0;
  const activeFilterLabel = zoneFilterOn
    ? `Responses just from people who live in the marked area${selectedZones.length === 1 ? '' : 's'}`
    : filter === 'resident'
      ? `Just people who live in ${selectedCity?.name || 'the city'}`
      : filter === 'outside'
        ? `Just people who live outside ${selectedCity?.name || 'the city'}`
        : null;
  const activeFilterCount = zoneFilterOn
    ? selectedZones.reduce((sum, id) => sum + (zoneTotals[id] || 0), 0)
    : filter === 'resident'
      ? results?.residentCount || 0
      : filter === 'outside'
        ? results?.nonResidentCount || 0
        : 0;
  const selectedZoneRings = selectedZones
    .map((id) => resultZones.find((zone) => zone.id === id)?.ring)
    .filter(Boolean);

  // A zone's grid is one request the first time it's opened, then it's held for
  // the rest of the session (and on the CDN for everybody else). Selecting
  // several fetches only the ones not already in hand.
  async function loadZoneCounts(ids) {
    const missing = ids.filter((id) => !zoneCounts[id]);
    if (!missing.length || !selectedCity) return;
    setZoneLoading(true);
    try {
      const fetched = await Promise.all(
        missing.map(async (id) => {
          try {
            const data = await fetch(
              `/api/where-would-you-live/heatmap?city=${selectedCity.slug}&zone=${id}`
            ).then((r) => r.json());
            return data?.grid?.rle ? [id, decodeRLE(data.grid.rle)] : null;
          } catch {
            return null;
          }
        })
      );
      const next = {};
      for (const entry of fetched) if (entry) next[entry[0]] = entry[1];
      if (Object.keys(next).length) setZoneCounts((current) => ({ ...current, ...next }));
    } finally {
      setZoneLoading(false);
    }
  }

  // A tap toggles one zone; a sweep replaces the selection with what it covered.
  function handleZonePaint(ids, wasDrag) {
    const usable = ids.filter((id) => (zoneTotals[id] || 0) > 0);
    let next;
    if (!wasDrag && ids.length === 1) {
      const [id] = ids;
      if (!(zoneTotals[id] > 0)) return;
      next = selectedZones.includes(id)
        ? selectedZones.filter((z) => z !== id)
        : [...selectedZones, id];
    } else {
      if (!usable.length) return;
      next = usable;
    }
    setSelectedZones(next);
    loadZoneCounts(next);
  }

  // Which zone a point on the map falls in — index arithmetic, no hit-testing.
  const zoneAt = useMemo(() => {
    if (!resultsLayout) return null;
    return (lat, lng) => zoneIdAt(resultsLayout, lng, lat);
  }, [resultsLayout]);

  const validAreas = areas.filter((area) => area.length >= 3);
  // Spelled out under the button whenever it's greyed out, so nobody has to
  // guess which of the two requirements is still outstanding.
  const submitBlockedReason = (() => {
    if (submitting) return null;
    const needsArea = validAreas.length === 0;
    const needsResidency = resident === null;
    if (needsArea && needsResidency) {
      return 'Draw at least one area, and answer whether you live here, before submitting.';
    }
    if (needsArea) return 'Draw at least one area, tap the map to place at least 3 points.';
    if (needsResidency) return `Answer whether you live within ${selectedCity?.name || 'the city'} to submit.`;
    return null;
  })();

  const activePoints = areas[activeArea] || [];

  function addPoint(point) {
    setAreas((current) => current.map((area, i) => (i === activeArea ? [...area, point] : area)));
  }

  function moveVertex(areaIndex, pointIndex, point) {
    setAreas((current) =>
      current.map((area, i) =>
        i === areaIndex ? area.map((existing, j) => (j === pointIndex ? point : existing)) : area
      )
    );
  }

  function startNewArea() {
    setAreas((current) => {
      const next = [...current.filter((area) => area.length > 0), []];
      setActiveArea(next.length - 1);
      return next;
    });
  }

  function removeArea(index) {
    setAreas((current) => {
      const next = current.filter((_, i) => i !== index);
      const kept = next.length ? next : [[]];
      setActiveArea((active) => Math.min(active > index ? active - 1 : active, kept.length - 1));
      return kept;
    });
  }

  async function handleSubmit() {
    setSubmitting(true);
    setSubmitError(null);
    try {
      const res = await fetch('/api/where-would-you-live/submissions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          citySlug: selectedCity.slug,
          areas: validAreas,
          resident,
          zoneId: resident ? myZone : null,
        }),
      });
      const data = await res.json();

      if (!res.ok) {
        setSubmitError(data.error || 'Something went wrong.');
        if (res.status === 409) {
          // Already answered from this browser: show that earlier answer, not
          // the new drawing.
          await goToResults(selectedCity);
        }
        return;
      }

      storeSubmitted(selectedCity.slug, validAreas, resident);
      await goToResults(selectedCity, validAreas, true); // fresh: reflect the new answer
    } catch {
      setSubmitError('Something went wrong.');
    } finally {
      setSubmitting(false);
    }
  }

  function resetToCityPicker() {
    setPhase('picking-city');
    setSelectedCity(null);
    setAreas([[]]);
    setActiveArea(0);
    setResident(null);
    setZoneLayout(null);
    setMyZone(null);
    setMapView('areas');
    setOriginZone(null);
    setResults(null);
    setSubmitError(null);
    setCityError(null);
    updateUrl(null);
  }

  function resetDevIdentity() {
    document.cookie = `${IDENTITY_COOKIE}=; Max-Age=0; path=/`;
    document.cookie = `${SUBMITTED_CITIES_COOKIE}=; Max-Age=0; path=/`;
    clearAllStored();
    setDevIdentity(null);
  }

  const totalCount = (results?.residentCount || 0) + (results?.nonResidentCount || 0);
  const filterCount = (key) =>
    key === 'resident'
      ? results?.residentCount || 0
      : key === 'outside'
        ? results?.nonResidentCount || 0
        : totalCount;

  return (
    <div className="min-h-screen" style={{ background: 'var(--paper)' }}>
      <div className="container mx-auto px-4 max-w-4xl lg:max-w-6xl pt-4 pb-10">
        <div className="mb-6">
          <h1 className="dd-title text-4xl sm:text-5xl mb-2" style={{ color: 'var(--ink)' }}>
            Where Would You Live?
          </h1>
          <p className="text-base max-w-2xl leading-relaxed" style={{ color: 'var(--ink-2)' }}>
            Draw boundaries around the areas of the city you would be happy to live in.
          </p>
        </div>

        {process.env.NODE_ENV !== 'production' && (
          <div
            className="text-xs p-2.5 mb-4 flex items-center justify-between gap-2 rounded-sm"
            style={{ background: '#fff7ed', border: '1px solid #fed7aa' }}
          >
            <span style={{ color: 'var(--ink-2)' }}>
              Dev mode — test identity: <code>{devIdentity || 'not set yet'}</code>
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
                  Where would you live in {selectedCity.name}?
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
              {mapView === 'areas' ? (
                <p className="text-sm" style={{ color: 'var(--ink-2)' }}>
                  Tap the map to place points. Place at least 3 points to form a boundary. Drag any point to adjust it. Finished one area? Press
                  &ldquo;New area&rdquo; to add another somewhere else.
                </p>
              ) : (
                <div className="flex flex-col gap-1">
                  <div className="flex items-baseline justify-between flex-wrap gap-2">
                    <p className="dd-kicker" style={{ color: 'var(--ink-2)' }}>
                      Which part of {selectedCity.name} do you live in?{' '}
                      <span className="font-normal normal-case" style={{ color: 'var(--ink-3)' }}>
                        Optional
                      </span>
                    </p>
                    <button onClick={() => setMapView('areas')} className="dd-link-accent text-sm">
                      ← Back to the areas you drew
                    </button>
                  </div>
                  <p className="text-sm" style={{ color: 'var(--ink-2)' }}>
                    These zones are a few kilometres across on purpose: nothing more precise than the
                    square you click is ever asked for or stored. Skip it and your answer still counts
                    everywhere else.
                  </p>
                </div>
              )}

              {/* One map, two jobs. Rendered in a fixed position so React keeps
                  the same Leaflet instance across the swap — no re-init, no
                  second round of tile downloads. */}
              <CityMap
                mode={mapView === 'areas' ? 'drawing' : 'zones'}
                boundary={selectedCity.boundary}
                bbox={selectedCity.bbox}
                areas={mapView === 'areas' ? areas : null}
                activeAreaIndex={activeArea}
                onMapClick={mapView === 'areas' ? addPoint : undefined}
                onAreaVertexMove={moveVertex}
                zones={mapView === 'zones' ? pickerZones : null}
                selectedZoneIds={myZone == null ? [] : [myZone]}
                onZoneClick={(id) => setMyZone((current) => (current === id ? null : id))}
                className="h-96 lg:h-[34rem] w-full rounded-sm border border-gray-200"
              />

              {mapView === 'areas' ? (
                <div className="flex flex-wrap items-center gap-2">
                  {areas.map((_, index) => {
                    const active = index === activeArea;
                    // dd-btn so the chip matches "New area" / "Undo point"
                    // exactly; the right padding is trimmed only when the remove
                    // control is present, so the two stay the same height.
                    return (
                      <span
                        key={index}
                        className={active ? 'dd-btn dd-btn-primary' : 'dd-btn dd-btn-ghost'}
                        style={areas.length > 1 ? { paddingRight: '0.5rem', gap: '0.35rem' } : undefined}
                      >
                        <button onClick={() => setActiveArea(index)} className="font-bold">
                          Area {index + 1}
                        </button>
                        {areas.length > 1 && (
                          <button
                            onClick={() => removeArea(index)}
                            aria-label={`Remove area ${index + 1}`}
                            className="px-1 leading-none opacity-60 hover:opacity-100"
                          >
                            ×
                          </button>
                        )}
                      </span>
                    );
                  })}
                  <button
                    onClick={startNewArea}
                    disabled={activePoints.length < 3 || areas.length >= MAX_AREAS}
                    className="dd-btn dd-btn-ghost"
                  >
                    + New area
                  </button>
                  <button
                    onClick={() =>
                      setAreas((current) =>
                        current.map((area, i) => (i === activeArea ? area.slice(0, -1) : area))
                      )
                    }
                    disabled={activePoints.length === 0}
                    className="dd-btn dd-btn-ghost"
                  >
                    ↶ Undo point
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-3 flex-wrap">
                  <span className="text-sm" style={{ color: myZone == null ? 'var(--ink-3)' : 'var(--ink)' }}>
                    {pickerZones.length === 0
                      ? 'Loading zones…'
                      : myZone == null
                        ? 'No area picked yet'
                        : 'You live around the highlighted square'}
                  </span>
                  {myZone != null && (
                    <button onClick={() => setMyZone(null)} className="dd-link-accent text-sm">
                      Clear
                    </button>
                  )}
                </div>
              )}

              <div className="flex flex-col gap-2 pt-1" style={{ borderTop: '1px solid var(--line)' }}>
                <p className="dd-kicker pt-3" style={{ color: 'var(--ink-2)' }}>
                  Do you live within {selectedCity.name}&apos;s boundaries?
                </p>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => {
                      setResident(true);
                      setMapView('zones'); // the map above becomes the zone picker
                    }}
                    className={resident === true ? 'dd-btn dd-btn-primary' : 'dd-btn dd-btn-ghost'}
                    aria-pressed={resident === true}
                  >
                    Yes, I live here
                  </button>
                  <button
                    onClick={() => {
                      setResident(false);
                      setMyZone(null);
                      setMapView('areas');
                    }}
                    className={resident === false ? 'dd-btn dd-btn-primary' : 'dd-btn dd-btn-ghost'}
                    aria-pressed={resident === false}
                  >
                    No, I live elsewhere
                  </button>
                </div>
                <p className="text-xs" style={{ color: 'var(--ink-3)' }}>
                  Results can be filtered by this answer, so people inside and outside the city can be
                  read apart.
                </p>

                {resident === true && mapView === 'areas' && (
                  <p className="text-sm" style={{ color: 'var(--ink-2)' }}>
                    {myZone == null
                      ? 'You can also say roughly which part of town you live in — '
                      : 'Thanks — you picked the part of town you live in. '}
                    <button onClick={() => setMapView('zones')} className="dd-link-accent">
                      {myZone == null ? 'pick an area on the map' : 'Change it'}
                    </button>
                    {myZone != null && (
                      <>
                        {' · '}
                        <button onClick={() => setMyZone(null)} className="dd-link-accent">
                          Clear
                        </button>
                      </>
                    )}
                  </p>
                )}
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={handleSubmit}
                  disabled={validAreas.length === 0 || resident === null || submitting}
                  className="dd-btn dd-btn-primary ml-auto"
                >
                  {submitting ? 'Submitting…' : 'Submit'}
                </button>
              </div>
              {submitBlockedReason && (
                <p className="text-sm text-right -mt-1" style={{ color: 'var(--accent)' }}>
                  {submitBlockedReason}
                </p>
              )}
              {submitError && <p className="text-sm" style={{ color: 'var(--accent)' }}>{submitError}</p>}
            </div>
          )}

          {phase === 'results' && selectedCity && results && (
            <div className="flex flex-col gap-4">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <h2 className="dd-title text-lg" style={{ color: 'var(--ink)' }}>
                  {selectedCity.name}
                  <span className="font-mono font-normal text-sm ml-2" style={{ color: 'var(--ink-3)' }}>
                    {totalCount} answer{totalCount === 1 ? '' : 's'}
                  </span>
                </h2>
                <button onClick={resetToCityPicker} className="dd-link-accent text-sm">
                  Try another city
                </button>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {FILTERS.map((f) => (
                  <button
                    key={f.key}
                    onClick={() => {
                      setFilter(f.key);
                      setSelectedZones([]);
                    }}
                    className={
                      !selectedZones.length && filter === f.key ? 'dd-btn dd-btn-primary' : 'dd-btn dd-btn-ghost'
                    }
                    aria-pressed={!selectedZones.length && filter === f.key}
                  >
                    {f.label}
                    <span className="font-mono font-normal ml-1.5 opacity-70">{filterCount(f.key)}</span>
                  </button>
                ))}
              </div>

              <div className={results.yourAreas ? 'grid sm:grid-cols-2 gap-4' : 'grid gap-4'}>
                {results.yourAreas && (
                  <div>
                    <p className="dd-kicker mb-1.5" style={{ color: 'var(--ink-2)' }}>
                      Where you would live
                    </p>
                    <CityMap
                      mode="static"
                      boundary={selectedCity.boundary}
                      bbox={selectedCity.bbox}
                      fitBbox={frame}
                      staticAreas={results.yourAreas}
                      className="h-72 lg:h-[32rem] w-full rounded-sm"
                    />
                  </div>
                )}
                <div>
                  <p className="dd-kicker mb-1.5" style={{ color: 'var(--ink-2)' }}>
                    {selectedZones.length
                      ? `Where people who live in the highlighted area${selectedZones.length === 1 ? '' : 's'} would live`
                      : filter === 'resident'
                        ? `Where people who live in ${selectedCity.name} would live`
                        : filter === 'outside'
                          ? `Where people from outside ${selectedCity.name} would live`
                          : 'Where everyone would live'}
                  </p>
                  {grid ? (
                    <CityMap
                      mode="choropleth"
                      boundary={selectedCity.boundary}
                      bbox={selectedCity.bbox}
                      fitBbox={frame}
                      grid={grid}
                      cellTooltip={(pct) => `${pct}% of them would live here`}
                      className="h-72 lg:h-[32rem] w-full rounded-sm"
                    />
                  ) : (
                    <div
                      className="h-72 lg:h-[32rem] w-full rounded-sm flex items-center justify-center text-sm"
                      style={{ background: 'var(--panel)', border: '1px solid var(--line)', color: 'var(--ink-3)' }}
                    >
                      {zoneLoading ? 'Loading…' : 'No answers in this group yet.'}
                    </div>
                  )}
                </div>
              </div>

              <p className="text-xs -mt-1" style={{ color: 'var(--ink-3)' }}>
                <span className="dd-hover-only">Hover over</span>
                <span className="dd-touch-only">Tap</span> a cell to see the share of this group that
                would live there.
              </p>

              {resultZones.length > 0 && declaredCount > 0 && (
                <div className="flex flex-col gap-2 pt-4" style={{ borderTop: '1px solid var(--line)' }}>
                  <div className="flex items-baseline justify-between flex-wrap gap-2">
                    <p className="dd-kicker" style={{ color: 'var(--ink-2)' }}>
                      Filter by where people live
                    </p>
                    {selectedZones.length > 0 && (
                      <button
                        onClick={() => setSelectedZones([])}
                        className="dd-link-accent text-sm"
                      >
                        Clear this filter
                      </button>
                    )}
                  </div>
                  <p className="text-xs" style={{ color: 'var(--ink-3)' }}>
                    Click an area to filter the map above to just see response from the people who
                    live in the selected area. Switch to &ldquo;Drag to select&rdquo; to sweep across
                    several and combine them.
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      onClick={() => setZonePaintMode(false)}
                      className={!zonePaintMode ? 'dd-btn dd-btn-primary' : 'dd-btn dd-btn-ghost'}
                      aria-pressed={!zonePaintMode}
                    >
                      Drag to pan
                    </button>
                    <button
                      onClick={() => setZonePaintMode(true)}
                      className={zonePaintMode ? 'dd-btn dd-btn-primary' : 'dd-btn dd-btn-ghost'}
                      aria-pressed={zonePaintMode}
                    >
                      Drag to select
                    </button>
                    <span className="text-xs" style={{ color: 'var(--ink-3)' }}>
                      {zonePaintMode
                        ? 'Sweep across areas to combine them. Pinch or scroll still zooms.'
                        : 'Tap an area to select it. Drag moves the map.'}
                    </span>
                  </div>
                  <CityMap
                    mode="zones"
                    boundary={selectedCity.boundary}
                    bbox={selectedCity.bbox}
                    zones={resultZones}
                    selectedZoneIds={selectedZones}
                    zoneAt={zoneAt}
                    onZoneClick={(id) => handleZonePaint([id], false)}
                    onZonePaint={handleZonePaint}
                    zonePaintActive={zonePaintMode}
                    className="h-72 lg:h-[26rem] w-full rounded-sm"
                  />
                </div>
              )}

              {allGrid && (
                <ShareButton
                  cityName={selectedCity.name}
                  citySlug={selectedCity.slug}
                  boundary={selectedCity.boundary}
                  bbox={selectedCity.bbox}
                  yourAreas={results.yourAreas}
                  allGrid={allGrid}
                  filteredGrid={activeFilterLabel ? grid : null}
                  filterLabel={activeFilterLabel}
                  zoneRings={selectedZoneRings}
                  totalCount={totalCount}
                  filteredCount={activeFilterCount}
                />
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
