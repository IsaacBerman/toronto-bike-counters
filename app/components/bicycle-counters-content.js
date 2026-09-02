'use client';

import { useState, useEffect, useMemo } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import dynamic from 'next/dynamic';
import { loadCSVData, processCounterData, loadBikeshareData, processBikeshareCounter, loadBikeshareHourlyData, processBikeshareHourlyData, getCurrentESTTime, bikeshareMonthlyBreakdown, USER_TYPES, BIKE_TYPES } from '../lib/dataUtils';
import CounterChart from './counterChart';
import HourlyBarChart from './hourlyBarChart';
import StationMap from './stationMap';
import StationDetail from './stationDetail';
import TripTypeBreakdownChart from './tripTypeBreakdownChart';

// Loaded only when the Ward breakdown tab is opened: it brings leaflet, turf
// and a 150 KB ward file that the rest of this page never touches.
const BikeShareWards = dynamic(() => import('./bike-share-wards/BikeShareWards'), {
  ssr: false,
  loading: () => (
    <p className="p-6 text-sm" style={{ color: 'var(--ink-3)' }}>
      Loading ward data…
    </p>
  ),
});

export default function BicycleCountersContent() {
  const [counters, setCounters] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedCounter, setSelectedCounter] = useState('');
  const [hourlyData, setHourlyData] = useState(null);
  const [viewMode, setViewMode] = useState('daily'); // 'daily' or 'hourly'
  const [currentEST, setCurrentEST] = useState(null);
  const [showStationDetail, setShowStationDetail] = useState(false);
  const [selectedStationId, setSelectedStationId] = useState(null);
  const [showMap, setShowMap] = useState(true); // New state to control map visibility

  // Bike Share trip-type filters, and which of its two tabs is showing.
  const [rawBikeshare, setRawBikeshare] = useState([]);
  const [userType, setUserType] = useState('all');
  const [bikeType, setBikeType] = useState('all');
  const [bikeshareTab, setBikeshareTab] = useState('trends'); // 'trends' | 'breakdown' | 'wards'
  const [wardSel, setWardSel] = useState('city'); // ward number, or 'city'

  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    // Get current EST time on mount
    setCurrentEST(getCurrentESTTime());
    
    async function fetchData() {
      try {
        // Load both CSV data and bikeshare data in parallel
        const [rawCSVData, rawBikeshareData] = await Promise.all([
          loadCSVData(),
          loadBikeshareData()
        ]);
        
        const processedCSVData = processCounterData(rawCSVData);
        const processedBikeshareData = processBikeshareCounter(rawBikeshareData);

        // Kept raw so the trip-type filters can re-derive the series without refetching.
        setRawBikeshare(rawBikeshareData);

        // Combine both data sources
        const allCounters = [processedBikeshareData, ...processedCSVData];
        
        const sortedCounters = allCounters.sort((a, b) => {
          if (a.location === "Bike Share Toronto") return -1;
          if (b.location === "Bike Share Toronto") return 1;
          
          if (a.isOperational && !b.isOperational) return -1;
          if (!a.isOperational && b.isOperational) return 1;
          
          return a.location.localeCompare(b.location);
        });
        
        setCounters(sortedCounters);
        setLoading(false);
        
        const urlTab = searchParams.get('tab');
        if (['trends', 'breakdown', 'wards'].includes(urlTab)) setBikeshareTab(urlTab);
        const urlWard = Number(searchParams.get('ward'));
        if (Number.isInteger(urlWard) && urlWard >= 1 && urlWard <= 25) setWardSel(urlWard);

        const urlCounter = searchParams.get('counter');
        const isValidCounter = sortedCounters.some(counter => counter.location === urlCounter);
        
        if (urlCounter && isValidCounter) {
          setSelectedCounter(urlCounter);
        } else if (sortedCounters.length > 0) {
          const defaultCounter = sortedCounters.find(c => c.location === "Bike Share Toronto") || sortedCounters[0];
          setSelectedCounter(defaultCounter.location);
        }
      } catch (error) {
        console.error('Error loading data:', error);
        setLoading(false);
      }
    }

    fetchData();
  }, [searchParams]);

  useEffect(() => {
    async function fetchHourlyData() {
      if (selectedCounter === "Bike Share Toronto" && viewMode === 'hourly') {
        const hourlyDataResult = await loadBikeshareHourlyData();
        setHourlyData(hourlyDataResult);
      }
    }
    
    fetchHourlyData();
  }, [selectedCounter, viewMode]);

  useEffect(() => {
    if (selectedCounter && !loading) {
      const params = new URLSearchParams();
      params.set('counter', selectedCounter);
      if (bikeshareTab !== 'trends') params.set('tab', bikeshareTab);
      if (bikeshareTab === 'wards' && wardSel !== 'city') params.set('ward', String(wardSel));
      router.replace(`?${params.toString()}`, { scroll: false });
    }
  }, [selectedCounter, loading, router, bikeshareTab, wardSel]);

  // Re-derive the Bike Share series whenever the trip-type filters change.
  const filteredBikeshare = useMemo(() => {
    if (!rawBikeshare.length) return null;
    return processBikeshareCounter(rawBikeshare, userType, bikeType);
  }, [rawBikeshare, userType, bikeType]);

  const monthlyBreakdown = useMemo(
    () => bikeshareMonthlyBreakdown(rawBikeshare),
    [rawBikeshare]
  );

  const handleCounterChange = (counterLocation) => {
    setSelectedCounter(counterLocation);
    // Reset to daily view when changing counters
    setViewMode('daily');
    // Reset station detail view when changing counters
    setShowStationDetail(false);
    setSelectedStationId(null);
    // Show map when switching counters
    setShowMap(true);
    // Back to the default, unfiltered Bike Share view
    setBikeshareTab('trends');
    setUserType('all');
    setBikeType('all');
  };

  const handleStationSelect = (stationId) => {
    setSelectedStationId(stationId);
    setShowStationDetail(true);
    // Hide map when showing station detail
    setShowMap(false);
  };

  const handleBackToMap = () => {
    setShowStationDetail(false);
    setSelectedStationId(null);
    // Show map when returning from station detail
    setShowMap(true);
  };

  // Handle view mode change
  const handleViewModeChange = () => {
    const newMode = viewMode === 'daily' ? 'hourly' : 'daily';
    setViewMode(newMode);
    
    // When switching to hourly, hide the map
    if (newMode === 'hourly') {
      setShowMap(false);
      setShowStationDetail(false);
    } else {
      // When switching back to daily, show the map
      setShowMap(true);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-2" style={{ background: 'var(--paper)' }}>
        <style>{`
          @keyframes bike-ride {
            0%   { transform: translateX(-100px); }
            100% { transform: translateX(calc(100vw + 100px)); }
          }
          .bike-rider-anim { animation: bike-ride 4s linear infinite; }
        `}</style>
        <div style={{ position: 'relative', width: '100%', height: '80px', overflow: 'hidden' }}>
          <div style={{ position: 'absolute', bottom: '10px', left: 0, right: 0, height: '2px', backgroundColor: '#d1d5db' }} />
          <div className="bike-rider-anim" style={{ position: 'absolute', bottom: '12px' }}>
            <svg width="70" height="55" viewBox="0 0 70 55" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ overflow: 'visible' }}>
              {/* Rear wheel */}
              <circle cx="12" cy="42" r="12" stroke="#374151" strokeWidth="2.5" fill="none"/>
              <g>
                <animateTransform attributeName="transform" type="rotate" from="0 12 42" to="360 12 42" dur="1.4s" repeatCount="indefinite"/>
                <line x1="12" y1="31" x2="12" y2="53" stroke="#4b5563" strokeWidth="2.5"/>
                <line x1="1" y1="42" x2="23" y2="42" stroke="#9ca3af" strokeWidth="1.5"/>
                <line x1="4.2" y1="34.2" x2="19.8" y2="49.8" stroke="#9ca3af" strokeWidth="1.5"/>
                <line x1="19.8" y1="34.2" x2="4.2" y2="49.8" stroke="#9ca3af" strokeWidth="1.5"/>
              </g>
              <circle cx="12" cy="42" r="2" fill="#374151"/>
              {/* Front wheel */}
              <circle cx="58" cy="42" r="12" stroke="#374151" strokeWidth="2.5" fill="none"/>
              <g>
                <animateTransform attributeName="transform" type="rotate" from="0 58 42" to="360 58 42" dur="1.4s" repeatCount="indefinite"/>
                <line x1="58" y1="31" x2="58" y2="53" stroke="#4b5563" strokeWidth="2.5"/>
                <line x1="47" y1="42" x2="69" y2="42" stroke="#9ca3af" strokeWidth="1.5"/>
                <line x1="50.2" y1="34.2" x2="65.8" y2="49.8" stroke="#9ca3af" strokeWidth="1.5"/>
                <line x1="65.8" y1="34.2" x2="50.2" y2="49.8" stroke="#9ca3af" strokeWidth="1.5"/>
              </g>
              <circle cx="58" cy="42" r="2" fill="#374151"/>
              {/* Frame: BB to seat tube top */}
              <line x1="30" y1="42" x2="24" y2="22" stroke="#2563eb" strokeWidth="2.5" strokeLinecap="round"/>
              {/* Frame: top tube */}
              <line x1="24" y1="22" x2="50" y2="20" stroke="#2563eb" strokeWidth="2.5" strokeLinecap="round"/>
              {/* Frame: down tube */}
              <line x1="50" y1="20" x2="30" y2="42" stroke="#2563eb" strokeWidth="2.5" strokeLinecap="round"/>
              {/* Frame: chain stay */}
              <line x1="30" y1="42" x2="12" y2="42" stroke="#2563eb" strokeWidth="2.5" strokeLinecap="round"/>
              {/* Frame: seat stay */}
              <line x1="24" y1="22" x2="12" y2="42" stroke="#2563eb" strokeWidth="2.5" strokeLinecap="round"/>
              {/* Fork */}
              <line x1="50" y1="20" x2="58" y2="42" stroke="#374151" strokeWidth="2" strokeLinecap="round"/>
              {/* Saddle */}
              <line x1="18" y1="18" x2="28" y2="18" stroke="#374151" strokeWidth="3" strokeLinecap="round"/>
              {/* Handlebar */}
              <line x1="52" y1="14" x2="60" y2="16" stroke="#374151" strokeWidth="3" strokeLinecap="round"/>
              <line x1="54" y1="20" x2="54" y2="13" stroke="#374151" strokeWidth="2" strokeLinecap="round"/>
              {/* Rider head */}
              <circle cx="50" cy="7" r="3" fill="#f59e0b" stroke="#b45309" strokeWidth="1.5"/>
              {/* Rider body */}
              <line x1="50" y1="13" x2="46" y2="24" stroke="#1d4ed8" strokeWidth="3" strokeLinecap="round"/>
              {/* Rider arm */}
              <line x1="48" y1="18" x2="56" y2="16" stroke="#1d4ed8" strokeWidth="2.5" strokeLinecap="round"/>
              {/* Rider legs */}
              <line x1="46" y1="24" x2="36" y2="36" stroke="#1d4ed8" strokeWidth="2.5" strokeLinecap="round">
                <animateTransform attributeName="transform" type="rotate" values="14 46 24; -14 46 24; 14 46 24" dur="1.4s" repeatCount="indefinite"/>
              </line>
              <line x1="46" y1="24" x2="30" y2="34" stroke="#1d4ed8" strokeWidth="2" strokeLinecap="round" opacity="0.5">
                <animateTransform attributeName="transform" type="rotate" values="-14 46 24; 14 46 24; -14 46 24" dur="1.4s" repeatCount="indefinite"/>
              </line>
            </svg>
          </div>
        </div>
        <div className="text-xl font-sans text-black">Loading bicycle counter data...</div>
      </div>
    );
  }

  const isBikeShare = selectedCounter === "Bike Share Toronto";
  // Bike Share reads from the filtered series; every other counter is unfiltered.
  const selectedCounterData = isBikeShare && filteredBikeshare
    ? filteredBikeshare
    : counters.find(counter => counter.location === selectedCounter);

  const isFiltered = userType !== 'all' || bikeType !== 'all';
  const userLabel = USER_TYPES.find(t => t.value === userType)?.label;
  const bikeLabel = BIKE_TYPES.find(t => t.value === bikeType)?.label;
  // Names the active filter for the axis, e.g. "Member E-bike".
  const measureLabel = isBikeShare && isFiltered
    ? [userType !== 'all' ? userLabel.replace(/s$/, '') : null,
       bikeType !== 'all' ? bikeLabel : null].filter(Boolean).join(' ')
    : undefined;

  const fmtDay = (iso) => iso
    ? new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
    : '';

  // Add a helper to show EST time in the UI
  const getESTTimeDisplay = () => {
    if (!currentEST) return '';
    const hours = currentEST.hour;
    const minutes = new Date().toLocaleTimeString('en-US', { 
      timeZone: 'America/Toronto',
      minute: '2-digit',
      hour12: true 
    });
    return `EST ${hours}:${minutes}`;
  };

  return (
    <div className="min-h-screen pt-4 pb-10" style={{ background: 'var(--paper)' }}>
      <div className="container mx-auto px-4 max-w-7xl">
        {/* Header Section */}
        <div className="mb-6">
          <h1 className="dd-title text-4xl sm:text-5xl mb-2" style={{ color: 'var(--ink)' }}>
            Toronto Bicycle Counters
          </h1>
        </div>

        {/* Control Panel */}
        <div className="mb-4 dd-panel-ruled p-4">
          <div className="flex flex-col gap-3">
            <div>
              <label htmlFor="counterSelect" className="dd-kicker block mb-1.5" style={{ color: 'var(--ink-2)' }}>
                Select Counter
              </label>
              <select
                id="counterSelect"
                value={selectedCounter}
                onChange={(e) => handleCounterChange(e.target.value)}
                className="dd-select w-full"
              >
                <optgroup label="Bike Share" className="font-semibold text-gray-700">
                  {counters.filter(counter => counter.location === "Bike Share Toronto").map(counter => (
                    <option key={counter.location} value={counter.location} className="py-2 text-gray-900">
                      {counter.location}
                    </option>
                  ))}
                </optgroup>
                <optgroup label="Current Counters" className="font-semibold text-gray-700">
                  {counters.filter(counter => counter.isOperational && counter.location !== "Bike Share Toronto").map(counter => (
                    <option key={counter.location} value={counter.location} className="py-2 text-gray-900">
                      {counter.location}
                    </option>
                  ))}
                </optgroup>
                <optgroup label="Historic Counters" className="font-semibold text-gray-700">
                  {counters.filter(counter => !counter.isOperational).map(counter => (
                    <option key={counter.location} value={counter.location} className="py-2 text-gray-900">
                      {counter.location}
                    </option>
                  ))}
                </optgroup>
              </select>
            </div>

            {/* Bike Share only: tabs, then the controls for the active tab */}
            {isBikeShare && (
              <>
                <div className="flex gap-1 border-b" style={{ borderColor: 'var(--line)' }} role="tablist">
                  {[
                    { id: 'trends', label: 'Daily trends' },
                    { id: 'breakdown', label: 'Trip type breakdown' },
                    { id: 'wards', label: 'Ward breakdown' }
                  ].map(tab => (
                    <button
                      key={tab.id}
                      role="tab"
                      aria-selected={bikeshareTab === tab.id}
                      onClick={() => setBikeshareTab(tab.id)}
                      className="px-4 py-2 text-sm font-semibold transition-colors duration-150"
                      style={{
                        color: bikeshareTab === tab.id ? 'var(--accent)' : 'var(--ink-3)',
                        borderBottom: bikeshareTab === tab.id ? '2px solid var(--accent)' : '2px solid transparent',
                        marginBottom: '-1px'
                      }}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>

                {bikeshareTab === 'trends' && (
                  <div className="flex flex-wrap items-center gap-x-6 gap-y-3 pt-1">
                    {/* Daily / Hourly toggle */}
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold" style={{ color: viewMode === 'daily' ? 'var(--accent)' : 'var(--ink-3)' }}>
                        Daily
                      </span>
                      <button
                        onClick={handleViewModeChange}
                        className="relative inline-flex h-6 w-11 items-center rounded-full transition-colors duration-200 focus:outline-none"
                        style={{ background: viewMode === 'hourly' ? 'var(--accent)' : '#d6d3c8' }}
                        role="switch"
                        aria-checked={viewMode === 'hourly'}
                      >
                        <span
                          className={`
                            inline-block h-4 w-4 transform rounded-full bg-white
                            transition-transform duration-200
                            ${viewMode === 'hourly' ? 'translate-x-6' : 'translate-x-1'}
                          `}
                        />
                      </button>
                      <span className="text-sm font-semibold" style={{ color: viewMode === 'hourly' ? 'var(--accent)' : 'var(--ink-3)' }}>
                        Hourly
                      </span>
                    </div>

                    {/* Trip-type filters — daily view only; the hourly feed has no splits */}
                    {viewMode === 'daily' && (
                      <>
                        <div className="flex items-center gap-2">
                          <label htmlFor="userTypeSelect" className="dd-kicker" style={{ color: 'var(--ink-2)' }}>
                            Rider
                          </label>
                          <select
                            id="userTypeSelect"
                            value={userType}
                            onChange={(e) => setUserType(e.target.value)}
                            className="dd-select"
                          >
                            {USER_TYPES.map(t => (
                              <option key={t.value} value={t.value}>{t.label}</option>
                            ))}
                          </select>
                        </div>
                        <div className="flex items-center gap-2">
                          <label htmlFor="bikeTypeSelect" className="dd-kicker" style={{ color: 'var(--ink-2)' }}>
                            Bike
                          </label>
                          <select
                            id="bikeTypeSelect"
                            value={bikeType}
                            onChange={(e) => setBikeType(e.target.value)}
                            className="dd-select"
                          >
                            {BIKE_TYPES.map(t => (
                              <option key={t.value} value={t.value}>{t.label}</option>
                            ))}
                          </select>
                        </div>
                        {isFiltered && (
                          <button
                            onClick={() => { setUserType('all'); setBikeType('all'); }}
                            className="text-sm underline"
                            style={{ color: 'var(--ink-3)' }}
                          >
                            Reset
                          </button>
                        )}
                      </>
                    )}
                  </div>
                )}
              </>
            )}
          </div>

          {/* A narrower filter covers less time than the full record — say so
              rather than letting the shorter series read as a decline. */}
          {isBikeShare && bikeshareTab === 'trends' && viewMode === 'daily' && isFiltered && selectedCounterData?.coverage && (
            <p className="text-xs mt-3" style={{ color: 'var(--ink-3)' }}>
              Showing {measureLabel.toLowerCase()} trips. This split is recorded from{' '}
              {fmtDay(selectedCounterData.coverage.from)} to {fmtDay(selectedCounterData.coverage.to)}.
              {bikeType !== 'all' && ' Bike model is recorded from January 2024.'}
              {' '}The live feed reports totals only, so filtered views end where the published data does.
            </p>
          )}
        </div>

        {/* Chart Display */}
        {isBikeShare && bikeshareTab === 'wards' ? (
          <div className="dd-panel overflow-hidden">
            <div className="p-4" style={{ borderBottom: '1px solid var(--line)' }}>
              <h2 className="dd-title text-xl" style={{ color: 'var(--ink)' }}>
                Bike Share Toronto — Ward breakdown
              </h2>
            </div>
            <div className="p-4">
              <BikeShareWards embedded ward={wardSel} onSelectWard={setWardSel} />
            </div>
          </div>
        ) : isBikeShare && bikeshareTab === 'breakdown' ? (
          <div className="dd-panel overflow-hidden">
            <div className="p-4" style={{ borderBottom: '1px solid var(--line)' }}>
              <h2 className="dd-title text-xl" style={{ color: 'var(--ink)' }}>
                Bike Share Toronto — Trip type breakdown
              </h2>
            </div>
            <TripTypeBreakdownChart breakdown={monthlyBreakdown} />
          </div>
        ) : !selectedCounterData ? (
          <div className="text-center py-16 dd-panel">
            <p className="text-xl" style={{ color: 'var(--ink-3)' }}>Please select a counter to view data.</p>
          </div>
        ) : viewMode === 'hourly' && isBikeShare ? (
          <div className="dd-panel overflow-hidden">
            <div className="p-4" style={{ borderBottom: '1px solid var(--line)' }}>
              <h2 className="dd-title text-xl mb-1" style={{ color: 'var(--ink)' }}>
                {selectedCounterData.location} — Hourly Comparison (Last 2 Weeks)
              </h2>
              <p className="text-xs" style={{ color: 'var(--ink-3)' }}>
                Data shown in Eastern Time (EST/EDT)
              </p>
            </div>
            <HourlyBarChart data={hourlyData} />
          </div>
        ) : !showStationDetail ? (
          <div className="dd-panel overflow-hidden">
            <div className="p-4" style={{ borderBottom: '1px solid var(--line)' }}>
              <h2 className="dd-title text-xl" style={{ color: 'var(--ink)' }}>
                {selectedCounterData.location}
                {measureLabel && (
                  <span className="ml-2 text-base font-normal" style={{ color: 'var(--ink-2)' }}>
                    — {measureLabel} trips
                  </span>
                )}
              </h2>
            </div>
            <CounterChart
              data={selectedCounterData.data}
              title=""
              measureLabel={measureLabel}
            />
            {isBikeShare && (
              <p className="text-xs px-4 pb-4" style={{ color: 'var(--ink-3)' }}>
                Trips to March 31, 2026 are official counts from the{' '}
                <a
                  href="https://open.toronto.ca/dataset/bike-share-toronto-ridership-data/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="dd-link-accent"
                >
                  City of Toronto ridership data
                </a>
                . Later days are bikeraccoon estimates, which undercount by about 2%.
                Bike model is recorded from January 2024. Rider type is not shown for
                October 2021 to December 2023, where the City&rsquo;s data is not accurate.
              </p>
            )}
          </div>
        ) : null}

        {/* Station Map - Only shown for Bike Share Toronto when in daily view and not showing station detail */}
        {isBikeShare && bikeshareTab === 'trends' && viewMode === 'daily' && showMap && !showStationDetail && (
          <div className="mt-6">
            <div className="dd-panel-ruled p-6">
              <h3 className="dd-title text-lg mb-4" style={{ color: 'var(--ink)' }}>
                Bike Share Station Map
              </h3>
             <div className="text-sm mb-4 space-y-1" style={{ color: 'var(--ink-2)' }}>
                <p>Circle size indicates average daily trips over last 2 weeks.</p>
                <p>🔵: {">"}0 Trips, 🟢: {">"}50 Trips, 🟡: {">"}100 Trips, 🟠: {">"}200 Trips, 🔴: {">"}400 Trips</p>
                <p>Click a station to view its history.</p>
              </div>
              <StationMap onStationSelect={handleStationSelect} />
            </div>
          </div>
        )}

        {/* Station Detail View */}
        {isBikeShare && bikeshareTab === 'trends' && showStationDetail && (
          <div className="mt-6">
            <StationDetail 
              stationId={selectedStationId} 
              onBack={handleBackToMap} 
            />
          </div>
        )}

        {/* Attribution Card */}
        <div className="mt-8">
          <div className="dd-panel p-6">
            <p className="text-sm" style={{ color: 'var(--ink-2)' }}>
              Data courtesy of{' '}
              <a
                href="https://open.toronto.ca/dataset/permanent-bicycle-counters/"
                target="_blank"
                rel="noopener noreferrer"
                className="dd-link-accent"
              >
                City of Toronto Open Data Portal
              </a>
              . Last Updated: August 6th, 2026
            </p>
            <p className="text-sm mt-1" style={{ color: 'var(--ink-2)' }}>
              Bike share ridership through March 31, 2026 from{' '}
              <a
                href="https://open.toronto.ca/dataset/bike-share-toronto-ridership-data/"
                target="_blank"
                rel="noopener noreferrer"
                className="dd-link-accent"
              >
                Bike Share Toronto Ridership Data
              </a>
              {' '}on the City of Toronto Open Data Portal. These are official trip records,
              and the only source with rider and bike-type detail. Days after that come from the{' '}
              <a
                href="https://github.com/mjarrett/bikeraccoon"
                target="_blank"
                rel="noopener noreferrer"
                className="dd-link-accent"
              >
                bikeraccoon api
              </a>
              , which are estimates rather than official counts: they are inferred from
              station counts and tend to undercount trips by about 2%.
            </p>
            <p className="text-xs mt-2" style={{ color: 'var(--ink-3)' }}>
              All times displayed in Eastern Time (EST/EDT) for consistency across all users
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}