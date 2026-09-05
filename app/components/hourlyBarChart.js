// hourlyBarChart.js
'use client';

import { useState, useEffect, useMemo } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, LineChart, Line } from 'recharts';
import useTapAwayDismiss from '../lib/useTapAwayDismiss';

// Helper function to get current time in EST
const getCurrentESTTime = () => {
  const now = new Date();
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Toronto',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hour12: false
  });
  
  const parts = formatter.formatToParts(now);
  const dateParts = {};
  parts.forEach(part => {
    dateParts[part.type] = part.value;
  });
  
  return {
    year: parseInt(dateParts.year),
    month: parseInt(dateParts.month),
    day: parseInt(dateParts.day),
    hour: parseInt(dateParts.hour),
    date: new Date(dateParts.year, parseInt(dateParts.month) - 1, dateParts.day),
    timestamp: now.getTime()
  };
};

// Helper to get EST date string in YYYY-MM-DD format
const getESTDateString = (date = new Date()) => {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Toronto',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
  return formatter.format(date);
};

export default function HourlyBarChart({ data }) {
  const [isChartReady, setIsChartReady] = useState(false);
  const [chartType, setChartType] = useState('bar');
  const [averages, setAverages] = useState([]);
  const [lastYearAverages, setLastYearAverages] = useState([]);
  const [currentDayData, setCurrentDayData] = useState([]);
  const [cumulativeData, setCumulativeData] = useState([]);
  const [activeTooltip, setActiveTooltip] = useState(null);
  const [currentESTTime, setCurrentESTTime] = useState(null);
  const { chartRef, tooltipActive, restoreTooltip } = useTapAwayDismiss();

  useEffect(() => {
    setIsChartReady(false);

    console.log('HourlyBarChart received data:', data);
    
    // Get current EST time
    const estTime = getCurrentESTTime();
    setCurrentESTTime(estTime);
    
    // Check if data exists and has the expected structure
    if (!data || !data.currentYear || !Array.isArray(data.currentYear)) {
      console.error('Invalid data structure:', data);
      setIsChartReady(true);
      return;
    }
    
    if (data.currentYear.length === 0) {
      console.log('No current year data');
      setIsChartReady(true);
      return;
    }
    
    const today = getESTDateString(); // Returns YYYY-MM-DD format in EST
    const currentHour = estTime.hour;
    
    console.log('Today (EST):', today, 'Current Hour (EST):', currentHour);
    
    // Process current year data (already processed from dataUtils)
    const currentYearPoints = data.currentYear;
    
    // Process last year data (already processed from dataUtils)
    const lastYearPoints = data.lastYear || [];
    
    // Calculate averages for current period (excluding today)
    const hourMapCurrent = {};
    for (let i = 0; i < 24; i++) {
      hourMapCurrent[i] = { total: 0, count: 0 };
    }
    
    currentYearPoints.forEach(point => {
      if (point.date !== today && !point.isFutureHour && point.volume > 0) {
        hourMapCurrent[point.hour].total += point.volume;
        hourMapCurrent[point.hour].count++;
      }
    });
    
    const calculatedAverages = Object.keys(hourMapCurrent).map(hour => ({
      hour: parseInt(hour),
      displayHour: `${hour}:00`,
      averageTrips: hourMapCurrent[hour].count > 0 ? Math.round(hourMapCurrent[hour].total / hourMapCurrent[hour].count) : 0
    }));
    
    // Calculate averages for last year
    const hourMapLastYear = {};
    for (let i = 0; i < 24; i++) {
      hourMapLastYear[i] = { total: 0, count: 0 };
    }
    
    lastYearPoints.forEach(point => {
      if (point.volume > 0) {
        hourMapLastYear[point.hour].total += point.volume;
        hourMapLastYear[point.hour].count++;
      }
    });
    
    const calculatedLastYearAverages = Object.keys(hourMapLastYear).map(hour => ({
      hour: parseInt(hour),
      displayHour: `${hour}:00`,
      averageTrips: hourMapLastYear[hour].count > 0 ? Math.round(hourMapLastYear[hour].total / hourMapLastYear[hour].count) : 0
    }));
    
    // Get current day data
    const currentData = {};
    for (let i = 0; i <= currentHour; i++) {
      currentData[i] = 0;
    }
    
    currentYearPoints.forEach(point => {
      if (point.date === today && point.hour <= currentHour && point.volume > 0) {
        currentData[point.hour] = point.volume;
      }
    });
    
    const calculatedCurrentDay = Object.keys(currentData).map(hour => ({
      hour: parseInt(hour),
      displayHour: `${hour}:00`,
      currentTrips: currentData[hour]
    }));

    console.log('Current day data:', calculatedCurrentDay);
    
    setAverages(calculatedAverages);
    setLastYearAverages(calculatedLastYearAverages);
    setCurrentDayData(calculatedCurrentDay);
    
    // Calculate cumulative data
    let currentSum = 0;
    let avgSum = 0;
    let lastYearSum = 0;
    
    const cumulative = [];
    for (let hour = 0; hour <= currentHour; hour++) {
      const currentHourData = calculatedCurrentDay.find(c => c.hour === hour);
      const avgHourData = calculatedAverages.find(a => a.hour === hour);
      const lastYearHourData = calculatedLastYearAverages.find(l => l.hour === hour);
      
      if (currentHourData) currentSum += currentHourData.currentTrips;
      if (avgHourData) avgSum += avgHourData.averageTrips;
      if (lastYearHourData) lastYearSum += lastYearHourData.averageTrips;
      
      cumulative.push({
        hour: `${hour}:00`,
        currentCumulative: currentSum,
        avgCumulative: avgSum,
        lastYearCumulative: lastYearSum,
        hourValue: hour
      });
    }
    
    setCumulativeData(cumulative);
    
    const timer = setTimeout(() => {
      setIsChartReady(true);
    }, 100);
    return () => clearTimeout(timer);
  }, [data]);

  // Combine data for bar chart
  const barChartData = useMemo(() => {
    const currentHour = currentESTTime?.hour || 0;
    return averages.map(avg => {
      const current = currentDayData.find(c => c.hour === avg.hour);
      const lastYear = lastYearAverages.find(l => l.hour === avg.hour);
      return {
        hour: avg.displayHour,
        todayTrips: current ? current.currentTrips : 0,
        avgTrips: avg.averageTrips,
        lastYearAvgTrips: lastYear ? lastYear.averageTrips : 0,
        hourValue: avg.hour
      };
    }).filter(item => item.hourValue <= currentHour);
  }, [averages, currentDayData, lastYearAverages, currentESTTime]);

  // Handle tooltip visibility for mobile
  const handleChartMouseMove = (state) => {
    restoreTooltip();
    if (state && state.isTooltipActive) {
      setActiveTooltip(true);
    } else if (activeTooltip) {
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

  // Custom legend content component
  const renderLegend = (props) => {
    const { payload } = props;
    return (
      <div className="absolute top-10 left-30 bg-white/90 backdrop-blur-sm rounded-lg shadow-md p-2 z-10 border border-gray-200">
        <div className="space-y-1">
          {payload.map((entry, index) => (
            <div key={`item-${index}`} className="flex items-center gap-2 text-xs">
              <div 
                className="w-3 h-3 rounded-full" 
                style={{ backgroundColor: entry.color }}
              />
              <span className="text-gray-700 font-medium">{entry.value}</span>
            </div>
          ))}
        </div>
      </div>
    );
  };

  // Custom tooltip for bar chart
  const BarTooltip = ({ active, payload, label }) => {
    if (active && payload && payload.length) {
      const todayValue = payload.find(p => p.dataKey === 'todayTrips')?.value || 0;
      const avgValue = payload.find(p => p.dataKey === 'avgTrips')?.value || 0;
      const lastYearValue = payload.find(p => p.dataKey === 'lastYearAvgTrips')?.value || 0;
      
      const vsAvgDiff = todayValue - avgValue;
      const vsAvgPercent = avgValue > 0 ? ((vsAvgDiff / avgValue) * 100).toFixed(1) : 0;
      const vsLastYearDiff = todayValue - lastYearValue;
      const vsLastYearPercent = lastYearValue > 0 ? ((vsLastYearDiff / lastYearValue) * 100).toFixed(1) : 0;
      
      return (
        <div className="bg-white p-3 border border-gray-300 rounded-lg shadow-lg max-w-[280px]">
          <p className="font-semibold text-gray-800 text-sm mb-2">
            Hour: {label}
          </p>
          <p className="text-sm text-blue-600 mb-1">
            <span className="font-semibold">Today:</span> {todayValue.toLocaleString()} trips
          </p>
          <p className="text-sm text-green-600 mb-1">
            <span className="font-semibold">2-Week Avg:</span> {avgValue.toLocaleString()} trips
            <span className={`ml-2 text-xs ${vsAvgDiff >= 0 ? 'text-green-600' : 'text-red-600'}`}>
              ({vsAvgDiff >= 0 ? '↑' : '↓'} {Math.abs(vsAvgDiff).toLocaleString()}, {vsAvgPercent}%)
            </span>
          </p>
          <p className="text-sm text-purple-600">
            <span className="font-semibold">Last Year Avg:</span> {lastYearValue.toLocaleString()} trips
            <span className={`ml-2 text-xs ${vsLastYearDiff >= 0 ? 'text-green-600' : 'text-red-600'}`}>
              ({vsLastYearDiff >= 0 ? '↑' : '↓'} {Math.abs(vsLastYearDiff).toLocaleString()}, {vsLastYearPercent}%)
            </span>
          </p>
        </div>
      );
    }
    return null;
  };

  // Custom tooltip for cumulative line chart
  const CumulativeTooltip = ({ active, payload, label }) => {
    if (active && payload && payload.length) {
      const currentValue = payload.find(p => p.dataKey === 'currentCumulative')?.value || 0;
      const avgValue = payload.find(p => p.dataKey === 'avgCumulative')?.value || 0;
      const lastYearValue = payload.find(p => p.dataKey === 'lastYearCumulative')?.value || 0;
      
      const vsAvgDiff = currentValue - avgValue;
      const vsAvgPercent = avgValue > 0 ? ((vsAvgDiff / avgValue) * 100).toFixed(1) : 0;
      const vsLastYearDiff = currentValue - lastYearValue;
      const vsLastYearPercent = lastYearValue > 0 ? ((vsLastYearDiff / lastYearValue) * 100).toFixed(1) : 0;
      
      return (
        <div className="bg-white p-3 border border-gray-300 rounded-lg shadow-lg max-w-[280px]">
          <p className="font-semibold text-gray-800 text-sm mb-2">
            By {label}
          </p>
          <p className="text-sm text-blue-600 mb-1">
            <span className="font-semibold">Today Total:</span> {currentValue.toLocaleString()} trips
          </p>
          <p className="text-sm text-green-600 mb-1">
            <span className="font-semibold">2-Week Avg Total:</span> {avgValue.toLocaleString()} trips
            <span className={`ml-2 text-xs ${vsAvgDiff >= 0 ? 'text-green-600' : 'text-red-600'}`}>
              ({vsAvgDiff >= 0 ? '↑' : '↓'} {Math.abs(vsAvgDiff).toLocaleString()}, {vsAvgPercent}%)
            </span>
          </p>
          <p className="text-sm text-purple-600">
            <span className="font-semibold">Last Year Avg Total:</span> {lastYearValue.toLocaleString()} trips
            <span className={`ml-2 text-xs ${vsLastYearDiff >= 0 ? 'text-green-600' : 'text-red-600'}`}>
              ({vsLastYearDiff >= 0 ? '↑' : '↓'} {Math.abs(vsLastYearDiff).toLocaleString()}, {vsLastYearPercent}%)
            </span>
          </p>
        </div>
      );
    }
    return null;
  };

  // Check if we have valid data to display
  const hasValidData = data && data.currentYear && Array.isArray(data.currentYear) && data.currentYear.length > 0;
  
  if (!hasValidData) {
    return (
      <div className="text-center p-8 text-gray-500">
        Loading hourly data...
      </div>
    );
  }

  return (
    <div ref={chartRef} className="touch-pan-y relative">
      <div className="flex items-center gap-2 px-4 pt-4">
        <label className="flex items-center gap-2 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={chartType === 'cumulative'}
            onChange={() => setChartType(chartType === 'bar' ? 'cumulative' : 'bar')}
            className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
          />
          <span className="text-sm font-medium text-gray-700">Show cumulative</span>
        </label>
      </div>

      <div className={`transition-opacity duration-300 relative ${isChartReady ? 'opacity-100' : 'opacity-0'}`}>
        {chartType === 'bar' ? (
          <div className="relative">
            <ResponsiveContainer width="100%" height={500}>
              <BarChart 
                data={barChartData} 
                margin={{ top: 20, right: 30, left: 30, bottom: 60 }}
                onMouseMove={handleChartMouseMove}
                onTouchMove={restoreTooltip}
                onMouseLeave={handleChartMouseLeave}
              >
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis 
                  dataKey="hour"
                  label={{ value: 'Hour of Day (EST)', position: 'insideBottom', offset: -5 }}
                  angle={-45}
                  textAnchor="end"
                  height={80}
                  interval={0}
                  tick={{ fontSize: 11 }}
                />
                <YAxis 
                  label={{ value: 'Number of Trips', angle: -90, position: 'insideLeft', offset: -5 }}
                />
                <Tooltip 
                  content={<BarTooltip />} 
                  active={tooltipActive}
                  wrapperStyle={{ zIndex: 1000 }}
                  cursor={{ stroke: '#ccc', strokeWidth: 1 }}
                />
                <Legend 
                  content={renderLegend}
                  verticalAlign="top"
                  align="left"
                  wrapperStyle={{ 
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    zIndex: 10,
                    backgroundColor: 'transparent'
                  }}
                />
                <Bar 
                  dataKey="todayTrips" 
                  fill="#3b82f6" 
                  name="Today's Trips"
                  radius={[4, 4, 0, 0]}
                />
                <Bar 
                  dataKey="avgTrips" 
                  fill="#10b981" 
                  name="2-Week Average"
                  radius={[4, 4, 0, 0]}
                />
                <Bar 
                  dataKey="lastYearAvgTrips" 
                  fill="#a855f7" 
                  name="Last Year Average"
                  radius={[4, 4, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <div className="relative">
            <ResponsiveContainer width="100%" height={500}>
              <LineChart 
                data={cumulativeData} 
                margin={{ top: 20, right: 30, left: 30, bottom: 60 }}
                onMouseMove={handleChartMouseMove}
                onTouchMove={restoreTooltip}
                onMouseLeave={handleChartMouseLeave}
              >
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis 
                  dataKey="hour"
                  label={{ value: 'Hour of Day (EST)', position: 'insideBottom', offset: -5 }}
                  angle={-45}
                  textAnchor="end"
                  height={80}
                  interval={0}
                  tick={{ fontSize: 11 }}
                />
                <YAxis 
                  label={{ value: 'Cumulative Trips', angle: -90, position: 'insideLeft', offset: -5 }}
                />
                <Tooltip 
                  content={<CumulativeTooltip />} 
                  active={tooltipActive}
                  wrapperStyle={{ zIndex: 1000 }}
                  cursor={{ stroke: '#ccc', strokeWidth: 1 }}
                />
                <Legend 
                  content={renderLegend}
                  verticalAlign="top"
                  align="left"
                  wrapperStyle={{ 
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    zIndex: 10,
                    backgroundColor: 'transparent'
                  }}
                />
                <Line 
                  type="monotone" 
                  dataKey="currentCumulative" 
                  stroke="#3b82f6" 
                  strokeWidth={3}
                  dot={{ r: 4 }}
                  name="Today's Cumulative"
                />
                <Line 
                  type="monotone" 
                  dataKey="avgCumulative" 
                  stroke="#10b981" 
                  strokeWidth={3}
                  dot={{ r: 4 }}
                  name="2-Week Average Cumulative"
                />
                <Line 
                  type="monotone" 
                  dataKey="lastYearCumulative" 
                  stroke="#a855f7" 
                  strokeWidth={3}
                  dot={{ r: 4 }}
                  name="Last Year Average Cumulative"
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    </div>
  );
}