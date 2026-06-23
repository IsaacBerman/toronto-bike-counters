// components/StationMap.js
'use client';

import { useState, useEffect, useRef } from 'react';
import { fetchStationList, fetchAllStationsActivity } from '../lib/stationDataUtils';

export default function StationMap({ onStationSelect }) {
  const [stations, setStations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const mapRef = useRef(null);
  const [mapInstance, setMapInstance] = useState(null);
  const [isMounted, setIsMounted] = useState(true);

  useEffect(() => {
    setIsMounted(true);
    return () => {
      setIsMounted(false);
      // Clean up map when component unmounts
      if (mapInstance) {
        mapInstance.remove();
        setMapInstance(null);
      }
    };
  }, []);

  useEffect(() => {
    async function loadStations() {
      try {
        setLoading(true);
        setError(null);
        
        // 1. Get station list
        const stationData = await fetchStationList();
        
        if (!stationData || stationData.length === 0) {
          setError('No stations found');
          setLoading(false);
          return;
        }
        
        // 2. Get activity for ALL stations in ONE request
        const today = new Date();
        const yesterday = new Date(today);
        yesterday.setDate(yesterday.getDate() - 14);
        console.log(yesterday)
        console.log(today)
        const allActivity = await fetchAllStationsActivity(yesterday, today);
        
        // 3. Group activity by station_id and calculate total trips
        const stationActivityMap = {};
        allActivity.forEach(item => {
          if (!stationActivityMap[item.station_id]) {
            stationActivityMap[item.station_id] = 0;
          }
          stationActivityMap[item.station_id] += item.trips || 0;
        });
        
        // 4. Combine station info with activity data
        const stationsWithActivity = stationData.map(station => ({
          ...station,
          dailyTrips: stationActivityMap[station.station_id]/14 || 0,
          coordinates: [station.lon, station.lat]
        }));
        
        if (isMounted) {
          setStations(stationsWithActivity);
          setLoading(false);
        }
      } catch (err) {
        console.error('Error loading stations:', err);
        if (isMounted) {
          setError('Failed to load station data. Please try again later.');
          setLoading(false);
        }
      }
    }
    
    loadStations();
  }, [isMounted]);

  // Initialize Leaflet map
  useEffect(() => {
    // Only initialize map if we have stations, no map instance yet, map ref is available, and component is mounted
    if (!loading && stations.length > 0 && !mapInstance && mapRef.current && isMounted) {
      try {
        // Dynamically import Leaflet only on client side
        import('leaflet').then((L) => {
          // Import CSS
          import('leaflet/dist/leaflet.css');
          
          // Check if map container still exists
          if (!mapRef.current) {
            console.warn('Map container not found');
            return;
          }
          
          const map = L.map(mapRef.current, {
            center: [43.6532, -79.3832],
            zoom: 12
          });
          
          L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '© OpenStreetMap contributors'
          }).addTo(map);
          
          // Add markers
          const maxTrips = Math.max(...stations.map(s => s.dailyTrips || 0), 1);
          
          stations.forEach(station => {
            const radius = !station.dailyTrips ? 6 : 8 + (station.dailyTrips / maxTrips) * 20;
            const color = station.dailyTrips > 400 ? '#dc2626' : 
                         station.dailyTrips > 200 ? '#f59e0b' : 
                         station.dailyTrips > 100 ? '#ffff00' : 
                         station.dailyTrips > 50 ? '#00ff00' :
                         station.dailyTrips > 0 ? '#3b82f6' :  "#000";
            
            const marker = L.circleMarker([station.lat, station.lon], {
              radius: radius,
              fillColor: color,
              color: '#000',
              weight: 1,
              opacity: 1,
              fillOpacity: 0.7
            }).addTo(map);
            
            marker.bindPopup(`
              <div class="p-2">
                <h3 class="font-bold text-sm">${station.name || station.station_id}</h3>
                <p class="text-xs">Trips (24h): ${station.dailyTrips || 0}</p>
                <button 
                  onclick="window.handleStationClick('${station.station_id}')"
                  class="mt-1 bg-blue-500 text-white text-xs px-2 py-1 rounded hover:bg-blue-600"
                >
                  View History
                </button>
              </div>
            `);
            
            marker.on('click', () => {
              onStationSelect(station.station_id);
            });
          });
          
          if (isMounted) {
            setMapInstance(map);
          }
        }).catch(err => {
          console.error('Error loading Leaflet:', err);
          if (isMounted) {
            setError('Failed to load map');
          }
        });
      } catch (err) {
        console.error('Error initializing map:', err);
        if (isMounted) {
          setError('Failed to initialize map');
        }
      }
    }
    
    // Cleanup
    return () => {
      if (mapInstance) {
        try {
          mapInstance.remove();
        } catch (e) {
          console.warn('Error removing map instance:', e);
        }
        setMapInstance(null);
      }
    };
  }, [loading, stations, onStationSelect, isMounted]);

  // Expose station click handler to global scope for popup buttons
  useEffect(() => {
    window.handleStationClick = (stationId) => {
      onStationSelect(stationId);
    };
    
    return () => {
      delete window.handleStationClick;
    };
  }, [onStationSelect]);

  // Loading state
  if (loading) {
    return (
      <div className="h-96 bg-gray-100 rounded-lg flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-2"></div>
          <p className="text-gray-500">Loading stations...</p>
        </div>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="h-96 bg-gray-100 rounded-lg flex items-center justify-center">
        <div className="text-center text-red-600">
          <p className="font-semibold">Error loading map</p>
          <p className="text-sm">{error}</p>
        </div>
      </div>
    );
  }

  // No stations state
  if (stations.length === 0) {
    return (
      <div className="h-96 bg-gray-100 rounded-lg flex items-center justify-center">
        <p className="text-gray-500">No stations available</p>
      </div>
    );
  }

  // Render map with a key to force remount when needed
  return (
    <div className="relative">
      <div key="station-map-container" ref={mapRef} className="h-96 w-full rounded-lg border border-gray-200" />
      <div className="absolute bottom-4 left-4 bg-white p-2 rounded-lg shadow-lg text-xs">
        <div className="flex items-center gap-2">
          <span className="w-3 h-3 rounded-full bg-blue-500 inline-block"></span>
          <span>Low (0-500 trips)</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-3 h-3 rounded-full bg-yellow-500 inline-block"></span>
          <span>Medium (500-1000 trips)</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-3 h-3 rounded-full bg-red-500 inline-block"></span>
          <span>High (1000+ trips)</span>
        </div>
      </div>
    </div>
  );
}