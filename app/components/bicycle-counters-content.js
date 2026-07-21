'use client';

import { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { loadCSVData, processCounterData, loadBikeshareData, processBikeshareCounter, loadBikeshareHourlyData, processBikeshareHourlyData, getCurrentESTTime } from '../lib/dataUtils';
import CounterChart from './counterChart';
import HourlyBarChart from './hourlyBarChart';
import StationMap from './stationMap';
import StationDetail from './stationDetail';

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
      router.replace(`?${params.toString()}`, { scroll: false });
    }
  }, [selectedCounter, loading, router]);

  const handleCounterChange = (counterLocation) => {
    setSelectedCounter(counterLocation);
    // Reset to daily view when changing counters
    setViewMode('daily');
    // Reset station detail view when changing counters
    setShowStationDetail(false);
    setSelectedStationId(null);
    // Show map when switching counters
    setShowMap(true);
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

  const selectedCounterData = counters.find(counter => counter.location === selectedCounter);
  const isBikeShare = selectedCounter === "Bike Share Toronto";

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
    <div className="min-h-screen py-10" style={{ background: 'var(--paper)' }}>
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

            {/* Daily/Hourly toggle — only for Bike Share Toronto */}
            {isBikeShare && (
              <div className="flex flex-wrap items-center gap-x-6 gap-y-2 pt-1">
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
              </div>
            )}
          </div>
        </div>

        {/* Chart Display */}
        {!selectedCounterData ? (
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
              </h2>
            </div>
            <CounterChart
              data={selectedCounterData.data}
              title=""
            />
          </div>
        ) : null}

        {/* Station Map - Only shown for Bike Share Toronto when in daily view and not showing station detail */}
        {isBikeShare && viewMode === 'daily' && showMap && !showStationDetail && (
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
        {isBikeShare && showStationDetail && (
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
              . Last Updated: July 7th, 2026
            </p>
            <p className="text-sm mt-1" style={{ color: 'var(--ink-2)' }}>
              Bike share data from{' '}
              <a
                href="https://github.com/mjarrett/bikeraccoon"
                target="_blank"
                rel="noopener noreferrer"
                className="dd-link-accent"
              >
                bikeracoon api
              </a>
              . All bike share data are estimates and not official counts. They are inferred from station counts and tend to undercount trips by about 2%.
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