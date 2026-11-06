// components/StationDetail.js
'use client';

import { useState, useEffect } from 'react';
import { fetchStationActivity, fetchStationsActivity, fetchStationList } from '../lib/stationDataUtils';
import CounterChart from './counterChart';

// One station (`stationId`), or the summed trips of several (`stationIds`,
// from the areas drawn on the station map).
export default function StationDetail({ stationId, stationIds, onBack }) {
  const isGroup = Array.isArray(stationIds);
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [stationName, setStationName] = useState('');
  const [stationInfo, setStationInfo] = useState(null);
  const [archiveEnd, setArchiveEnd] = useState(null);

  useEffect(() => {
    async function loadStationData() {
      if (isGroup ? stationIds.length === 0 : !stationId) return;

      setLoading(true);

      if (isGroup) {
        const endDate = new Date();
        const startDate = new Date(endDate);
        startDate.setFullYear(startDate.getFullYear() - 7);
        const { rows, archiveEnd } = await fetchStationsActivity(stationIds, startDate, endDate);
        setStationName(`${stationIds.length} ${stationIds.length === 1 ? 'station' : 'stations'}`);
        setStationInfo(null);
        setArchiveEnd(archiveEnd);
        setData(toChartData(rows));
        setLoading(false);
        return;
      }
      
      // Fetch station name from the stations list
      try {
        const stations = await fetchStationList();
        const station = stations.find(s => s.station_id === stationId);
        if (station) {
          setStationName(station.name || stationId);
          setStationInfo(station);
        } else {
          setStationName(stationId);
        }
      } catch (error) {
        console.error('Error fetching station name:', error);
        setStationName(stationId);
      }
      
      // Fetch activity data
      const endDate = new Date();
      const startDate = new Date(endDate);
      startDate.setFullYear(startDate.getFullYear() - 7);
      
      const { rows: activity, archiveEnd } = await fetchStationActivity(stationId, startDate, endDate);
      setArchiveEnd(archiveEnd);
      
      setData(toChartData(activity));
      setLoading(false);
    }
    loadStationData();
    // stationIds is a fresh array per selection, so its contents are the key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stationId, isGroup ? stationIds.join(',') : null]);

  if (loading) {
    return (
      <div className="bg-white rounded-2xl shadow-lg p-8">
        <div className="text-center">
          <p className="text-black">Loading station data...</p>
        </div>
      </div>
    );
  }

  // Format station address if available
  const getStationAddress = () => {
    if (!stationInfo) return '';
    const parts = [];
    if (stationInfo.address) parts.push(stationInfo.address);
    if (stationInfo.cross_street) parts.push(stationInfo.cross_street);
    return parts.join(' • ');
  };

  return (
    <div className="bg-white rounded-2xl shadow-lg overflow-hidden">
      <div className="p-4 border-b border-gray-100 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
        <div>
          <h2 className="text-xl font-bold text-black">
            {stationName}
          </h2>
          <p className="text-sm text-black/70">
            {isGroup ? 'Combined trips from the stations in your areas' : `Station ID: ${stationId}`}
          </p>
          {getStationAddress() && (
            <p className="text-xs text-black/60 mt-0.5">
              {getStationAddress()}
            </p>
          )}
          <p className="text-xs text-black/50 mt-1">
            Last 7 years of activity
          </p>
        </div>
        <button
          onClick={onBack}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition-colors duration-200 shadow-sm hover:shadow"
        >
          ← Back to Map
        </button>
      </div>
      <div className="p-4">
        {data.length > 0 ? (
          <>
            <CounterChart data={data}  />
            <p className="text-xs mt-2" style={{ color: 'var(--ink-3)' }}>
              {archiveEnd ? (
                <>
                  Trips to {formatLongDate(archiveEnd)} are rider trips from the{' '}
                  <a
                    href="https://open.toronto.ca/dataset/bike-share-toronto-ridership-data/"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="dd-link-accent"
                  >
                    City of Toronto ridership data
                  </a>
                  . Later days are bikeraccoon estimates from dock counts, which also count
                  bikes moved by staff.
                </>
              ) : (
                <>
                  All days are bikeraccoon estimates from dock counts, which also count bikes
                  moved by staff.
                </>
              )}
            </p>
          </>
        ) : (
          <p className="text-center text-black/60 py-8">
            No data available for {isGroup ? 'these stations' : 'this station'}
          </p>
        )}
      </div>
    </div>
  );
}

// Activity rows -> CounterChart points, oldest first.
function toChartData(rows) {
  return rows.map(point => ({
    date: point.datetime.split('T')[0],
    volume: point.trips,
    timestamp: new Date(point.datetime).getTime()
  })).sort((a, b) => a.timestamp - b.timestamp);
}

// "2026-09-30" -> "September 30, 2026"
function formatLongDate(dateKey) {
  return new Date(`${dateKey}T00:00:00`).toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}
