'use client';

import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Brush, Scatter } from 'recharts';

export default function CounterChart({ data, title, comparisonMode = false, selectedYears = [] }) {
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

  // Prepare year-over-year comparison data
  const getYearOverYearData = () => {
    if (!comparisonMode || selectedYears.length === 0) {
      return null;
    }

    const yearsData = {};
    const allDays = new Set();

    // Group data by year
    data.forEach(point => {
      const date = new Date(point.date);
      const year = date.getFullYear();
      const dayOfYear = getDayOfYear(date);
      
      if (selectedYears.includes(year.toString())) {
        if (!yearsData[year]) {
          yearsData[year] = new Map();
        }
        yearsData[year].set(dayOfYear, point.volume);
        allDays.add(dayOfYear);
      }
    });

    // Create array of day objects with values for each year
    const sortedDays = Array.from(allDays).sort((a, b) => a - b);
    
    return sortedDays.map(day => {
      const dataPoint = { dayOfYear: day, displayDate: getDateFromDayOfYear(day) };
      
      selectedYears.forEach(year => {
        const yearNum = parseInt(year);
        const value = yearsData[yearNum]?.get(day);
        if (value !== undefined) {
          dataPoint[`year_${year}`] = value;
        }
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

  // Custom tooltip formatter for regular view
  const CustomTooltip = ({ active, payload, label }) => {
    const isMobile = typeof window !== 'undefined' && window.innerWidth < 768;

    if (active && payload && payload.length) {
      if (comparisonMode) {
        // Comparison mode tooltip
        return (
          <div className={`bg-white p-3 border border-gray-300 rounded-lg shadow-lg font-sans ${
            isMobile ? 'max-w-[250px] mx-auto fixed bottom-4 left-1/2 transform -translate-x-1/2' : 'max-w-[280px]'
          }`} style={{zIndex: 9999}}>
            <p className="font-semibold text-gray-800 text-sm mb-2">
              {label}
            </p>
            {payload.map((entry, index) => (
              <p key={index} className="text-sm mt-1" style={{ color: entry.color }}>
                {entry.name}: <span className="font-semibold">{entry.value.toLocaleString()}</span> bicycles
              </p>
            ))}
          </div>
        );
      }
      
      // Regular view tooltip
      return (
        <div className={`bg-white p-3 border border-gray-300 rounded-lg shadow-lg font-sans ${
          isMobile ? 'max-w-[250px] mx-auto fixed bottom-4 left-1/2 transform -translate-x-1/2' : 'max-w-[280px]'
        }`} style={{zIndex: 9999}}>
          <p className="font-semibold text-gray-800 text-sm">
            {new Date(label).toLocaleDateString('en-US', { 
              weekday: 'long', 
              year: 'numeric', 
              month: 'long', 
              day: 'numeric' 
            })}
          </p>
          <p className="text-sm text-blue-600 mt-1">
            Daily: <span className="font-semibold">{payload && payload.length > 2 ? payload[2].value : ""} bicycles</span>
          </p>
          <p className="text-sm text-green-600">
            14-day Avg: <span className="font-semibold">{payload && payload.length > 0 ? payload[0].value: ""} bicycles</span>
          </p>
        </div>
      );
    }
    return null;
  };

  // Get colors for different years
  const getYearColor = (year) => {
    const colors = {
      '2020': '#8884d8',
      '2021': '#82ca9d',
      '2022': '#ffc658',
      '2023': '#ff7300',
      '2024': '#0088fe',
      '2025': '#00c49f',
      '2026': '#ffbb28'
    };
    return colors[year] || '#8884d8';
  };

  const yearOverYearData = getYearOverYearData();

  return (
    <div 
      className="touch-pan-y"
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      style={{ touchAction: 'pan-y' }}
    >
      {title && <h3 className="text-lg font-semibold mb-4">{title}</h3>}
      
      {comparisonMode && yearOverYearData ? (
        // Year-over-year comparison chart
        <ResponsiveContainer width="100%" height={450}>
          <LineChart 
            data={yearOverYearData} 
            margin={{ top: 5, right: 30, left: 20, bottom: 5 }}
          >
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis 
              dataKey="displayDate"
              label={{ value: 'Day of Year', position: 'insideBottom', offset: -5 }}
            />
            <YAxis label={{ value: 'Daily Bicycle Count', angle: -90, position: 'insideLeft' }} />
            <Tooltip content={<CustomTooltip />} />
            <Legend />
            {selectedYears.map(year => (
              <Line
                key={year}
                type="monotone"
                dataKey={`year_${year}`}
                stroke={getYearColor(year)}
                strokeWidth={2}
                dot={false}
                name={`${year}`}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      ) : (
        // Regular chart view
        <ResponsiveContainer width="100%" height={400}>
          <LineChart 
            data={data} 
            margin={{ top: 5, right: 30, left: 20, bottom: 5 }}
            onMouseDown={(e) => e.stopPropagation()}
            onMouseMove={(e) => e.stopPropagation()}
            onMouseUp={(e) => e.stopPropagation()}
          >
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis 
              dataKey="date" 
              tickFormatter={(value) => new Date(value).toLocaleDateString()}
              angle={-45}
              textAnchor="end"
              height={80}
            />
            <YAxis />
            <Tooltip content={<CustomTooltip />} />
            <Legend />
            <Scatter 
              dataKey="volume" 
              fill="#8884d8" 
              name="Daily Bicycle Count"
              fillOpacity={0.3}
            />
            <Line 
              type="monotone" 
              dataKey="rollingAverage" 
              stroke="#82ca9d" 
              strokeWidth={3}
              dot={false}
              name="14-day Rolling Average"
            />
            <Brush 
              dataKey="date"
              height={30}
              stroke="#8884d8"
              tickFormatter={(value) => new Date(value).toLocaleDateString()}
            />
          </LineChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}