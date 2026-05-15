'use client';

import { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { loadCSVData, processCounterData, loadBikeshareData, processBikeshareCounter } from '../lib/dataUtils';
import CounterChart from './counterChart';

export default function BicycleCountersContent() {
  const [counters, setCounters] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedCounter, setSelectedCounter] = useState('');
  const [selectedYear, setSelectedYear] = useState('all');
  const [comparisonMode, setComparisonMode] = useState(false);
  const [selectedYearsForComparison, setSelectedYearsForComparison] = useState([]);
  
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
        const urlYear = searchParams.get('year');
        const urlCompare = searchParams.get('compare');
        
        const isValidCounter = sortedCounters.some(counter => counter.location === urlCounter);
        
        if (urlCounter && isValidCounter) {
          setSelectedCounter(urlCounter);
        } else if (sortedCounters.length > 0) {
          // Auto-select Bike Share Toronto first, then first counter
          const defaultCounter = sortedCounters.find(c => c.location === "Bike Share Toronto") || sortedCounters[0];
          setSelectedCounter(defaultCounter.location);
        }
        
        if (urlYear && urlYear !== 'all') {
          setSelectedYear(urlYear);
        }
        
        if (urlCompare === 'true') {
          setComparisonMode(true);
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
      if (selectedYear !== 'all') {
        params.set('year', selectedYear);
      }
      if (comparisonMode && selectedYearsForComparison.length > 0) {
        params.set('compare', 'true');
        params.set('years', selectedYearsForComparison.join(','));
      } else if (comparisonMode) {
        params.set('compare', 'true');
      } else {
        params.delete('compare');
        params.delete('years');
      }
      router.replace(`?${params.toString()}`, { scroll: false });
    }
  }, [selectedCounter, selectedYear, comparisonMode, selectedYearsForComparison, loading, router]);

  const handleCounterChange = (counterLocation) => {
    setSelectedCounter(counterLocation);
    setSelectedYear('all');
    setComparisonMode(false);
    setSelectedYearsForComparison([]);
  };

  const handleYearChange = (year) => {
    setSelectedYear(year);
    setComparisonMode(false);
    setSelectedYearsForComparison([]);
  };

  const handleComparisonModeToggle = () => {
    if (!comparisonMode) {
      // Turning on comparison mode - get available years from data
      const availableYears = getAvailableYears();
      // Select first 2-3 years for comparison by default
      const defaultYears = availableYears.slice(0, Math.min(3, availableYears.length));
      setSelectedYearsForComparison(defaultYears);
    } else {
      // Turning off comparison mode
      setSelectedYearsForComparison([]);
    }
    setComparisonMode(!comparisonMode);
  };

  const handleYearSelectionForComparison = (year) => {
    setSelectedYearsForComparison(prev => {
      if (prev.includes(year)) {
        return prev.filter(y => y !== year);
      } else {
        return [...prev, year].sort();
      }
    });
  };

  const getAvailableYears = () => {
    if (!selectedCounterData) return [];
    const years = [...new Set(selectedCounterData.data.map(point => 
      new Date(point.date).getFullYear()
    ))];
    return years.sort((a, b) => b - a);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-xl font-sans">Loading bicycle counter data...</div>
      </div>
    );
  }

  const selectedCounterData = counters.find(counter => counter.location === selectedCounter);
  
  const filteredData = (!comparisonMode && selectedYear === 'all') 
    ? selectedCounterData?.data || []
    : (!comparisonMode && selectedYear !== 'all')
    ? selectedCounterData?.data.filter(point => new Date(point.date).getFullYear() === parseInt(selectedYear)) || []
    : selectedCounterData?.data || [];

  const availableYears = selectedCounterData 
    ? [...new Set(selectedCounterData.data.map(point => new Date(point.date).getFullYear()))].sort((a, b) => b - a)
    : [];

  const displayedTotal = !comparisonMode && filteredData.reduce((sum, point) => sum + point.volume, 0);

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
            
            <div>
              <label htmlFor="yearFilter" className="block text-sm font-semibold text-gray-700 mb-3 uppercase tracking-wide">
                Filter by Year
              </label>
              <select
                id="yearFilter"
                value={selectedYear}
                onChange={(e) => handleYearChange(e.target.value)}
                className="w-full border-2 border-gray-200 rounded-xl px-5 py-4 text-lg focus:outline-none focus:ring-4 focus:ring-blue-500 focus:border-blue-500 transition-all duration-300 bg-white shadow-sm hover:border-gray-300 font-sans text-gray-900 disabled:opacity-50 disabled:cursor-not-allowed"
                disabled={comparisonMode || !selectedCounterData}
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

          {/* Year-over-Year Comparison Toggle */}
          <div className="mt-6 pt-6 border-t border-gray-200">
            <div className="flex items-center justify-between flex-wrap gap-4">
              <div className="flex items-center gap-3">
                <button
                  onClick={handleComparisonModeToggle}
                  className={`px-6 py-3 rounded-xl font-semibold transition-all duration-300 ${
                    comparisonMode
                      ? 'bg-blue-600 text-white shadow-lg shadow-blue-200'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  {comparisonMode ? '✓ Year Comparison Active' : '📊 Compare Years'}
                </button>
                {comparisonMode && (
                  <span className="text-sm text-gray-600">
                    Compare multiple years on the same chart
                  </span>
                )}
              </div>
              
              {comparisonMode && (
                <div className="flex flex-wrap gap-2 items-center">
                  <span className="text-sm font-semibold text-gray-700 mr-2">Select Years:</span>
                  {availableYears.map(year => (
                    <button
                      key={year}
                      onClick={() => handleYearSelectionForComparison(year)}
                      className={`px-4 py-2 rounded-lg font-medium transition-all duration-200 ${
                        selectedYearsForComparison.includes(year)
                          ? 'bg-blue-500 text-white shadow-md'
                          : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                      }`}
                    >
                      {year}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {!selectedCounterData ? (
          <div className="text-center py-16 bg-white rounded-2xl shadow-lg">
            <p className="text-gray-500 text-xl font-sans">Please select a counter to view data.</p>
          </div>
        ) : comparisonMode && selectedYearsForComparison.length === 0 ? (
          <div className="text-center py-16 bg-white rounded-2xl shadow-lg">
            <p className="text-gray-500 text-xl font-sans">
              Please select at least one year to compare.
            </p>
          </div>
        ) : !comparisonMode && filteredData.length === 0 ? (
          <div className="text-center py-16 bg-white rounded-2xl shadow-lg">
            <p className="text-gray-500 text-xl font-sans">No data available for the selected counter and year.</p>
          </div>
        ) : (
          <div className="bg-white rounded-2xl shadow-lg overflow-hidden">
            <div className="p-8 border-b border-gray-100">
              <h2 className="text-3xl font-bold text-gray-900 font-sans mb-3">
                {selectedCounterData.location}
              </h2>
              {!comparisonMode ? (
                <p className="text-xl text-gray-600 font-sans">
                  Total for <span className="font-semibold text-blue-600">
                    {selectedYear === 'all' ? 'All Years' : selectedYear}
                  </span>: <span className="font-bold text-gray-900">{displayedTotal.toLocaleString()}</span> bicycles
                </p>
              ) : (
                <p className="text-xl text-gray-600 font-sans">
                  Year-over-Year Comparison: <span className="font-semibold text-blue-600">
                    {selectedYearsForComparison.join(', ')}
                  </span>
                </p>
              )}
            </div>
            <CounterChart
              data={filteredData}
              title=""
              comparisonMode={comparisonMode}
              selectedYears={selectedYearsForComparison}
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