// counterChart.js
'use client';

import { useState, useEffect } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Scatter } from 'recharts';

export default function CounterChart({ data, title }) {
  const [visibleYears, setVisibleYears] = useState({});
  const [isChartReady, setIsChartReady] = useState(false);

  useEffect(() => {
    // Reset chart ready state when data changes
    setIsChartReady(false);
    
    // Small delay to ensure data is processed before showing chart
    const timer = setTimeout(() => {
      setIsChartReady(true);
    }, 100);
    
    return () => clearTimeout(timer);
  }, [data]);

  if (!data || data.length === 0) {
    return <div className="text-center p-8 text-gray-500">No data available for this counter</div>;
  }

  const handleTouchStart = (e) => {
    e.stopPropagation();
  };

  const handleTouchMove = (e) => {
    e.stopPropagation();
    e.preventDefault();
  };

  // Get all available years from the data
  const getAvailableYears = () => {
    const years = new Set();
    data.forEach(point => {
      const year = new Date(point.date).getFullYear();
      years.add(year);
    });
    return Array.from(years).sort();
  };

  // Initialize visible years (all true by default)
  const availableYears = getAvailableYears();
  
  // Initialize visibility state if not already set
  if (Object.keys(visibleYears).length === 0 && availableYears.length > 0) {
    const initialVisibility = {};
    availableYears.forEach(year => {
      initialVisibility[year] = true;
    });
    if (JSON.stringify(visibleYears) !== JSON.stringify(initialVisibility)) {
      // Use setTimeout to avoid render issues
      setTimeout(() => setVisibleYears(initialVisibility), 0);
    }
  }

  const toggleYear = (year) => {
    setVisibleYears(prev => ({
      ...prev,
      [year]: !prev[year]
    }));
  };

  const toggleAllYears = () => {
    const allVisible = Object.values(visibleYears).every(v => v === true);
    const newVisibility = {};
    availableYears.forEach(year => {
      newVisibility[year] = !allVisible;
    });
    setVisibleYears(newVisibility);
  };

  // Calculate rolling average (14-day)
  const calculateRollingAverageForYear = (yearData) => {
    if (!yearData || yearData.length === 0) return [];
    
    const sortedData = [...yearData].sort((a, b) => a.dayOfYear - b.dayOfYear);
    const result = [];
    
    for (let i = 0; i < sortedData.length; i++) {
      const startIndex = Math.max(0, i - 13); // 14-day window including current
      const windowData = sortedData.slice(startIndex, i + 1);
      const validVolumes = windowData.filter(point => point.volume > 0).map(point => point.volume);
      
      if (validVolumes.length > 0) {
        const average = validVolumes.reduce((sum, vol) => sum + vol, 0) / validVolumes.length;
        result.push({
          ...sortedData[i],
          rollingAverage: Math.round(average)
        });
      } else {
        result.push({
          ...sortedData[i],
          rollingAverage: 0
        });
      }
    }
    
    return result;
  };

  // Prepare year-over-year comparison data with daily points and rolling averages
  const getYearOverYearData = () => {
    const years = availableYears;
    const allDays = new Set();
    const yearsData = {};
    const yearsRollingAvg = {};

    // Initialize data structure for each year
    years.forEach(year => {
      yearsData[year] = [];
    });

    // Group data by year and day of year
    data.forEach(point => {
      const date = new Date(point.date);
      const year = date.getFullYear();
      const dayOfYear = getDayOfYear(date);
      
      if (yearsData[year]) {
        yearsData[year].push({
          dayOfYear: dayOfYear,
          volume: point.volume,
          date: point.date
        });
        allDays.add(dayOfYear);
      }
    });

    // Calculate rolling averages for each year
    years.forEach(year => {
      if (yearsData[year] && yearsData[year].length > 0) {
        yearsRollingAvg[year] = calculateRollingAverageForYear(yearsData[year]);
      } else {
        yearsRollingAvg[year] = [];
      }
    });

    // Create array of all days in order (1-366)
    const sortedDays = Array.from(allDays).sort((a, b) => a - b);
    
    // Build the dataset for the chart
    return sortedDays.map(day => {
      const dataPoint = { 
        dayOfYear: day, 
        displayDate: getDateFromDayOfYear(day)
      };
      
      // Add daily volume data for each year (for scatter plot)
      years.forEach(year => {
        const dailyPoint = yearsData[year]?.find(p => p.dayOfYear === day);
        dataPoint[`daily_${year}`] = dailyPoint ? dailyPoint.volume : null;
        
        // Add rolling average for each year (for line chart)
        const rollingPoint = yearsRollingAvg[year]?.find(p => p.dayOfYear === day);
        dataPoint[`rolling_${year}`] = rollingPoint ? rollingPoint.rollingAverage : null;
      });
      
      return dataPoint;
    });
  };

  const getDayOfYear = (date) => {
    const start = new Date(date.getFullYear(), 0, 0);
    const diff = date - start;
    const oneDay = 86400000;
    return Math.floor(diff / oneDay);
  };

  const getDateFromDayOfYear = (dayOfYear) => {
    // Return a formatted date string (Month Day) for display
    const date = new Date(2024, 0, dayOfYear);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  // Custom tooltip formatter
  const CustomTooltip = ({ active, payload, label }) => {
    const isMobile = typeof window !== 'undefined' && window.innerWidth < 768;

    if (active && payload && payload.length) {
      // Filter to get unique years with their rolling average values
      const yearData = [];
      availableYears.forEach(year => {
        if (visibleYears[year]) {
          const rollingEntry = payload.find(p => p.dataKey === `rolling_${year}`);
          const dailyEntry = payload.find(p => p.dataKey === `daily_${year}`);
          if (rollingEntry && rollingEntry.value !== null && rollingEntry.value > 0) {
            yearData.push({
              year,
              rollingValue: rollingEntry.value,
              dailyValue: dailyEntry?.value
            });
          }
        }
      });
      
      if (yearData.length === 0) return null;
      
      return (
        <div className={`bg-white p-3 border border-gray-300 rounded-lg shadow-lg font-sans ${
          isMobile ? 'max-w-[250px] mx-auto fixed bottom-4 left-1/2 transform -translate-x-1/2' : 'max-w-[280px]'
        }`} style={{zIndex: 9999}}>
          <p className="font-semibold text-gray-800 text-sm mb-2">
            {label}
          </p>
          {yearData.map(({year, rollingValue, dailyValue}) => (
            <div key={year} className="mb-1">
              <p className="text-sm" style={{ color: getYearColor(year) }}>
                <span className="font-semibold">{year}:</span>
                <span className="ml-2">14-day avg: <span className="font-semibold">{rollingValue.toLocaleString()}</span></span>
                {dailyValue && dailyValue > 0 && (
                  <span className="ml-2 text-gray-600">(daily: {dailyValue.toLocaleString()})</span>
                )}
              </p>
            </div>
          ))}
        </div>
      );
    }
    return null;
  };

  // Get colors for different years
  const getYearColor = (year) => {
    const colors = {
      2020: '#8884d8',
      2021: '#82ca9d',
      2022: '#ff0000',
      2023: '#ff7300',
      2024: '#0088fe',
      2025: '#00ff00',
      2026: '#ffbb28'
    };
    return colors[year] || '#aaa';
  };

  const yearOverYearData = getYearOverYearData();
  
  // Calculate if any years are visible
  const hasVisibleYears = Object.values(visibleYears).some(v => v === true);
  const allVisible = Object.values(visibleYears).length > 0 && Object.values(visibleYears).every(v => v === true);

 

  return (
    <div 
      className="touch-pan-y relative"
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      style={{ touchAction: 'pan-y' }}
    >
      {/* Loading Modal */}
      
      {/* Chart content with fade-in effect */}
      <div className={`transition-opacity duration-300 ${isChartReady ? 'opacity-100' : 'opacity-0'}`}>
        {title && <h3 className="text-lg font-semibold mb-4">{title}</h3>}
        
        {/* Year Checkboxes */}
        <div className="mb-6 px-4 pt-2 border-b border-gray-200">
          <div className="flex flex-wrap items-center gap-3 mb-3">
            <button
              onClick={toggleAllYears}
              className="px-3 py-1.5 text-sm bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors duration-200 font-medium text-gray-700"
            >
              {allVisible ? 'Hide All' : 'Show All'}
            </button>
          </div>
          <div className="flex flex-wrap gap-4 mb-3">
            {availableYears.map(year => (
              <label key={year} className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={visibleYears[year] || false}
                  onChange={() => toggleYear(year)}
                  className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                />
                <span className="text-sm font-medium" style={{ color: getYearColor(year) }}>
                  {year}
                </span>
              </label>
            ))}
          </div>
        </div>
        
        {!hasVisibleYears ? (
          <div className="text-center py-16 text-gray-500">
            <p>No years selected. Please toggle at least one year to view data.</p>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={500}>
            <LineChart 
              data={yearOverYearData} 
              margin={{ top: 20, right: 30, left: 30, bottom: 50 }}
            >
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis 
                dataKey="displayDate"
                label={{ value: 'Date', position: 'insideBottom', offset: -5 }}
                angle={-45}
                textAnchor="end"
                height={80}
                interval={Math.floor(yearOverYearData.length / 15)}
              />
              <YAxis 
                label={{ 
                  value: 'Daily Bicycle Count (14-day avg shown as line)', 
                  angle: -90, 
                  position: 'insideLeft',
                  offset: -5,
                  style: { textAnchor: 'middle' }
                }}
              />
              <Tooltip content={<CustomTooltip />} />
              
              {/* Daily data as transparent scatter points */}
              {availableYears.map(year => (
                visibleYears[year] && (
                  <Scatter
                    key={`daily_${year}`}
                    dataKey={`daily_${year}`}
                    fill={getYearColor(year)}
                    fillOpacity={0.15}
                    name={`${year} Daily`}
                    legendType="none"
                    isAnimationActive={false}
                  />
                )
              ))}
              
              {/* Rolling average lines with animation disabled */}
              {availableYears.map(year => (
                visibleYears[year] && (
                  <Line
                    key={`rolling_${year}`}
                    type="monotone"
                    dataKey={`rolling_${year}`}
                    stroke={getYearColor(year)}
                    strokeWidth={2.5}
                    dot={false}
                    name={`rolling_${year}`}
                    connectNulls={false}
                    isAnimationActive={false}
                    animationDuration={0}
                  />
                )
              ))}
            </LineChart>
          </ResponsiveContainer>
        )}
        
        <div className="text-center text-sm text-gray-500 mt-4 px-4 pb-4">
          <p>Showing year-over-year comparison by day of year. Dots represent daily counts (transparent), lines show 14-day rolling average.</p>
        </div>
      </div>
    </div>
  );
}