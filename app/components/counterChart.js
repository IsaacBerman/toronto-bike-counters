// counterChart.js
'use client';

import { useState, useEffect } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Scatter } from 'recharts';
import useTapAwayDismiss from '../lib/useTapAwayDismiss';

export default function CounterChart({ data, title, measureLabel }) {
  const [visibleYears, setVisibleYears] = useState({});
  const [isChartReady, setIsChartReady] = useState(false);
  const [showCumulative, setShowCumulative] = useState(false);
  const [activeTooltip, setActiveTooltip] = useState(null);
  const { chartRef, tooltipActive, restoreTooltip } = useTapAwayDismiss();

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
    restoreTooltip();
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
  };

  // Custom tooltip formatter
  const CustomTooltip = ({ active, payload, label }) => {
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
        // Positioned by Recharts, which flips it to whichever side of the
        // hovered point has room — on a phone as well as on a desktop. The
        // phone box has to stay under half the plot width for there to be a
        // side to flip to, which is why the labels below shed everything the
        // chart header already tells you; globals.css lends it the axis gutter
        // for the points where even that is a squeeze.
        <div className="bg-white p-2 md:p-3 border border-gray-300 rounded-lg shadow-lg font-sans max-w-[120px] md:max-w-[280px]" style={{zIndex: 9999}}>
          <p className="font-semibold text-gray-800 text-xs md:text-sm mb-1 md:mb-2">
            {label}
          </p>
          {yearData.map(({year, value, dailyValue}) => (
            <div key={year} className="mb-1">
              <p className="text-[11px] md:text-sm" style={{ color: getYearColor(year) }}>
                <span className="font-semibold">{year}:</span>
                <span className="ml-1 md:ml-2">
                  {showCumulative ? (
                    <><span className="hidden md:inline">Cumulative: </span><span className="font-semibold">{value.toLocaleString()}</span></>
                  ) : (
                    <><span className="hidden md:inline">14-day </span>avg: <span className="font-semibold">{value.toLocaleString()}</span></>
                  )}
                </span>
                {!showCumulative && dailyValue && dailyValue > 0 && (
                  <span className="ml-1 md:ml-2 text-gray-600">(daily: {dailyValue.toLocaleString()})</span>
                )}
              </p>
            </div>
          ))}
        </div>
      );
    }
    return null;
  };

  // Get colors for different years.
  //
  // Distinct hues, not a ramp — years here are toggled and compared in any
  // combination, so any two can end up adjacent. These eleven were solved
  // against the all-pairs gate (the hard one: every pair, not just neighbours)
  // and validated on a white surface — worst pair CVD ΔE 8.3, normal-vision
  // ΔE 16.0, all eleven ≥3:1 contrast. Re-validate before editing a value.
  //
  // Counters reach back to 1994, well past what any palette can keep distinct;
  // those older years keep the previous deterministic fallback, and identity
  // there rests on the labelled swatches and the tooltip rather than hue alone.
  const getYearColor = (year) => {
    const colors = {
      2016: '#fe516b',
      2017: '#a92501',
      2018: '#a07a0c',
      2019: '#00633c',
      2020: '#01a38f',
      2021: '#006fa9',
      2022: '#1d3cff',
      2023: '#8688ff',
      2024: '#6803bf',
      2025: '#ff35de',
      2026: '#b8067e'
    };

    if (colors[year]) return colors[year];

    // Otherwise generate a consistent random color based on year
    const hash = year.toString().split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
    const hue = hash % 360;
    return `hsl(${hue}, 70%, 50%)`;
  };

  const yearOverYearData = getYearOverYearData();
  
  // Calculate if any years are visible
  const hasVisibleYears = Object.values(visibleYears).some(v => v === true);
  const allVisible = Object.values(visibleYears).length > 0 && Object.values(visibleYears).every(v => v === true);

  // Get Y-axis label based on mode. `measureLabel` names the active trip-type
  // filter so the axis says what is actually being counted.
  const measure = measureLabel || 'Bicycle';
  const getYAxisLabel = () => {
    return {
      value: showCumulative
        ? `Cumulative Year-to-Date ${measure} Count`
        : `Daily ${measure} Count (14-day avg shown as line)`,
      angle: -90,
      position: 'insideLeft',
      // Sits clear of the tick numbers rather than crowding them; the chart's
      // left margin below reserves the room this needs.
      offset: -18,
      style: { textAnchor: 'middle' }
    };
  };

  return (
    <div 
      ref={chartRef}
      className="counter-chart touch-pan-y relative"
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
            
            {/* Show/Hide All button */}
            <button
              onClick={toggleAllYears}
              className="px-3 py-1.5 text-sm bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors duration-200 font-medium text-gray-700"
            >
              {allVisible ? 'Hide All' : 'Show All'}
            </button>
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
          <ResponsiveContainer width="100%" height={500}>
            <LineChart 
              data={yearOverYearData} 
              margin={{ top: 20, right: 30, left: 48, bottom: 50 }}
              onMouseMove={handleChartMouseMove}
              onTouchMove={restoreTooltip}
              onMouseLeave={handleChartMouseLeave}
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
                label={getYAxisLabel()}
              />
              <Tooltip 
                content={<CustomTooltip />} 
                active={tooltipActive}
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
            </LineChart>
          </ResponsiveContainer>
        )}
          
        <div className="text-center text-sm text-gray-500 mt-4 px-4 pb-4">
          {showCumulative ? (
            <p>Showing cumulative year-to-date bicycle counts. Lines show total trips accumulated throughout each year.</p>
          ) : (
            <p>Showing year-over-year comparison by day of year. Dots represent daily counts (transparent), lines show 14-day rolling average.</p>
          )}
        </div>
      </div>
    </div>
  );
}