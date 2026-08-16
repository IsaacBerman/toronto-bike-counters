
// Add this helper function at the top of dataUtils.js
export function getCurrentESTTime() {
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
}

// Update loadBikeshareHourlyData function
export async function loadBikeshareHourlyData() {
  try {
    const estTime = getCurrentESTTime();
    
    // Calculate date range for last 2 weeks in EST
    const endDate = estTime.date;
    const startDate = new Date(endDate);
    startDate.setDate(startDate.getDate() - 14); // 2 weeks ago
    
    const currentYearData = await loadBikeshareHourlyDataForDateRange(startDate, endDate);
    
    // Calculate same period last year
    const lastYearStartDate = new Date(startDate);
    const lastYearEndDate = new Date(endDate);
    lastYearStartDate.setFullYear(lastYearStartDate.getFullYear() - 1);
    lastYearEndDate.setFullYear(lastYearEndDate.getFullYear() - 1);
    
    const lastYearData = await loadBikeshareHourlyDataForDateRange(lastYearStartDate, lastYearEndDate);
    // Process both datasets
    const processedCurrentYear = processBikeshareHourlyData(currentYearData, 'current', estTime);
    const processedLastYear = processBikeshareHourlyData(lastYearData, 'lastYear', estTime);
    
    return {
      currentYear: processedCurrentYear,
      lastYear: processedLastYear
    };
  } catch (error) {
    console.error('Error loading hourly bikeshare data:', error);
    return { currentYear: [], lastYear: [] };
  }
}

// Update processBikeshareHourlyData to accept EST time
export function processBikeshareHourlyData(rawData, yearType = 'current', estTime = null) {
  // Check if rawData is an array
  if (!rawData || !Array.isArray(rawData)) {
    console.error('processBikeshareHourlyData received non-array data:', rawData);
    return [];
  }
  
  if (rawData.length === 0) {
    return [];
  }

  const currentEST = estTime || getCurrentESTTime();
  const today = `${currentEST.year}-${String(currentEST.month).padStart(2, '0')}-${String(currentEST.day).padStart(2, '0')}`;
  const currentHour = currentEST.hour;

  // Convert API data to our standard format
  const dataPoints = rawData.map(point => {
    const datetime = point.datetime; // Format: "2024-01-15T14:00:00"
    const date = datetime.split('T')[0];
    
    // Parse the datetime in EST
    const dateObj = new Date(datetime);
    const estDateFormatter = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Toronto',
      hour: '2-digit',
      hour12: false
    });
    const hour = parseInt(estDateFormatter.format(dateObj));
    
    const isCurrentDay = date === today && yearType === 'current';
    const isFutureHour = isCurrentDay && hour > currentHour;
    
    return {
      datetime: datetime,
      date: date,
      hour: hour,
      volume: point.trips,
      timestamp: new Date(datetime).getTime(),
      displayLabel: `${date} ${hour}:00`,
      isCurrentDay: isCurrentDay,
      isFutureHour: isFutureHour,
      yearType: yearType,
      // Don't include future hours in calculations
      volumeForAverage: isFutureHour ? null : point.trips
    };
  }).sort((a, b) => a.timestamp - b.timestamp);
  
  return dataPoints;
}

export async function loadCSVData() {
  try {
    // Pre-extracted, direction-summed daily counts (see scripts/build-cycling.mjs).
    // Expanded back into the per-location-per-day row shape processCounterData
    // expects, so that function is unchanged.
    const response = await fetch('/cycling-counts.json');
    const { counters } = await response.json();

    const rows = [];
    for (const counter of counters) {
      const { location, dates, volumes } = counter;
      for (let i = 0; i < dates.length; i++) {
        rows.push({ location_name: location, dt: dates[i], daily_volume: volumes[i] });
      }
    }
    return rows;
  } catch (error) {
    console.error('Error loading cycling counts:', error);
    return [];
  }
}

