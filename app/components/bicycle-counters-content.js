'use client';

import { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { loadCSVData, processCounterData, loadBikeshareData, processBikeshareCounter } from '../lib/dataUtils';
import CounterChart from './counterChart';

export default function BicycleCountersContent() {
  const [counters, setCounters] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedCounter, setSelectedCounter] = useState('');
  
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
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
          // Keep bikeshare at the top of operational counters
          if (a.location === "Bike Share Toronto") return -1;
          if (b.location === "Bike Share Toronto") return 1;
          
          // Operational counters first
          if (a.isOperational && !b.isOperational) return -1;
          if (!a.isOperational && b.isOperational) return 1;
          
          // Then sort alphabetically by location
          return a.location.localeCompare(b.location);
        });
        
        setCounters(sortedCounters);
        setLoading(false);
        
        const urlCounter = searchParams.get('counter');
        const isValidCounter = sortedCounters.some(counter => counter.location === urlCounter);
        
        if (urlCounter && isValidCounter) {
          setSelectedCounter(urlCounter);
        } else if (sortedCounters.length > 0) {
          // Auto-select Bike Share Toronto first, then first counter
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
    if (selectedCounter && !loading) {
      const params = new URLSearchParams();
      params.set('counter', selectedCounter);
      router.replace(`?${params.toString()}`, { scroll: false });
    }
  }, [selectedCounter, loading, router]);

  const handleCounterChange = (counterLocation) => {
    setSelectedCounter(counterLocation);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-xl font-sans">Loading bicycle counter data...</div>
      </div>
    );
  }

  const selectedCounterData = counters.find(counter => counter.location === selectedCounter);

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-blue-50 py-8">
      <div className="container mx-auto px-4 max-w-7xl">
        {/* Header Section */}
        <div className="text-center mb-4">
          <h1 className="text-3xl font-bold text-gray-900 mb-1 font-sans tracking-tight">
            Toronto Bicycle Counters
          </h1>
          <p className="text-base text-gray-600 max-w-2xl mx-auto font-sans leading-relaxed">
            Explore bicycle traffic data from counting stations across Toronto
          </p>
        </div>
        
        {/* Control Panel */}
        <div className="mb-4 bg-white p-4 rounded-2xl shadow-lg border border-gray-100 backdrop-blur-sm bg-opacity-95">
          <div className="grid grid-cols-1 lg:grid-cols-1 gap-4">
            <div>
              <label htmlFor="counterSelect" className="block text-sm font-semibold text-gray-700 mb-1 uppercase tracking-wide">
                Select Counter
              </label>
              <select
                id="counterSelect"
                value={selectedCounter}
                onChange={(e) => handleCounterChange(e.target.value)}
                className="w-full border-2 border-gray-200 rounded-xl px-3 py-2 text-base focus:outline-none focus:ring-4 focus:ring-blue-500 focus:border-blue-500 transition-all duration-300 bg-white shadow-sm hover:border-gray-300 font-sans text-gray-900"
              >
                <optgroup label="🚴 Bike Share" className="font-semibold text-gray-700">
                  {counters.filter(counter => counter.location === "Bike Share Toronto").map(counter => (
                    <option key={counter.location} value={counter.location} className="py-2 text-gray-900">
                      {counter.location}
                    </option>
                  ))}
                </optgroup>
                <optgroup label="🚲 Current Counters" className="font-semibold text-gray-700">
                  {counters.filter(counter => counter.isOperational && counter.location !== "Bike Share Toronto").map(counter => (
                    <option key={counter.location} value={counter.location} className="py-2 text-gray-900">
                      {counter.location}
                    </option>
                  ))}
                </optgroup>
                <optgroup label="📊 Historic Counters" className="font-semibold text-gray-700">
                  {counters.filter(counter => !counter.isOperational).map(counter => (
                    <option key={counter.location} value={counter.location} className="py-2 text-gray-900">
                      {counter.location}
                    </option>
                  ))}
                </optgroup>
              </select>
            </div>
          </div>
        </div>

        {/* Chart Display */}
        {!selectedCounterData ? (
          <div className="text-center py-16 bg-white rounded-2xl shadow-lg">
            <p className="text-gray-500 text-xl font-sans">Please select a counter to view data.</p>
          </div>
        ) : (
          <div className="bg-white rounded-2xl shadow-lg overflow-hidden">
            <div className="p-4 border-b border-gray-100">
              <h2 className="text-xl font-bold text-gray-600 font-sans mb-1">
                {selectedCounterData.location}
              </h2>
            </div>
            <CounterChart
              data={selectedCounterData.data}
              title=""
            />
          </div>
        )}

        {/* Attribution Card */}
        <div className="mt-8 text-center">
          <div className="bg-white p-6 rounded-2xl shadow-lg border border-gray-100 inline-block">
            <p className="text-gray-600 font-sans text-sm">
              Data courtesy of{' '}
              <a 
                href="https://open.toronto.ca/dataset/permanent-bicycle-counters/" 
                target="_blank" 
                rel="noopener noreferrer"
                className="text-blue-600 hover:text-blue-800 underline transition-colors duration-200 font-medium"
              >
                City of Toronto Open Data Portal
              </a>
              . Last Updated: May 11th, 2026
            </p>
             <p className="text-gray-600 font-sans text-sm">
              Bike share data from {' '}
              <a 
                href="https://github.com/mjarrett/bikeraccoon" 
                target="_blank" 
                rel="noopener noreferrer"
                className="text-blue-600 hover:text-blue-800 underline transition-colors duration-200 font-medium"
              >
                bikeracoon api
              </a>
              . All bike share data are estimates and not official counts. They are inferred from station counts and tend to undercount trips by about 2%.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}