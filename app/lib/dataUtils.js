
import Papa from 'papaparse';

export async function loadCSVData() {
  try {
    const response = await fetch('/cycling_counts.csv');
    const csvText = await response.text();
    
    return new Promise((resolve, reject) => {
      Papa.parse(csvText, {
        header: true,
        complete: (results) => {
          resolve(results.data);
        },
        error: (error) => {
          reject(error);
        }
      });
    });
  } catch (error) {
    console.error('Error loading CSV data:', error);
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

export async function loadBikeshareData() {
  try {
    // Calculate date range
    const startDate = '2020010100'; // Start of 2020
    const today = new Date();
    const endDate = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, '0')}${String(today.getDate()).padStart(2, '0')}00`;
    
    const apiUrl = `https://api.raccoon.bike/activity?system=bike_share_toronto&start=${startDate}&end=${endDate}&frequency=d`;
    
    const response = await fetch(apiUrl);
    
    if (!response.ok) {
      throw new Error('Failed to fetch bikeshare data');
    }
    
    const data = await response.json();
    return data.data || [];
  } catch (error) {
    console.error('Error loading bikeshare data:', error);
    return [];
  }
}

export function processBikeshareCounter(rawData) {
  if (!rawData || rawData.length === 0) {
    return {
      location: "Bike Share Toronto",
      data: [],
      isOperational: true,
      totalCount: 0
    };
  }

  // Convert API data to our standard format and sort by date
  const dataPoints = rawData.map(point => {
    const date = point.datetime.split('T')[0];
    return {
      date: date,
      volume: point.trips,
      timestamp: new Date(date).getTime(),
      originalVolume: point.trips // Keep original for reference
    };
  }).sort((a, b) => a.timestamp - b.timestamp);

  // Step 1: Remove outliers
  const dataWithoutOutliers = removeOutliers(dataPoints);
  
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
    totalCount: totalCount
  };
}

// OUTLIER DETECTION AND REMOVAL

function removeOutliers(dataPoints) {
  if (dataPoints.length === 0) return [];
  
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
    // Check if current value is less than 30% of the 7-day average
    if (currentPoint.volume < previousAverage * 0.3 || currentPoint.volume < afterAverage * 0.3) {
      console.log(previousAverage)
      console.log(afterAverage)
      console.log(currentPoint.volume)
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
      
      if (gap) {
        const interpolatedVolume = calculateGapInterpolation(dateStr, gap, dataPoints);
        filledData.push({
          date: dateStr,
          volume: interpolatedVolume,
          timestamp: currentDate.getTime(),
          isInterpolated: true
        });
      } else {
        // Should not happen, but fallback
        filledData.push({
          date: dateStr,
          volume: 3000, // Reasonable default
          timestamp: currentDate.getTime(),
          isInterpolated: true
        });
      }
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