export function processCounterData(rawData) {
  // Filter out empty rows and convert types
  const validData = rawData.filter(row => row.dt && row.daily_volume);
  
  // Group by location and date, sum eastbound/westbound
  const locationData = {};
  
  validData.forEach(row => {
    const location = row.location_name;
    const date = row.dt;
    const volume = parseInt(row.daily_volume) || 0;
    
    if (!locationData[location]) {
      locationData[location] = {};
    }
    
    if (!locationData[location][date]) {
      locationData[location][date] = 0;
    }
    
    locationData[location][date] += volume;
  });
  
  // Convert to array format for charts
  const processedData = Object.entries(locationData).map(([location, dateVolumes]) => {
    const dataPoints = Object.entries(dateVolumes)
      .map(([date, volume]) => ({
        date,
        volume,
        timestamp: new Date(date).getTime()
      }))
      .sort((a, b) => a.timestamp - b.timestamp);
    
    // Remove outliers first
    const dataWithoutOutliers = removeOutliers(dataPoints);
    
    // Calculate rolling averages
    const dataWithRollingAvg = calculateRollingAverage(dataWithoutOutliers);
    
    // Determine if counter is operational (check if "retired" is in the location name)
    const isOperational = !location.toLowerCase().includes('retired');
    
    return {
      location,
      data: dataWithRollingAvg,
      isOperational,
      totalCount: dataWithoutOutliers.reduce((sum, point) => sum + point.volume, 0)
    };
  });
  
  return processedData;
}

export function filterByYear(data, year) {
  return data.map(counter => ({
    ...counter,
    data: counter.data.filter(point => new Date(point.date).getFullYear() === year)
  })).filter(counter => counter.data.length > 0);
}

export function calculateRollingAverage(data, windowSize = 14) {
  if (data.length === 0) return [];
  
  const sortedData = [...data].sort((a, b) => new Date(a.date) - new Date(b.date));
  const result = [];
  
  for (let i = 0; i < sortedData.length; i++) {
    const startIndex = Math.max(0, i - windowSize + 1);
    const windowData = sortedData.slice(startIndex, i + 1);
    
    const average = windowData.reduce((sum, point) => sum + point.volume, 0) / windowData.length;
    
    result.push({
      ...sortedData[i],
      rollingAverage: Math.round(average * 10) / 10, // Round to 1 decimal
      dailyVolume: sortedData[i].volume // Keep original daily volume for reference
    });
  }
  
  return result;
}

// BIKESHARE DATA FUNCTIONS

// The City's trip-level ridership archives, pre-reduced to one row per day
// (see build_bikeshare_daily.py in the dash.raccoon.bike repo). Authoritative
// from 2016 through `cutoff`; the live API covers only what comes after.
async function loadArchivedBikeshareData() {
  const response = await fetch('/bikeshare-daily.json');
  if (!response.ok) {
    throw new Error('Failed to fetch archived bikeshare data');
  }
  const d = await response.json();
  return {
    cutoff: d.cutoff,
    points: d.dates.map((date, i) => ({
      datetime: date,
      // Flags these as official City records rather than live estimates, so
      // outlier removal leaves them alone (see processBikeshareCounter).
      isArchive: true,
      trips: d.trips[i],
      member: d.member[i],
      casual: d.casual[i],
      // The user x model joint. Null before 2024 — the City records no bike
      // model until then — which is why classic/electric can't go back further.
      member_classic: d.member_classic[i],
      member_electric: d.member_electric[i],
      casual_classic: d.casual_classic[i],
      casual_electric: d.casual_electric[i]
    }))
  };
}

// The trip-type filters. The archive stores only what can't be derived, so a
// classic/electric total is the joint summed over users, and every combination
// below is either a stored column or a sum of stored columns.
export const USER_TYPES = [
  { value: 'all', label: 'All riders' },
  { value: 'member', label: 'Members' },
  { value: 'casual', label: 'Casual' }
];
export const BIKE_TYPES = [
  { value: 'all', label: 'All bikes' },
  { value: 'classic', label: 'Classic' },
  { value: 'electric', label: 'E-bike' }
];

// Trips on one day matching the selected filters, or null when that
// combination isn't recorded for that day (so the series breaks rather than
// plotting a phantom zero).
export function tripsMatching(point, userType = 'all', bikeType = 'all') {
  const num = (v) => (typeof v === 'number' ? v : null);

  if (userType === 'all' && bikeType === 'all') return num(point.trips);
  if (bikeType === 'all') return num(point[userType]);

  if (userType === 'all') {
    const m = num(point[`member_${bikeType}`]);
    const c = num(point[`casual_${bikeType}`]);
    return m === null || c === null ? null : m + c;
  }
  return num(point[`${userType}_${bikeType}`]);
}

// 'YYYY-MM-DD' -> the API's 'YYYYMMDD' stamp for the following day.
function nextDayStamp(isoDate) {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
}

