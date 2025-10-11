'use client';

import { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { loadCSVData, processCounterData } from './lib/dataUtils';
import CounterChart from './components/counterChart';

export default function BicycleCounters() {
  const [counters, setCounters] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedCounter, setSelectedCounter] = useState('');
  const [selectedYear, setSelectedYear] = useState('all');
  
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    async function fetchData() {
      const rawData = await loadCSVData();
      const processedData = processCounterData(rawData);
      
      // Sort counters: operational first, then retired, alphabetically within each group
      const sortedCounters = processedData.sort((a, b) => {
        // Operational counters first
        if (a.isOperational && !b.isOperational) return -1;
        if (!a.isOperational && b.isOperational) return 1;
        // Then sort alphabetically by location
        return a.location.localeCompare(b.location);
      });
      
      setCounters(sortedCounters);
      setLoading(false);
      
      // Get counter from URL parameter if it exists
      const urlCounter = searchParams.get('counter');
      const isValidCounter = sortedCounters.some(counter => counter.location === urlCounter);
      
      if (urlCounter && isValidCounter) {
        setSelectedCounter(urlCounter);
      } else if (sortedCounters.length > 0) {
        // Auto-select first counter when data loads if no valid URL parameter
        setSelectedCounter(sortedCounters[0].location);
      }
    }

    fetchData();
  }, [searchParams]);

  // Update URL when counter changes
  useEffect(() => {
    if (selectedCounter && !loading) {
      const params = new URLSearchParams();
      params.set('counter', selectedCounter);
      if (selectedYear !== 'all') {
        params.set('year', selectedYear);
      }
      
      // Use replace instead of push to avoid adding to browser history for every change
      router.replace(`?${params.toString()}`, { scroll: false });
    }
  }, [selectedCounter, selectedYear, loading, router]);

  // Handle counter selection change
  const handleCounterChange = (counterLocation) => {
    setSelectedCounter(counterLocation);
    setSelectedYear('all'); // Reset year filter to "All Years" when counter changes
  };

  // Handle year selection change
  const handleYearChange = (year) => {
    setSelectedYear(year);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-xl font-sans">Loading bicycle counter data...</div>
      </div>
    );
  }

  const selectedCounterData = counters.find(counter => counter.location === selectedCounter);
  
  // Filter data by year if needed
  const filteredData = selectedYear === 'all' 
    ? selectedCounterData?.data || []
    : selectedCounterData?.data.filter(point => new Date(point.date).getFullYear() === parseInt(selectedYear)) || [];

  // Get available years for the selected counter
  const availableYears = selectedCounterData 
    ? [...new Set(selectedCounterData.data.map(point => new Date(point.date).getFullYear()))].sort((a, b) => b - a)
    : [];

  // Calculate total for displayed data
  const displayedTotal = filteredData.reduce((sum, point) => sum + point.volume, 0);

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-blue-50 py-8">
      <div className="container mx-auto px-4 max-w-7xl">
        {/* Header Section */}
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold text-gray-900 mb-3 font-sans tracking-tight">
            Toronto Bicycle Counters
          </h1>
          <p className="text-xl text-gray-600 max-w-2xl mx-auto font-sans leading-relaxed">
            Explore bicycle traffic data from counting stations across Toronto
          </p>
        </div>
        
        {/* Control Panel */}
        <div className="mb-8 bg-white p-8 rounded-2xl shadow-lg border border-gray-100 backdrop-blur-sm bg-opacity-95">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            <div>
              <label htmlFor="counterSelect" className="block text-sm font-semibold text-gray-700 mb-3 uppercase tracking-wide">
                Select Counter
              </label>
              <select
                id="counterSelect"
                value={selectedCounter}
                onChange={(e) => handleCounterChange(e.target.value)}
                className="w-full border-2 border-gray-200 rounded-xl px-5 py-4 text-lg focus:outline-none focus:ring-4 focus:ring-blue-500 focus:border-blue-500 transition-all duration-300 bg-white shadow-sm hover:border-gray-300 font-sans text-gray-900"
              >
                <optgroup label="🚲 Current Counters" className="font-semibold text-gray-700">
                  {counters.filter(counter => counter.isOperational).map(counter => (
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
            
            <div>
              <label htmlFor="yearFilter" className="block text-sm font-semibold text-gray-700 mb-3 uppercase tracking-wide">
                Filter by Year
              </label>
              <select
                id="yearFilter"
                value={selectedYear}
                onChange={(e) => handleYearChange(e.target.value)}
                className="w-full border-2 border-gray-200 rounded-xl px-5 py-4 text-lg focus:outline-none focus:ring-4 focus:ring-blue-500 focus:border-blue-500 transition-all duration-300 bg-white shadow-sm hover:border-gray-300 font-sans text-gray-900 disabled:opacity-50 disabled:cursor-not-allowed"
                disabled={!selectedCounterData}
              >
                <option value="all" className="font-medium text-gray-900">📅 All Years</option>
                {availableYears.map(year => (
                  <option key={year} value={year} className="font-medium text-gray-900">
                    {year}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* Chart Display */}
        {!selectedCounterData ? (
          <div className="text-center py-16 bg-white rounded-2xl shadow-lg">
            <p className="text-gray-500 text-xl font-sans">Please select a counter to view data.</p>
          </div>
        ) : filteredData.length === 0 ? (
          <div className="text-center py-16 bg-white rounded-2xl shadow-lg">
            <p className="text-gray-500 text-xl font-sans">No data available for the selected counter and year.</p>
          </div>
        ) : (
          <div className="bg-white rounded-2xl shadow-lg overflow-hidden">
            <div className="p-8 border-b border-gray-100">
              <h2 className="text-3xl font-bold text-gray-900 font-sans mb-3">
                {selectedCounterData.location}
              </h2>
              <p className="text-xl text-gray-600 font-sans">
                Total for <span className="font-semibold text-blue-600">
                  {selectedYear === 'all' ? 'All Years' : selectedYear}
                </span>: <span className="font-bold text-gray-900">{displayedTotal.toLocaleString()}</span> bicycles
              </p>
            </div>
            <CounterChart
              data={filteredData}
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
              . Last Updated: October 7, 2025
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}