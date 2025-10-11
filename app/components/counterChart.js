'use client';

import { useEffect } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Brush, Scatter } from 'recharts';

export default function CounterChart({ data, title }) {
    useEffect(()=>{console.log(data)},[data])
  if (!data || data.length === 0) {
    return <div className="text-center p-8 text-gray-500">No data available for this counter</div>;
  }

  // Custom tooltip formatter
  const CustomTooltip = ({ active, payload, label }) => {
    if (active && payload && payload.length) {
      return (
        <div className="bg-white p-4 border border-gray-300 rounded-lg shadow-lg font-sans">
          <p className="font-semibold text-gray-800">
            {new Date(label).toLocaleDateString('en-US', { 
              weekday: 'long', 
              year: 'numeric', 
              month: 'long', 
              day: 'numeric' 
            })}
          </p>
          <p className="text-sm text-blue-600">
            Daily: <span className="font-semibold">{payload[2].value} bicycles</span>
          </p>
          <p className="text-sm text-green-600">
            14-day Avg: <span className="font-semibold">{payload[0].value} bicycles</span>
          </p>
        </div>
      );
    }
    return null;
  };

  return (
    <div >
      {title && <h3 className="text-lg font-semibold mb-4">{title}</h3>}
      <ResponsiveContainer width="100%" height={400}>
        <LineChart data={data} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
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
          {/* Replace Line with Scatter for daily values */}
          <Scatter 
            dataKey="volume" 
            fill="#8884d8" 
            name="Daily Bicycle Count"
            fillOpacity={0.3}  // Makes points translucent (30% opacity)

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