export async function loadBikeshareData() {
  let archive = { cutoff: null, points: [] };
  try {
    archive = await loadArchivedBikeshareData();
  } catch (error) {
    console.error('Error loading archived bikeshare data:', error);
  }

  const today = new Date();
  const endDate = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, '0')}${String(today.getDate()).padStart(2, '0')}`;
  // Ask the API only for days the archive doesn't already cover.
  const startDate = archive.cutoff ? nextDayStamp(archive.cutoff) : '20200101';

  let live = [];
  if (startDate <= endDate) {
    try {
      const apiUrl = `https://api.raccoon.bike/activity?system=bike_share_toronto&start=${startDate}00&end=${endDate}00&frequency=d&key=YIOJaaLtLdazfrG7GVwcyAybB2WfpmSaxtCUx6gxLBw`;
      const response = await fetch(apiUrl);

      if (!response.ok) {
        throw new Error('Failed to fetch bikeshare data');
      }

      const data = await response.json();
      live = data.data || [];
    } catch (error) {
      console.error('Error loading bikeshare data:', error);
    }
  }

  // Archive wins on any overlap — it is the City's own count, not an estimate.
  const byDate = new Map();
  for (const point of [...live, ...archive.points]) {
    byDate.set(point.datetime.split('T')[0], point);
  }
  return [...byDate.values()];
}

export function processBikeshareCounter(rawData, userType = 'all', bikeType = 'all') {
  if (!rawData || rawData.length === 0) {
    return {
      location: "Bike Share Toronto",
      data: [],
      isOperational: true,
      totalCount: 0,
      coverage: null
    };
  }

  // Convert API data to our standard format and sort by date. Days the chosen
  // filter isn't recorded for are dropped rather than zeroed, so a narrower
  // filter shortens the series instead of inventing a collapse in ridership.
  const dataPoints = rawData.map(point => {
    const date = point.datetime.split('T')[0];
    const volume = tripsMatching(point, userType, bikeType);
    return volume === null ? null : {
      date: date,
      volume: volume,
      timestamp: new Date(date).getTime(),
      originalVolume: volume, // Keep original for reference
      isArchive: point.isArchive === true
    };
  }).filter(Boolean).sort((a, b) => a.timestamp - b.timestamp);

  if (dataPoints.length === 0) {
    return {
      location: "Bike Share Toronto",
      data: [],
      isOperational: true,
      totalCount: 0,
      coverage: null
    };
  }

  // What span this filter actually covers, so the UI can say so.
  const coverage = { from: dataPoints[0].date, to: dataPoints[dataPoints.length - 1].date };

  // Step 1: Remove outliers — but never from the City's own archive. That rule
  // exists because bikeraccoon infers trips from station polling and can drop
  // most of a day's records. The archive is trip-level: every trip is a row, so
  // a partial day isn't possible, and the days it flagged were real ones —
  // blizzards and Christmas, when almost nobody rode. Live days keep the check.
  const dataWithoutOutliers = removeOutliers(dataPoints, point => !point.isArchive);
  
  // Step 2: Fill in missing dates
  const filledDataPoints = fillMissingDates(dataWithoutOutliers);

  // Calculate rolling averages
  const dataWithRollingAvg = calculateRollingAverage(filledDataPoints);

  // Calculate total trips
  const totalCount = filledDataPoints.reduce((sum, point) => sum + point.volume, 0);

  return {
    location: "Bike Share Toronto",
    data: dataWithRollingAvg,
    isOperational: true,
    totalCount: totalCount,
    coverage: coverage
  };
}

