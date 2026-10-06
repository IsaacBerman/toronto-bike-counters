// Shared colour and arithmetic for the election map, its legend and the side
// panel, so all three agree on what a colour means.

export const RACES = [
  // Live on election night, October 26, 2026: ward totals from the City's feed.
  { id: 'mayor-2026', label: '2026 Mayoral Election', short: '2026 Mayor', live: true },
  { id: 'council-2026', label: '2026 City Council', short: '2026 Council', live: true },
  { id: 'mayor-2023', label: '2023 Mayoral By-election', short: '2023 Mayor' },
  { id: 'council-2022', label: '2022 City Council', short: '2022 Council' },
  { id: 'council-2018', label: '2018 City Council', short: '2018 Council' },
];

// The first three slots of the validated categorical palette, which are the
// only ones that stay distinguishable from every other slot on a choropleth
// (each polygon can sit next to any other). Everyone past third folds into
// Other.
export const SLOT_COLORS = ['#2a78d6', '#eb6834', '#1baf7a'];
export const OTHER_COLOR = '#8a887c';

// 2026 mayoral candidates in their campaign colours, matching the polling
// chart on dash.raccoon.bike (light theme there, validated as a set). The
// live mayor map pins these three to its colour slots, in this order.
export const CANDIDATE_COLORS_2026 = {
  'Olivia Chow': '#854a90',
  'Brad Bradford': '#2e8b57',
  'Chris Alexander': '#54c4cc',
};
export const NO_RESULT_COLOR = '#c9c7bc';

// Fill opacity by the leader's share of the poll: a deeper fill is a more
// lopsided poll.
export const MARGIN_BINS = [
  { min: 0, label: 'Under 40%', opacity: 0.32 },
  { min: 0.4, label: '40–50%', opacity: 0.52 },
  { min: 0.5, label: '50–60%', opacity: 0.72 },
  { min: 0.6, label: '60%+', opacity: 0.92 },
];

export function marginOpacity(share) {
  let opacity = MARGIN_BINS[0].opacity;
  for (const bin of MARGIN_BINS) if (share >= bin.min) opacity = bin.opacity;
  return opacity;
}

// One hue, light to dark, for a single candidate's share.
export const SHARE_RAMP = ['#e6eff9', '#c6dbf2', '#9fc2e8', '#73a5dc', '#4a88cf', '#2a6cbd', '#1b4f91'];

// Breaks for the share view. Fixed 10-point steps would paint a 3% candidate's
// whole map in the palest step, so the step scales to how well they did.
export function shareBreaks(shares) {
  const sorted = shares.filter((s) => s > 0).sort((a, b) => a - b);
  const p95 = sorted.length ? sorted[Math.floor(0.95 * (sorted.length - 1))] : 0;
  const steps = [0.005, 0.01, 0.02, 0.025, 0.05, 0.1];
  const step = steps.find((s) => s * SHARE_RAMP.length >= p95) ?? 0.1;
  return SHARE_RAMP.map((_, i) => i * step);
}

// Swing in Chow's margin since 2023, in points of the ward's vote: green away
// from her, a grey midpoint for little change, purple toward her — the two
// campaign hues, stepped lighter toward the middle.
export const SWING_BINS = [
  { max: -0.1, color: '#2e8b57', label: '10+' },
  { max: -0.05, color: '#6fae89', label: '5–10' },
  { max: -0.02, color: '#acd0ba', label: '2–5' },
  { max: 0.02, color: '#e2e0d6', label: '<2' },
  { max: 0.05, color: '#cdb3d2', label: '2–5' },
  { max: 0.1, color: '#a97bb2', label: '5–10' },
  { max: Infinity, color: '#854a90', label: '10+' },
];

export function swingColor(swing) {
  return SWING_BINS.find((b) => swing < b.max)?.color ?? SWING_BINS[SWING_BINS.length - 1].color;
}

export function shareColor(share, breaks) {
  let i = 0;
  while (i + 1 < breaks.length && share >= breaks[i + 1]) i++;
  return SHARE_RAMP[i];
}

export const sum = (arr) => arr.reduce((s, v) => s + v, 0);
export const fmt = (n) => n.toLocaleString('en-CA');
export const pct = (n, d) => (d ? `${((n / d) * 100).toFixed(1)}%` : '–');
export const pctRound = (x) => `${Math.round(x * 100)}%`;

// The leading position in a poll (an index into its ward's ranked candidates),
// or -1 for a tie at the top or a poll nobody voted in.
export function pollLeader(votes) {
  let best = -1;
  let bestVotes = 0;
  let tied = false;
  for (let i = 0; i < votes.length; i++) {
    if (votes[i] > bestVotes) { best = i; bestVotes = votes[i]; tied = false; }
    else if (votes[i] === bestVotes && bestVotes > 0) tied = true;
  }
  return tied ? -1 : best;
}

export const pollLabel = (ward, sub) => `${String(ward).padStart(2, '0')}-${String(sub).padStart(3, '0')}`;
