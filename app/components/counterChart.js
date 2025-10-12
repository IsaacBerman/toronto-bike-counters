'use client';

import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Brush, Scatter } from 'recharts';

export default function CounterChart({ data, title }) {
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

  // Custom tooltip formatter
  const CustomTooltip = ({ active, payload, label }) => {
    const isMobile = typeof window !== 'undefined' && window.innerWidth < 768;

    if (active && payload && payload.length) {
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

  return (
    <div 
      className="touch-pan-y" // Allow vertical panning/scroll, block horizontal
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      style={{ touchAction: 'pan-y' }} // CSS solution - allow vertical scroll only
    >
      {title && <h3 className="text-lg font-semibold mb-4">{title}</h3>}
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
          <Tooltip content={<CustomTooltip /> } />
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
    </div>
  );
}