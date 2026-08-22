'use client';

import { useEffect, useState } from 'react';
import {
  fetchCities,
  searchCitySuggestions,
  fetchCityBySlug,
  createCityByName,
  normalizeText,
  slugifyCity,
} from '../../lib/cities-client';

// The city chooser shared by "Where is Downtown?" and "Where would you live?":
// type to filter the cities already added, or click through to the geocoder to
// add a new one. `onCity` receives the full city row (boundary included) once
// it resolves.
export default function CityPicker({ onCity, label = 'Choose a city' }) {
  const [cities, setCities] = useState([]);
  const [query, setQuery] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [suggestions, setSuggestions] = useState([]);
  const [searchedQuery, setSearchedQuery] = useState(''); // query the suggestions belong to
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState(false);
  const [cityLoading, setCityLoading] = useState(false);
  const [cityError, setCityError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    fetchCities().then((list) => {
      if (!cancelled) setCities(list);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // The geocoder is only queried when the user explicitly clicks "Add a city"
  // (not on every keystroke) — typing just filters the already-loaded list,
  // which avoids a request per keystroke and keeps Nominatim/Vercel usage low.
  async function runCitySearch() {
    const q = query.trim();
    if (q.length < 3) return;
    setSearchLoading(true);
    setSearchError(false);
    setSearchedQuery(q);
    try {
      const { suggestions: found, error } = await searchCitySuggestions(q);
      setSuggestions(found);
      setSearchError(error);
    } catch {
      setSuggestions([]);
      setSearchError(true);
    } finally {
      setSearchLoading(false);
    }
  }

  async function chooseSlug(slug) {
    setCityError(null);
    setCityLoading(true);
    try {
      const city = await fetchCityBySlug(slug);
      if (city) {
        setPickerOpen(false);
        await onCity(city);
        return;
      }
      await chooseName(slug.replace(/-/g, ' '), true);
    } finally {
      setCityLoading(false);
    }
  }

  async function chooseName(name, nested) {
    if (!name?.trim()) return;
    setCityError(null);
    if (!nested) setCityLoading(true);
    try {
      const { city, error } = await createCityByName(name);
      if (error) {
        setCityError(error);
        return;
      }
      setPickerOpen(false);
      await onCity(city);
    } finally {
      if (!nested) setCityLoading(false);
    }
  }

  // Always offer Toronto, even before the list loads.
  const cityList = (() => {
    const list = [...cities];
    if (!list.some((c) => c.slug === 'toronto')) {
      list.unshift({ slug: 'toronto', name: 'Toronto', label: 'Toronto' });
    }
    return list;
  })();
  const q = normalizeText(query.trim());
  const filteredCities = q ? cityList.filter((c) => normalizeText(c.label).includes(q)) : cityList;
  // Hide a geocoder suggestion only if that exact city is already added (matched
  // by the slug its full query would produce) — so "Portland, Maine" still shows
  // even when "Portland, Oregon" exists.
  const existingSlugs = new Set(cityList.map((c) => c.slug));
  const newSuggestions = suggestions.filter((s) => !existingSlugs.has(slugifyCity(s.query)));
  // Only show geocoder results if they belong to what's currently typed.
  const searchIsCurrent = searchedQuery !== '' && searchedQuery === query.trim();

  return (
    <div className="flex flex-col gap-3">
      <label className="dd-kicker" style={{ color: 'var(--ink-2)' }}>
        {label}
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
                onClick={() => chooseSlug(c.slug)}
                className="block w-full text-left px-3 py-2 text-sm font-semibold hover:bg-gray-50"
                style={{ color: 'var(--ink)' }}
              >
                {c.label}
              </button>
            ))}

            {/* Geocoder results — only after the user clicks "Add a city". */}
            {searchIsCurrent && (
              <>
                {searchLoading && (
                  <p className="px-3 py-2 text-sm" style={{ color: 'var(--ink-3)' }}>
                    Searching…
                  </p>
                )}
                {!searchLoading && searchError && (
                  <p className="px-3 py-2 text-sm" style={{ color: 'var(--accent)' }}>
                    Search is temporarily unavailable. Try again in a moment.
                  </p>
                )}
                {!searchLoading && !searchError && newSuggestions.length > 0 && (
                  <>
                    <p
                      className="px-3 pt-2 pb-1 text-xs font-bold uppercase tracking-wide"
                      style={{ color: 'var(--ink-3)', borderTop: filteredCities.length ? '1px solid var(--line)' : 'none' }}
                    >
                      Add a city
                    </p>
                    {newSuggestions.map((s) => (
                      <button
                        key={s.key}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => chooseName(s.query)}
                        className="block w-full text-left px-3 py-2 text-sm font-semibold hover:bg-gray-50"
                        style={{ color: 'var(--accent)' }}
                      >
                        + {s.label}
                      </button>
                    ))}
                  </>
                )}
                {!searchLoading && !searchError && newSuggestions.length === 0 && (
                  <p className="px-3 py-2 text-sm" style={{ color: 'var(--ink-3)' }}>
                    No city found for &ldquo;{query.trim()}&rdquo;.
                  </p>
                )}
              </>
            )}

            {/* "Add a city" trigger — runs the geocoder only on click. */}
            {query.trim().length >= 3 && !searchIsCurrent && (
              <button
                onMouseDown={(e) => e.preventDefault()}
                onClick={runCitySearch}
                className="block w-full text-left px-3 py-2 text-sm font-semibold hover:bg-gray-50"
                style={{ color: 'var(--accent)', borderTop: filteredCities.length ? '1px solid var(--line)' : 'none' }}
              >
                + Add a city matching &ldquo;{query.trim()}&rdquo;
              </button>
            )}

            {!filteredCities.length && query.trim().length > 0 && query.trim().length < 3 && (
              <p className="px-3 py-2 text-sm" style={{ color: 'var(--ink-3)' }}>
                Keep typing…
              </p>
            )}

            {!filteredCities.length && !query.trim() && (
              <p className="px-3 py-2 text-sm" style={{ color: 'var(--ink-3)' }}>
                Start typing a city name.
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
  );
}
