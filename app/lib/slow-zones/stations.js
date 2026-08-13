// Ordered station lists (with coordinates) for the TTC subway lines, used to
// draw the network map and to resolve a slow-zone location ("Northbound
// Wilson to Sheppard West") onto the segments between adjacent stations.
//
// Line 1 runs Vaughan Metropolitan Centre -> Finch, Line 2 runs Kipling ->
// Kennedy, Line 4 runs Sheppard-Yonge -> Don Mills. Coordinates are station
// entrances to ~100 m, plenty at city zoom.

export const LINES = {
  1: {
    name: 'Line 1 (Yonge–University)',
    color: '#f8c300',
    stations: [
      ['Vaughan Metropolitan Centre', 43.7943, -79.5279],
      ['Highway 407', 43.7834, -79.5236],
      ['Pioneer Village', 43.777, -79.5093],
      ['York University', 43.7739, -79.4998],
      ['Finch West', 43.7647, -79.4909],
      ['Downsview Park', 43.7535, -79.4784],
      ['Sheppard West', 43.7497, -79.462],
      ['Wilson', 43.7345, -79.45],
      ['Yorkdale', 43.7247, -79.4477],
      ['Lawrence West', 43.7157, -79.4442],
      ['Glencairn', 43.7087, -79.4406],
      ['Cedarvale', 43.6997, -79.4356],
      ['St Clair West', 43.6839, -79.4157],
      ['Dupont', 43.6745, -79.407],
      ['Spadina', 43.6672, -79.4036],
      ['St George', 43.6683, -79.3996],
      ['Museum', 43.6672, -79.3936],
      ["Queen's Park", 43.6598, -79.3903],
      ['St Patrick', 43.6547, -79.3885],
      ['Osgoode', 43.6508, -79.3868],
      ['St Andrew', 43.6475, -79.3849],
      ['Union', 43.6454, -79.3807],
      ['King', 43.6489, -79.3778],
      ['Queen', 43.6525, -79.3792],
      ['Dundas', 43.6561, -79.3803],
      ['College', 43.6613, -79.3831],
      ['Wellesley', 43.6653, -79.3838],
      ['Bloor-Yonge', 43.6709, -79.3857],
      ['Rosedale', 43.6764, -79.3888],
      ['Summerhill', 43.6822, -79.391],
      ['St Clair', 43.6879, -79.3934],
      ['Davisville', 43.6975, -79.3971],
      ['Eglinton', 43.7057, -79.3985],
      ['Lawrence', 43.725, -79.4022],
      ['York Mills', 43.7442, -79.4066],
      ['Sheppard-Yonge', 43.7615, -79.4109],
      ['North York Centre', 43.7684, -79.413],
      ['Finch', 43.7805, -79.415],
    ],
  },
  2: {
    name: 'Line 2 (Bloor–Danforth)',
    color: '#00923f',
    stations: [
      ['Kipling', 43.6375, -79.5358],
      ['Islington', 43.6453, -79.5242],
      ['Royal York', 43.6484, -79.5113],
      ['Old Mill', 43.65, -79.4946],
      ['Jane', 43.65, -79.4844],
      ['Runnymede', 43.6518, -79.4756],
      ['High Park', 43.6537, -79.4672],
      ['Keele', 43.6556, -79.4595],
      ['Dundas West', 43.657, -79.4525],
      ['Lansdowne', 43.6591, -79.4426],
      ['Dufferin', 43.6602, -79.4357],
      ['Ossington', 43.6623, -79.4269],
      ['Christie', 43.6641, -79.4183],
      ['Bathurst', 43.6666, -79.4114],
      ['Spadina', 43.6672, -79.4036],
      ['St George', 43.6683, -79.3996],
      ['Bay', 43.6699, -79.3903],
      ['Bloor-Yonge', 43.6709, -79.3857],
      ['Sherbourne', 43.6721, -79.3763],
      ['Castle Frank', 43.674, -79.3687],
      ['Broadview', 43.6767, -79.3585],
      ['Chester', 43.6783, -79.3524],
      ['Pape', 43.6799, -79.3452],
      ['Donlands', 43.681, -79.3378],
      ['Greenwood', 43.6828, -79.3306],
      ['Coxwell', 43.6842, -79.3231],
      ['Woodbine', 43.6864, -79.3128],
      ['Main Street', 43.689, -79.3016],
      ['Victoria Park', 43.6947, -79.2884],
      ['Warden', 43.7115, -79.2795],
      ['Kennedy', 43.7325, -79.2637],
    ],
  },
  4: {
    name: 'Line 4 (Sheppard)',
    color: '#a21a68',
    stations: [
      ['Sheppard-Yonge', 43.7615, -79.4109],
      ['Bayview', 43.7669, -79.386],
      ['Bessarion', 43.7692, -79.3762],
      ['Leslie', 43.771, -79.3652],
      ['Don Mills', 43.7756, -79.3461],
    ],
  },
};

export function stationKey(name) {
  return String(name)
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

// Old or short names the TTC may still use in zone locations. Unresolved
// names silently drop the zone out of the map, the segment ranking and the
// ridership/cost estimate, so shorthand has to be aliased here.
const ALIASES = {
  'eglinton-west': 'cedarvale',
  downsview: 'sheppard-west',
  vaughan: 'vaughan-metropolitan-centre',
  vmc: 'vaughan-metropolitan-centre',
};

function canonicalKey(name) {
  const key = stationKey(name);
  return ALIASES[key] || key;
}

const indexByLine = {};
for (const [lineId, line] of Object.entries(LINES)) {
  const idx = {};
  line.stations.forEach(([name], i) => {
    idx[canonicalKey(name)] = i;
  });
  indexByLine[lineId] = idx;
}

// Resolve a from/to station pair on a line to the segments (adjacent-station
// index pairs) it spans. Returns [] if either station is unknown on the line.
export function segmentsBetween(lineId, fromName, toName) {
  const idx = indexByLine[lineId];
  if (!idx) return [];
  const a = idx[canonicalKey(fromName)];
  const b = idx[canonicalKey(toName)];
  if (a === undefined || b === undefined) return [];
  const [lo, hi] = a < b ? [a, b] : [b, a];
  const segments = [];
  for (let i = lo; i < hi; i++) segments.push([i, i + 1]);
  return segments;
}

// Like segmentsBetween, but the pairs are in travel order (from -> to), so
// callers can render direction (offset side, arrows).
export function spanBetween(lineId, fromName, toName) {
  const idx = indexByLine[lineId];
  if (!idx) return [];
  const a = idx[canonicalKey(fromName)];
  const b = idx[canonicalKey(toName)];
  if (a === undefined || b === undefined || a === b) return [];
  const step = a < b ? 1 : -1;
  const segments = [];
  for (let i = a; i !== b; i += step) segments.push([i, i + step]);
  return segments;
}

export function segmentLabel(lineId, [i, j]) {
  const stations = LINES[lineId]?.stations;
  if (!stations) return '';
  return `${stations[i][0]} – ${stations[j][0]}`;
}
