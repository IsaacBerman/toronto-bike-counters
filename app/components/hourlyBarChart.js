// hourlyBarChart.js
'use client';

import { useState, useEffect, useMemo } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, LineChart, Line } from 'recharts';

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
    timestamp: now.getTime() // Keep original timestamp for reference
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

// Helper to get EST hour (0-23)
const getESTHour = (date = new Date()) => {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Toronto',
    hour: '2-digit',
    hour12: false
  });
  return parseInt(formatter.format(date));
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

  useEffect(() => {
    setIsChartReady(false);

    console.log(data);
    
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
      setIsChartReady(true);
      return;
    }
    
    const today = getESTDateString(); // Returns YYYY-MM-DD format in EST
    const currentHour = estTime.hour;
    
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
    console.log(today);
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

    console.log(calculatedCurrentDay);
    
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

  // Check if we have valid data to display
  const hasValidData = data && data.currentYear && Array.isArray(data.currentYear) && data.currentYear.length > 0;
  
  if (!hasValidData) {
    return (
      <div className="text-center p-8 text-gray-500">
        Loading...
      </div>
    );
  }

  // Rest of your component remains the same...
  // (Custom legend, tooltip, etc. unchanged)
  
  const currentHour = currentESTTime?.hour || 0;

  return (
    <div className="touch-pan-y relative">
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
                onMouseLeave={handleChartMouseLeave}
              >
                {/* ... rest of your chart configuration ... */}
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
                onMouseLeave={handleChartMouseLeave}
              >
                {/* ... rest of your chart configuration ... */}
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    </div>
  );
}