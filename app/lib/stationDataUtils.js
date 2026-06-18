// lib/stationDataUtils.js

export async function fetchStationList() {
  try {
    const response = await fetch(
      'https://api.raccoon.bike/stations?system=bike_share_toronto'
    );
    if (!response.ok) throw new Error('Failed to fetch stations');
    const data = await response.json();
    return data.data || [];
  } catch (error) {
    console.error('Error loading stations:', error);
    return [];
  }
}

// NEW: Fetch activity for ALL stations at once
export async function fetchAllStationsActivity(startDate, endDate) {
  try {
    const startStr = formatDateForAPI(startDate);
    const endStr = formatDateForAPI(endDate);
    
    // Use station=all to get all stations in one request
    const url = `https://api.raccoon.bike/activity?system=bike_share_toronto&feed=station&start=${startStr}&end=${endStr}&frequency=d&station=all&key=YIOJaaLtLdazfrG7GVwcyAybB2WfpmSaxtCUx6gxLBw`;
    
    const response = await fetch(url);
    if (!response.ok) throw new Error('Failed to fetch station activity');
    const data = await response.json();
    
    // The data will be an array with all stations' activity
    // Each item has: { station_id, datetime, trips, returns }
    return data.data || [];
  } catch (error) {
    console.error('Error loading station activity:', error);
    return [];
  }
}

// Individual station fetch (kept for the detail view)
export async function fetchStationActivity(stationId, startDate, endDate) {
  try {
    const startStr = formatDateForAPI(startDate);
    const endStr = formatDateForAPI(endDate);
    const url = `https://api.raccoon.bike/activity?system=bike_share_toronto&feed=station&start=${startStr}&end=${endStr}&frequency=d&station=${stationId}&key=YIOJaaLtLdazfrG7GVwcyAybB2WfpmSaxtCUx6gxLBw`;
    
    const response = await fetch(url);
    if (!response.ok) throw new Error('Failed to fetch station activity');
    const data = await response.json();
    return data.data || [];
  } catch (error) {
    console.error('Error loading station activity:', error);
    return [];
  }
}

function formatDateForAPI(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}${month}${day}00`;
}