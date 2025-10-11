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
    
    // Calculate rolling averages
    const dataWithRollingAvg = calculateRollingAverage(dataPoints);
    
    // Determine if counter is operational (check if "retired" is in the location name)
    const isOperational = !location.toLowerCase().includes('retired');
    
    return {
      location,
      data: dataWithRollingAvg,
      isOperational,
      totalCount: dataPoints.reduce((sum, point) => sum + point.volume, 0)
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