// Monthly totals for the trip-type breakdown charts. Months are kept whole:
// a partial month at either end would read as a real drop in a bar chart, so
// only months with a full complement of days are returned.
export function bikeshareMonthlyBreakdown(rawData) {
  if (!rawData || rawData.length === 0) return { bikeType: [], userType: [] };

  const months = new Map();
  for (const point of rawData) {
    const date = point.datetime.split('T')[0];
    const key = date.slice(0, 7);
    if (!months.has(key)) {
      months.set(key, { month: key, days: 0, classic: 0, electric: 0, member: 0, casual: 0, hasModel: true, hasUser: true });
    }
    const m = months.get(key);
    m.days += 1;

    const classic = tripsMatching(point, 'all', 'classic');
    const electric = tripsMatching(point, 'all', 'electric');
    if (classic === null || electric === null) m.hasModel = false;
    else { m.classic += classic; m.electric += electric; }

    const member = tripsMatching(point, 'member', 'all');
    const casual = tripsMatching(point, 'casual', 'all');
    if (member === null || casual === null) m.hasUser = false;
    else { m.member += member; m.casual += casual; }
  }

  const daysInMonth = (key) => {
    const [y, mo] = key.split('-').map(Number);
    return new Date(Date.UTC(y, mo, 0)).getUTCDate();
  };
  const label = (key) => {
    const [y, mo] = key.split('-').map(Number);
    return new Date(Date.UTC(y, mo - 1, 1)).toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });
  };

  const whole = [...months.values()]
    .filter(m => m.days === daysInMonth(m.month))
    .sort((a, b) => a.month.localeCompare(b.month))
    .map(m => ({ ...m, label: label(m.month) }));

  return {
    bikeType: whole.filter(m => m.hasModel).map(({ month, label, classic, electric }) => ({ month, label, classic, electric })),
    userType: whole.filter(m => m.hasUser).map(({ month, label, member, casual }) => ({ month, label, member, casual }))
  };
}

// OUTLIER DETECTION AND REMOVAL

// Outlier detection compares each day against its neighbours by array
// position, which is only meaningful while those neighbours are actually
// adjacent in time. Where the record breaks, they aren't: with the withheld
// 2021-2023 span dropped, September 2021 sat directly beside January 2024, so
// every low winter day measured as an outlier against a summer baseline, was
// replaced by that baseline, and the replacement then fed the next window and
// pinned the series to a constant. Each unbroken run is cleaned on its own.
// `canReplace` decides which points may be rewritten. Points that fail it still
// count toward the surrounding-week average, so live days keep real context
// from the archive days before them.
function removeOutliers(dataPoints, canReplace = () => true) {
  if (dataPoints.length === 0) return [];

  const cleaned = [];
  let run = [];
  const flushRun = () => {
    if (run.length) cleaned.push(...removeOutliersFromRun(run, canReplace));
    run = [];
  };

  for (const point of dataPoints) {
    if (run.length) {
      const daysSincePrevious = (point.timestamp - run[run.length - 1].timestamp) / 86400000;
      if (daysSincePrevious > MAX_INTERPOLATED_GAP_DAYS) flushRun();
    }
    run.push(point);
  }
  flushRun();

  return cleaned;
}

// A day counts as an outlier only if it falls below this share of the
// surrounding week. The rule is meant to catch a feed that dropped most of a
// day's records, not a quiet day: at 30% it was rewriting about one day in
// eleven of the casual and e-bike series, which are genuinely spiky because
// casual riding is weekend-driven. 10% keeps the collapses and leaves ordinary
// quiet days alone.
const OUTLIER_FRACTION_OF_WEEK = 0.1;

function removeOutliersFromRun(dataPoints, canReplace = () => true) {
  const cleanedData = [...dataPoints];

  for (let i = 7; i < cleanedData.length; i++) {
    const currentPoint = cleanedData[i];
    
    // Calculate 7-day average of previous days
    const previous7Days = [...cleanedData].slice(Math.max(0, i - 7), i);
    const previousAverage = previous7Days.length > 0 
      ? previous7Days.reduce((sum, point) => sum + point.volume, 0) / previous7Days.length
      : currentPoint.volume;
    
    const after7Days = [...cleanedData].slice(i, Math.min(i+7, cleanedData.length));
    const afterAverage = after7Days.length > 0 
      ? after7Days.reduce((sum, point) => sum + point.volume, 0) / after7Days.length
      : currentPoint.volume;
    // Check if current value is far below the surrounding week
    if (canReplace(currentPoint)
        && (currentPoint.volume < previousAverage * OUTLIER_FRACTION_OF_WEEK
            || currentPoint.volume < afterAverage * OUTLIER_FRACTION_OF_WEEK)) {
      // Replace outlier with the 7-day average
      cleanedData[i] = {
        ...currentPoint,
        volume: Math.round(previousAverage),
        wasOutlier: true, // Flag for debugging
        originalOutlierValue: currentPoint.volume // Keep original for reference
      };
    }
  }
  
  return cleanedData;
}

// GAP FILLING FUNCTIONS

// Gaps longer than this are left as gaps. A missing day or two is a feed
// hiccup, and bridging it keeps a rolling average honest. A months-long
// absence is not a hiccup: interpolating across it draws a smooth invented
// curve between the last real reading and the next, which reads as data. The
// member/casual series is withheld for over two years, and filling that span
// produced exactly such a curve.
const MAX_INTERPOLATED_GAP_DAYS = 14;

