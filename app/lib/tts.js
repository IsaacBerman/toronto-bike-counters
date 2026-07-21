// Shared constants + helpers for the Toronto travel-modes explorer.
// The raw dataset keys modes by the TTS single-letter codes; for display we
// fold the 13 codes into five groups. Colours are the dataviz categorical
// slots 1–5, in their CVD-validated order (worst adjacent ΔE 24.2 on white).

export const MODE_GROUPS = [
  { id: 'auto', label: 'Auto', codes: ['D', 'P'], color: '#2a78d6' },
  { id: 'transit', label: 'Transit', codes: ['B', 'G', 'J'], color: '#1baf7a' },
  { id: 'walk', label: 'Walk', codes: ['W'], color: '#eda100' },
  { id: 'cycle', label: 'Cycle', codes: ['C', 'E'], color: '#008300' },
  { id: 'other', label: 'Other', codes: ['M', 'S', 'T', 'U', 'O'], color: '#4a3aa7' },
];

export const GROUP_BY_ID = Object.fromEntries(MODE_GROUPS.map((g) => [g.id, g]));

// TransformTO: 75% of trips to work or school that are UNDER 5 KM taken by
// walking, cycling or transit by 2030. These three groups are the
// "sustainable" numerator; SHORT_BUCKETS are the < 5 km distance bands the
// goal applies to.
export const SUSTAINABLE_GROUPS = ['transit', 'walk', 'cycle'];
export const SHORT_BUCKETS = ['lt1', '1to2', '2to5']; // < 5 km
export const TRANSFORMTO = { share: 0.75, year: 2030 };

// Stack order for the composition charts: sustainable groups on the bottom so
// their combined height can be read against the 75% goal line.
export const STACK_ORDER = ['transit', 'walk', 'cycle', 'auto', 'other'];

// What each group folds together, for the detail-panel footnote / tooltip.
export const GROUP_CONTENTS = {
  auto: 'Auto driver + passenger',
  transit: 'Public transit, GO Rail, GO+transit',
  walk: 'Walking',
  cycle: 'Bicycle + e-scooter / e-mobility',
  other: 'Taxi, rideshare, school bus, motorcycle, other',
};

const CODE_TO_GROUP = {};
for (const g of MODE_GROUPS) for (const c of g.codes) CODE_TO_GROUP[c] = g.id;

// Sum a cell ({modeCode: count}) into group totals.
function addCell(acc, cell) {
  if (!cell) return acc;
  for (const [code, n] of Object.entries(cell)) {
    const g = CODE_TO_GROUP[code];
    if (g) acc[g] += n;
  }
  return acc;
}

function emptyGroups() {
  return { auto: 0, transit: 0, walk: 0, cycle: 0, other: 0 };
}

// Group totals for one ward + year, restricted to `bucket`:
//   'all'     — every distance bucket
//   'under5'  — the < 5 km bands (the TransformTO goal distance)
//   string[]  — an explicit set of bucket ids
//   string    — a single bucket id
export function wardGroupTotals(data, year, ward, bucket) {
  const wardData = data?.[year]?.[ward];
  const acc = emptyGroups();
  if (!wardData) return acc;
  if (bucket === 'all') {
    for (const cell of Object.values(wardData)) addCell(acc, cell);
  } else if (bucket === 'under5') {
    for (const b of SHORT_BUCKETS) addCell(acc, wardData[b]);
  } else if (Array.isArray(bucket)) {
    for (const b of bucket) addCell(acc, wardData[b]);
  } else {
    addCell(acc, wardData[bucket]);
  }
  return acc;
}

export function groupSum(groups) {
  return groups.auto + groups.transit + groups.walk + groups.cycle + groups.other;
}

// Share (0–1) of one group for a ward+year+bucket. Returns 0 when no trips.
export function groupShare(data, year, ward, bucket, groupId) {
  const g = wardGroupTotals(data, year, ward, bucket);
  const total = groupSum(g);
  return total > 0 ? g[groupId] / total : 0;
}

// City-wide group totals (every ward summed) for a year + bucket.
export function cityGroupTotals(data, year, bucket) {
  const yearData = data?.[year];
  const acc = emptyGroups();
  if (!yearData) return acc;
  for (const ward of Object.keys(yearData)) {
    const w = wardGroupTotals(data, year, ward, bucket);
    for (const k of Object.keys(acc)) acc[k] += w[k];
  }
  return acc;
}

// Sustainable (walk + cycle + transit) share of a group-totals object.
export function sustainableShareOf(groups) {
  const total = groupSum(groups);
  if (total <= 0) return 0;
  return SUSTAINABLE_GROUPS.reduce((s, g) => s + groups[g], 0) / total;
}

// Convert group totals to percentage shares (0–100), keyed by group id.
export function groupPercents(groups) {
  const total = groupSum(groups);
  const out = {};
  for (const g of Object.keys(groups)) out[g] = total > 0 ? (groups[g] / total) * 100 : 0;
  return out;
}

// Mix two hex colours in sRGB. t=0 → a, t=1 → b.
export function mixHex(a, b, t) {
  const pa = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16));
  const pb = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16));
  const c = pa.map((v, i) => Math.round(v + (pb[i] - v) * t));
  return '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('');
}
