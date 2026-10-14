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

// Individual station fetch (kept for the detail view).
//
// Days the City's trip archive covers come from it (see
// scripts/build-bikeshare-stations.mjs); only days after it come from
// bikeraccoon. bikeraccoon infers trips from dock counts, so it also counts
// rebalancing moves, which swamp the rider trips at some stations. Archive
// rows carry departures only, so their `returns` is null. `archiveEnd` is the
// archive's last day, or null if this station has no archive file.
export async function fetchStationActivity(stationId, startDate, endDate) {
  const archive = await fetchStationArchive(stationId);
  const archived = [];
  let raccoonStart = startDate;
  if (archive) {
    const first = formatDateKey(startDate);
    archive.trips.forEach((trips, i) => {
      const date = addDays(archive.start, i);
      if (date >= first) archived.push({ station_id: String(stationId), datetime: `${date}T00:00:00`, trips, returns: null });
    });
    const after = new Date(`${addDays(archive.end, 1)}T00:00:00`);
    if (after > raccoonStart) raccoonStart = after;
  }
  const archiveEnd = archive?.end ?? null;
  if (raccoonStart > endDate) return { rows: archived, archiveEnd };

  try {
    const startStr = formatDateForAPI(raccoonStart);
    const endStr = formatDateForAPI(endDate);
    const url = `https://api.raccoon.bike/activity?system=bike_share_toronto&feed=station&start=${startStr}&end=${endStr}&frequency=d&station=${stationId}&key=YIOJaaLtLdazfrG7GVwcyAybB2WfpmSaxtCUx6gxLBw`;

    const response = await fetch(url);
    if (!response.ok) throw new Error('Failed to fetch station activity');
    const data = await response.json();
    return { rows: archived.concat(data.data || []), archiveEnd };
  } catch (error) {
    console.error('Error loading station activity:', error);
    return { rows: archived, archiveEnd };
  }
}

// { start, end, trips } for a station, or null if the archive has no trips
// from it (e.g. a station opened since the last build).
async function fetchStationArchive(stationId) {
  try {
    const response = await fetch(`/bikeshare-stations/${encodeURIComponent(stationId)}.json`);
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

function addDays(dateKey, days) {
  const date = new Date(`${dateKey}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function formatDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatDateForAPI(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}${month}${day}00`;
}