function fillMissingDates(dataPoints) {
  if (dataPoints.length === 0) return [];

  const filledData = [];
  const startDate = new Date(dataPoints[0].date);
  const endDate = new Date(dataPoints[dataPoints.length - 1].date);
  
  // Create a map of existing dates for quick lookup
  const dateMap = new Map();
  dataPoints.forEach(point => {
    dateMap.set(point.date, point.volume);
  });

  // Identify all gaps in the data
  const gaps = identifyGaps(dataPoints, startDate, endDate);
  
  // Iterate through each day in the range
  let currentDate = new Date(startDate);
  while (currentDate <= endDate) {
    const dateStr = currentDate.toISOString().split('T')[0];
    
    if (dateMap.has(dateStr)) {
      // Date exists, use the actual data
      filledData.push({
        date: dateStr,
        volume: dateMap.get(dateStr),
        timestamp: currentDate.getTime()
      });
    } else {
      // Date is missing, check which gap it belongs to
      const gap = gaps.find(g => 
        currentDate >= g.startDate && currentDate <= g.endDate
      );
      
      if (gap && gap.size <= MAX_INTERPOLATED_GAP_DAYS) {
        const interpolatedVolume = calculateGapInterpolation(dateStr, gap, dataPoints);
        filledData.push({
          date: dateStr,
          volume: interpolatedVolume,
          timestamp: currentDate.getTime(),
          isInterpolated: true
        });
      }
      // Otherwise leave the day out entirely. The chart plots missing days as
      // nulls and breaks the line there, which is the truthful rendering.
    }
    
    currentDate.setDate(currentDate.getDate() + 1);
  }

  return filledData;
}

function identifyGaps(dataPoints, startDate, endDate) {
  const gaps = [];
  const sortedPoints = [...dataPoints].sort((a, b) => a.timestamp - b.timestamp);
  
  let currentDate = new Date(startDate);
  let gapStart = null;
  
  while (currentDate <= endDate) {
    const dateStr = currentDate.toISOString().split('T')[0];
    const exists = sortedPoints.some(point => point.date === dateStr);
    
    if (!exists && gapStart === null) {
      // Start of a new gap
      gapStart = new Date(currentDate);
    } else if (exists && gapStart !== null) {
      // End of a gap
      const gapEnd = new Date(currentDate);
      gapEnd.setDate(gapEnd.getDate() - 1); // Previous day was the last missing day
      
      if (gapStart <= gapEnd) { // Ensure valid gap
        gaps.push({
          startDate: new Date(gapStart),
          endDate: new Date(gapEnd),
          size: Math.floor((gapEnd - gapStart) / (1000 * 60 * 60 * 24)) + 1
        });
      }
      gapStart = null;
    }
    
    currentDate.setDate(currentDate.getDate() + 1);
  }
  
  // Handle case where gap continues to the end
  if (gapStart !== null) {
    gaps.push({
      startDate: new Date(gapStart),
      endDate: new Date(endDate),
      size: Math.floor((endDate - gapStart) / (1000 * 60 * 60 * 24)) + 1
    });
  }
  
  return gaps;
}

