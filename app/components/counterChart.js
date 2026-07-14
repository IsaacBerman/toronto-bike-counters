// counterChart.js
'use client';

import { useState, useEffect } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Scatter, Brush, ReferenceArea } from 'recharts';

export default function CounterChart({ data, title }) {
  const [visibleYears, setVisibleYears] = useState({});
  const [isChartReady, setIsChartReady] = useState(false);
  const [showCumulative, setShowCumulative] = useState(false);
  const [activeTooltip, setActiveTooltip] = useState(null);
  const [zoomRange, setZoomRange] = useState(null); // { startIndex, endIndex } into yearOverYearData; null = full range
  const [refAreaLeft, setRefAreaLeft] = useState(null);
  const [refAreaRight, setRefAreaRight] = useState(null);

  useEffect(() => {
    // Reset chart ready state when data changes
    setIsChartReady(false);
    setZoomRange(null);

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
      const year = parseInt(point.date.split('-')[0]);
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

  const calculateRollingAverageForYear = (yearData) => {
    if (!yearData || yearData.length === 0) return [];
    
    const sortedData = [...yearData].sort((a, b) => a.dateKey.localeCompare(b.dateKey));
    const result = [];
    
    for (let i = 0; i < sortedData.length; i++) {
      const startIndex = Math.max(0, i - 13);
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

  const calculateCumulativeForYear = (yearData) => {
    if (!yearData || yearData.length === 0) return [];
    
    const sortedData = [...yearData].sort((a, b) => a.dateKey.localeCompare(b.dateKey));
    let cumulativeSum = 0;
    const result = [];
    
    for (let i = 0; i < sortedData.length; i++) {
      cumulativeSum += sortedData[i].volume;
      result.push({
        ...sortedData[i],
        cumulativeVolume: cumulativeSum
      });
    }
    
    return result;
  };

  const getYearOverYearData = () => {
    const years = availableYears;
    const allDates = new Set();
    const yearsData = {};
    const yearsRollingAvg = {};
    const yearsCumulative = {};

    // Initialize data structure for each year
    years.forEach(year => {
      yearsData[year] = [];
    });

    // Group data by year and date - work directly with date strings
    data.forEach(point => {
      // Split the date string directly (no timezone conversion)
      const dateParts = point.date.split('-');
      const year = parseInt(dateParts[0]);
      const month = dateParts[1];
      const day = dateParts[2];
      
      // Create dateKey with reference year 2024 for consistent X-axis
      const dateKey = `2024-${month}-${day}`;
      
      if (yearsData[year]) {
        yearsData[year].push({
          dateKey: dateKey,
          volume: point.volume,
          date: point.date,
          year: year,
          month: parseInt(month),
          day: parseInt(day)
        });
        allDates.add(dateKey);
      }
    });

    // Calculate rolling averages and cumulative totals for each year
    years.forEach(year => {
      if (yearsData[year] && yearsData[year].length > 0) {
        yearsRollingAvg[year] = calculateRollingAverageForYear(yearsData[year]);
        yearsCumulative[year] = calculateCumulativeForYear(yearsData[year]);
      } else {
        yearsRollingAvg[year] = [];
        yearsCumulative[year] = [];
      }
    });

    // Create array of all dates in order
    const sortedDates = Array.from(allDates).sort();

    // Build the dataset for the chart
    return sortedDates.map(dateKey => {
      // Extract month and day from dateKey for display
      const parts = dateKey.split('-');
      const month = parseInt(parts[1]);
      const day = parseInt(parts[2]);
      
      const dataPoint = { 
        dateKey: dateKey,
        displayDate: new Date(2024, month - 1, day).toLocaleDateString('en-US', { 
          month: 'short', 
          day: 'numeric'
        })
      };
      
      // Add data for each year
      years.forEach(year => {
        const dailyPoint = yearsData[year]?.find(p => p.dateKey === dateKey);
        
        if (showCumulative) {
          const cumulativePoint = yearsCumulative[year]?.find(p => p.dateKey === dateKey);
          dataPoint[`cumulative_${year}`] = cumulativePoint ? cumulativePoint.cumulativeVolume : null;
        } else {
          dataPoint[`daily_${year}`] = dailyPoint ? dailyPoint.volume : null;
          const rollingPoint = yearsRollingAvg[year]?.find(p => p.dateKey === dateKey);
          dataPoint[`rolling_${year}`] = rollingPoint ? rollingPoint.rollingAverage : null;
        }
      });
      
      return dataPoint;
    });
  };

  // Handle tooltip visibility for mobile
  const handleChartMouseMove = (state) => {
    if (refAreaLeft && state && state.activeLabel) {
      setRefAreaRight(state.activeLabel);
    }
    if (state && state.isTooltipActive) {
      setActiveTooltip(true);
    } else if (activeTooltip) {
      // Small delay to allow for finger lift detection
      setTimeout(() => {
        if (!state || !state.isTooltipActive) {
          setActiveTooltip(false);
        }
      }, 50);
    }
  };

  const handleChartMouseLeave = () => {
    setActiveTooltip(false);
    setRefAreaLeft(null);
    setRefAreaRight(null);
  };

  const handleZoomMouseDown = (state) => {
    if (state && state.activeLabel) {
      setRefAreaLeft(state.activeLabel);
      setRefAreaRight(null);
    }
  };

  // Custom tooltip formatter
  const CustomTooltip = ({ active, payload, label }) => {
    const isMobile = typeof window !== 'undefined' && window.innerWidth < 768;

    if (active && payload && payload.length) {
      // Filter to get unique years with their values
      const yearData = [];
      availableYears.forEach(year => {
        if (visibleYears[year]) {
          let entry;
          if (showCumulative) {
            entry = payload.find(p => p.dataKey === `cumulative_${year}`);
          } else {
            entry = payload.find(p => p.dataKey === `rolling_${year}`);
          }
          const dailyEntry = !showCumulative ? payload.find(p => p.dataKey === `daily_${year}`) : null;
          
          if (entry && entry.value !== null && entry.value > 0) {
            yearData.push({
              year,
              value: entry.value,
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
          {yearData.map(({year, value, dailyValue}) => (
            <div key={year} className="mb-1">
              <p className="text-sm" style={{ color: getYearColor(year) }}>
                <span className="font-semibold">{year}:</span>
                <span className="ml-2">
                  {showCumulative ? (
                    <>Cumulative: <span className="font-semibold">{value.toLocaleString()}</span></>
                  ) : (
                    <>14-day avg: <span className="font-semibold">{value.toLocaleString()}</span></>
                  )}
                </span>
                {!showCumulative && dailyValue && dailyValue > 0 && (
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
    
    // If year has predefined color, use it
    if (colors[year]) return colors[year];
    
    // Otherwise generate a consistent random color based on year
    const hash = year.toString().split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
    const hue = hash % 360;
    return `hsl(${hue}, 70%, 50%)`;
  };

  const yearOverYearData = getYearOverYearData();

  // Zoom window (indices into yearOverYearData), clamped in case data shrank
  const maxIndex = Math.max(0, yearOverYearData.length - 1);
  const zoomStart = Math.min(zoomRange?.startIndex ?? 0, maxIndex);
  const zoomEnd = Math.min(zoomRange?.endIndex ?? maxIndex, maxIndex);
  const isZoomed = zoomStart > 0 || zoomEnd < maxIndex;
  const visibleCount = zoomEnd - zoomStart + 1;

  const handleZoomMouseUp = () => {
    if (refAreaLeft && refAreaRight && refAreaLeft !== refAreaRight) {
      let start = yearOverYearData.findIndex(d => d.displayDate === refAreaLeft);
      let end = yearOverYearData.findIndex(d => d.displayDate === refAreaRight);
      if (start > end) [start, end] = [end, start];
      if (start !== -1 && end > start) {
        setZoomRange({ startIndex: start, endIndex: end });
      }
    }
    setRefAreaLeft(null);
    setRefAreaRight(null);
  };

  const resetZoom = () => setZoomRange(null);

  // Calculate if any years are visible
  const hasVisibleYears = Object.values(visibleYears).some(v => v === true);
  const allVisible = Object.values(visibleYears).length > 0 && Object.values(visibleYears).every(v => v === true);

  // Get Y-axis label based on mode
  const getYAxisLabel = () => {
    if (showCumulative) {
      return { 
        value: 'Cumulative Year-to-Date Count', 
        angle: -90, 
        position: 'insideLeft',
        offset: -5,
        style: { textAnchor: 'middle' }
      };
    } else {
      return { 
        value: 'Daily Bicycle Count (14-day avg shown as line)', 
        angle: -90, 
        position: 'insideLeft',
        offset: -5,
        style: { textAnchor: 'middle' }
      };
    }
  };

  return (
    <div 
      className="touch-pan-y relative"
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      style={{ touchAction: 'pan-y' }}
    >
      {/* Chart content with fade-in effect */}
      <div className={`transition-opacity duration-300 ${isChartReady ? 'opacity-100' : 'opacity-0'}`}>
        {title && <h3 className="text-lg font-semibold mb-4">{title}</h3>}
        
        {/* Year Checkboxes and Toggle */}
        <div className="mb-6 px-4 pt-2 border-b border-gray-200">
          {/* Row 1: Cumulative Toggle and Show/Hide All button */}
          <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
            {/* Cumulative Checkbox */}
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={showCumulative}
                onChange={() => setShowCumulative(!showCumulative)}
                className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
              />
              <span className="text-sm font-medium text-gray-700">Show cumulative</span>
            </label>
            
            <div className="flex items-center gap-2">
              {isZoomed && (
                <button
                  onClick={resetZoom}
                  className="px-3 py-1.5 text-sm bg-blue-50 hover:bg-blue-100 rounded-lg transition-colors duration-200 font-medium text-blue-700"
                >
                  Reset Zoom
                </button>
              )}

              {/* Show/Hide All button */}
              <button
                onClick={toggleAllYears}
                className="px-3 py-1.5 text-sm bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors duration-200 font-medium text-gray-700"
              >
                {allVisible ? 'Hide All' : 'Show All'}
              </button>
            </div>
          </div>
          
          {/* Row 2: Year checkboxes */}
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
          <ResponsiveContainer width="100%" height={540}>
            <LineChart
              data={yearOverYearData}
              margin={{ top: 20, right: 30, left: 30, bottom: 50 }}
              onMouseDown={handleZoomMouseDown}
              onMouseMove={handleChartMouseMove}
              onMouseUp={handleZoomMouseUp}
              onMouseLeave={handleChartMouseLeave}
            >
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis
                dataKey="displayDate"
                label={{ value: 'Date', position: 'insideBottom', offset: -5 }}
                angle={-45}
                textAnchor="end"
                height={80}
                interval={Math.max(0, Math.floor(visibleCount / 15))}
              />
              <YAxis 
                label={getYAxisLabel()}
              />
              <Tooltip 
                content={<CustomTooltip />} 
                cursor={{ stroke: '#ccc', strokeWidth: 1 }}
              />
              
              {showCumulative ? (
                // Cumulative view - show as lines
                availableYears.map(year => (
                  visibleYears[year] && (
                    <Line
                      key={`cumulative_${year}`}
                      type="monotone"
                      dataKey={`cumulative_${year}`}
                      stroke={getYearColor(year)}
                      strokeWidth={2.5}
                      dot={false}
                      name={`cumulative_${year}`}
                      connectNulls={false}
                      isAnimationActive={false}
                      animationDuration={0}
                    />
                  )
                ))
              ) : (
                // Daily view with scatter points and rolling average lines
                <>
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
                  
                  {/* Rolling average lines */}
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
                </>
              )}

              {/* Highlight while drag-selecting a zoom range */}
              {refAreaLeft && refAreaRight && (
                <ReferenceArea
                  x1={refAreaLeft}
                  x2={refAreaRight}
                  stroke="#3b82f6"
                  strokeOpacity={0.3}
                  fill="#3b82f6"
                  fillOpacity={0.1}
                />
              )}

              <Brush
                dataKey="displayDate"
                height={28}
                stroke="#9ca3af"
                fill="#f9fafb"
                travellerWidth={10}
                startIndex={zoomStart}
                endIndex={zoomEnd}
                onChange={(range) => {
                  if (range && range.startIndex !== undefined && range.endIndex !== undefined) {
                    setZoomRange({ startIndex: range.startIndex, endIndex: range.endIndex });
                  }
                }}
              />
            </LineChart>
          </ResponsiveContainer>
        )}
          
        <div className="text-center text-sm text-gray-500 mt-4 px-4 pb-4">
          {showCumulative ? (
            <p>Showing cumulative year-to-date bicycle counts. Lines show total trips accumulated throughout each year.</p>
          ) : (
            <p>Showing year-over-year comparison by day of year. Dots represent daily counts (transparent), lines show 14-day rolling average.</p>
          )}
          <p className="mt-1">Zoom in by dragging across the chart or using the slider below it. Use Reset Zoom to return to the full range.</p>
        </div>
      </div>
    </div>
  );
}