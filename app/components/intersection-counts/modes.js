// Shared vocabulary for the turning-movement pages: the five modes the City
// separates in a count, in the order they stack and slice.
//
// Five categorical hues from the same validated set the counter charts use.
// Checked with the palette validator on an all-pairs basis (not just adjacent
// pairs) because a pie puts every slice next to every other one: worst pair is
// magenta/blue at CVD ΔE 8.7, and all five clear 3:1 on the panel.
export const MODES = [
  { key: 'cars', label: 'Cars', color: '#006fa9' },
  { key: 'trucks', label: 'Trucks', color: '#a07a0c' },
  { key: 'buses', label: 'Buses', color: '#6803bf' },
  { key: 'peds', label: 'Pedestrians', color: '#00633c' },
  { key: 'bikes', label: 'Bikes', color: '#ff35de' },
];

export const MODE_COLORS = MODES.map((m) => m.color);

// A count row is [date, hours, ...five peak-window totals, ...five full totals].
export const COUNT_DATE = 0;
export const COUNT_HOURS = 1;
export const COUNT_PEAK = 2;
export const COUNT_FULL = 7;

export const peakTotals = (count) => count.slice(COUNT_PEAK, COUNT_PEAK + MODES.length);
export const fullTotals = (count) => count.slice(COUNT_FULL, COUNT_FULL + MODES.length);
export const sum = (values) => values.reduce((a, b) => a + b, 0);

export const fmt = (n) => Math.round(n).toLocaleString();

export function fmtDate(iso) {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

// The mode filter is held as the list of picked modes, with the empty list
// meaning "all of them" rather than "none" — so the unfiltered map is the
// natural default state and clearing the picks restores it.
export const isModeOn = (picked, key) => picked.length === 0 || picked.includes(key);

export const visibleModes = (picked) => MODES.filter((m) => isModeOn(picked, m.key));

// "Bikes", "Bikes and pedestrians", "Cars, buses and bikes".
export function describeModes(picked) {
  const labels = visibleModes(picked).map((m) => m.label.toLowerCase());
  if (labels.length <= 1) return labels[0] ?? '';
  return `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`;
}