function calculateGapInterpolation(missingDate, gap, dataPoints) {
  const missingDateObj = new Date(missingDate);
  const gapSize = gap.size;
  const positionInGap = Math.floor((missingDateObj - gap.startDate) / (1000 * 60 * 60 * 24));
  
  // Get 7-day average before the gap
  const beforeDates = [];
  let beforeDate = new Date(gap.startDate);
  for (let i = 1; i <= 7; i++) {
    beforeDate.setDate(beforeDate.getDate() - 1);
    const dateStr = beforeDate.toISOString().split('T')[0];
    const existingPoint = dataPoints.find(point => point.date === dateStr);
    if (existingPoint) {
      beforeDates.push(existingPoint.volume);
    }
  }
  
  // Get 7-day average after the gap
  const afterDates = [];
  let afterDate = new Date(gap.endDate);
  for (let i = 1; i <= 7; i++) {
    afterDate.setDate(afterDate.getDate() + 1);
    const dateStr = afterDate.toISOString().split('T')[0];
    const existingPoint = dataPoints.find(point => point.date === dateStr);
    if (existingPoint) {
      afterDates.push(existingPoint.volume);
    }
  }
  
  const beforeAverage = beforeDates.length > 0 
    ? beforeDates.reduce((sum, vol) => sum + vol, 0) / beforeDates.length 
    : 3000; // Reasonable default
  
  const afterAverage = afterDates.length > 0 
    ? afterDates.reduce((sum, vol) => sum + vol, 0) / afterDates.length 
    : 3000; // Reasonable default
  
  // For small gaps (<= 7 days), use linear interpolation
  if (gapSize <= 7) {
    const progress = (positionInGap + 1) / (gapSize + 1);
    return Math.round(beforeAverage + (afterAverage - beforeAverage) * progress);
  }
  
  // For larger gaps, use different strategies based on position in gap
  if (positionInGap < 7) {
    // Beginning of large gap: trend from beforeAverage toward midpoint
    const progress = positionInGap / 7;
    const midpoint = (beforeAverage + afterAverage) / 2;
    return Math.round(beforeAverage + (midpoint - beforeAverage) * progress);
  } else if (positionInGap > gapSize - 7) {
    // End of large gap: trend from midpoint toward afterAverage
    const progress = (positionInGap - (gapSize - 7)) / 7;
    const midpoint = (beforeAverage + afterAverage) / 2;
    return Math.round(midpoint + (afterAverage - midpoint) * progress);
  } else {
    // Middle of large gap: use midpoint with some seasonal variation
    const midpoint = (beforeAverage + afterAverage) / 2;
    const seasonalVariation = 1 + 0.1 * Math.sin(positionInGap * 2 * Math.PI / 30); // Monthly cycle
    return Math.round(midpoint * seasonalVariation * (0.9 + Math.random() * 0.2));
  }
}

// Add this new function to fetch hourly data for last year
export async function loadBikeshareHourlyDataForDateRange(startDate, endDate) {
  try {
    const startDateStr = `${startDate.getFullYear()}${String(startDate.getMonth() + 1).padStart(2, '0')}${String(startDate.getDate()).padStart(2, '0')}00`;
    const endDateStr = `${endDate.getFullYear()}${String(endDate.getMonth() + 1).padStart(2, '0')}${String(endDate.getDate()).padStart(2, '0')}23`;
    
    const apiUrl = `https://api.raccoon.bike/activity?system=bike_share_toronto&start=${startDateStr}&end=${endDateStr}&frequency=h&key=YIOJaaLtLdazfrG7GVwcyAybB2WfpmSaxtCUx6gxLBw`;
    
    const response = await fetch(apiUrl);
    
    if (!response.ok) {
      throw new Error('Failed to fetch hourly bikeshare data');
    }
    
    const data = await response.json();
    return data.data || [];
  } catch (error) {
    console.error('Error loading hourly bikeshare data:', error);
    return [];
  }
}

// Calculate average by hour for a given period
export function calculateHourlyAveragesForPeriod(dataPoints, excludeCurrentDay = true) {
  const hourMap = {};
  for (let i = 0; i < 24; i++) {
    hourMap[i] = { total: 0, count: 0 };
  }
  
  const now = new Date();
  const today = now.toISOString().split('T')[0];
  
  dataPoints.forEach(point => {
    // Exclude current day if requested, and exclude future hours
    if ((!excludeCurrentDay || point.date !== today) && point.volumeForAverage !== null && point.volume > 0) {
      hourMap[point.hour].total += point.volume;
      hourMap[point.hour].count++;
    }
  });
  
  return Object.keys(hourMap).map(hour => ({
    hour: parseInt(hour),
    displayHour: `${hour}:00`,
    averageTrips: hourMap[hour].count > 0 ? Math.round(hourMap[hour].total / hourMap[hour].count) : 0
  }));
}

// Get current day data by hour
export function getCurrentDayData(dataPoints) {
  const now = new Date();
  const today = now.toISOString().split('T')[0];
  const currentHour = now.getHours();
  
  const currentDayData = {};
  for (let i = 0; i <= currentHour; i++) {
    currentDayData[i] = 0;
  }
  
  dataPoints.forEach(point => {
    if (point.date === today && point.hour <= currentHour && point.volume > 0) {
      currentDayData[point.hour] = point.volume;
    }
  });
  
  return Object.keys(currentDayData).map(hour => ({
    hour: parseInt(hour),
    displayHour: `${hour}:00`,
    currentTrips: currentDayData[hour]
  }));
}