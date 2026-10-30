// Shared colour and arithmetic for the election map, its legend and the side
// panel, so all three agree on what a colour means.

// Each election (picked from a menu) and the offices it decided (a toggle).
// 2023-2025: the mayoral by-election and three ward by-elections. Before
// 2018 the city had 44 wards.
export const ELECTIONS = [
  { id: '2026', label: '2026' },
  { id: '2023', label: '2023–2025 by-elections' },
  { id: '2022', label: '2022' },
  { id: '2018', label: '2018' },
  { id: '2014', label: '2014', wards: 44 },
  { id: '2010', label: '2010', wards: 44 },
  { id: '2006', label: '2006', wards: 44 },
];

export const OFFICES = [
  { value: 'mayor', label: 'Mayor' },
  { value: 'council', label: 'Council' },
];

export const RACES = [
  // Poll by poll since the City certified the results. On election night
  // these were `live: true`, reading ward totals from the City's feed; mark
  // a race live again to do the same next time.
  { id: 'mayor-2026', label: '2026 Mayoral Election' },
  { id: 'council-2026', label: '2026 City Council' },
  { id: 'mayor-2023', label: '2023 Mayoral By-election' },
  { id: 'council-2023', label: '2023–2025 Council By-elections' },
  ...['2022', '2018', '2014', '2010', '2006'].flatMap((y) => [
    { id: `mayor-${y}`, label: `${y} Mayoral Election` },
    { id: `council-${y}`, label: `${y} City Council` },
  ]),
].map((r) => {
  const [office, election] = r.id.split('-');
  return { ...r, office, election, wards: ELECTIONS.find((e) => e.id === election).wards ?? 25 };
});

export const raceFor = (election, office) => RACES.find((r) => r.election === election && r.office === office);

// The first three slots of the validated categorical palette, which are the
// only ones that stay distinguishable from every other slot on a choropleth
// (each polygon can sit next to any other). Everyone past third folds into
// Other.
export const SLOT_COLORS = ['#2a78d6', '#eb6834', '#1baf7a'];
// Council maps coloured by incumbency: incumbent, closest challenger, second
// challenger, open-seat leader, and (2018, where merged wards had two) the
// second incumbent in gold.
export const INCUMBENT_COLORS = ['#2a78d6', '#eb6834', '#8e6bbf', '#1baf7a', '#d9a400'];
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

// Races drawn in their campaigns' colours rather than the slot palette.
// Chris Alexander led no poll or ward in 2026, so he folds into Anyone else.
export const RACE_COLORS = {
  'mayor-2026': {
    'Olivia Chow': CANDIDATE_COLORS_2026['Olivia Chow'],
    'Brad Bradford': CANDIDATE_COLORS_2026['Brad Bradford'],
  },
};

// Pins a race's candidates to their campaign colours, in place.
export function applyRaceColors(data) {
  const colors = RACE_COLORS[data.id];
  if (!colors) return;
  data.pinned = Object.keys(colors);
  data.palette = Object.values(colors);
}

// The lead view shades each poll in its leader's colour by how far ahead
// they were: their margin over the runner-up, in points of the poll's vote.
// Pale is a toss-up, deep a landslide.
export function leadMargin(votes) {
  const lead = pollLeader(votes);
  if (lead < 0) return { lead, margin: 0 };
  const total = sum(votes);
  const runnerUp = Math.max(0, ...votes.filter((_, i) => i !== lead));
  return { lead, margin: total ? (votes[lead] - runnerUp) / total : 0 };
}

// Six steps. Under 5 points is always the first, a toss-up; the rest space
// out to fit the race, in whole steps of 5, 10, 15 or 20 points, whichever
// puts the deepest shade closest to the strongest fifth of polls. The
// competitive races (2006-2014, 2026) run to 45+; Tory's landslides to 65+.
export function marginBreaks(margins) {
  const sorted = margins.filter((m) => m > 0).sort((a, b) => a - b);
  const p80 = sorted.length ? sorted[Math.floor(0.8 * (sorted.length - 1))] : 0;
  const steps = [0.05, 0.1, 0.15, 0.2];
  const step = steps.reduce((best, st) => (Math.abs(0.05 + 4 * st - p80) < Math.abs(0.05 + 4 * best - p80) ? st : best));
  return [0, 0.05, 0.05 + step, 0.05 + 2 * step, 0.05 + 3 * step, 0.05 + 4 * step];
}

export function marginStep(margin, breaks) {
  let i = 0;
  while (i + 1 < breaks.length && margin >= breaks[i + 1]) i++;
  return i;
}

export const marginLabels = (breaks) => breaks.map((b, i) => {
  const pts = Math.round(b * 100);
  if (i === 0) return `<${Math.round(breaks[1] * 100)}`;
  return i === breaks.length - 1 ? `${pts}+` : `${pts}`;
});

// Six shades of one colour, pale to deep, one per margin step: tints toward
// white, the colour itself, then a touch darker.
const leadRamps = new Map();
export function leadRamp(hex) {
  if (!leadRamps.has(hex)) {
    const rgb = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
    const mix = (t, toward) => `#${rgb.map((c) => Math.round(c + (toward - c) * t).toString(16).padStart(2, '0')).join('')}`;
    leadRamps.set(hex, [0.6, 0.45, 0.3, 0.15].map((t) => mix(t, 255)).concat(hex, mix(0.3, 0)));
  }
  return leadRamps.get(hex);
}

// The fill for the share, swing and turnout scales. The map multiplies the
// fills with the basemap, so streets show through even near full strength.
export const SCALE_OPACITY = 0.85;

// One hue, light to dark, for a single candidate's share: eight steps, so a
// 10-point scale runs to 70%+.
export const SHARE_RAMP = ['#e6eff9', '#c6dbf2', '#9fc2e8', '#73a5dc', '#4a88cf', '#2a6cbd', '#1b4f91', '#11335f'];
// Turnout keeps seven: the wards span about 25 points.
export const TURNOUT_RAMP = SHARE_RAMP.slice(0, 7);

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

// Turnout, as a share of eligible voters, on the same light-to-dark ramp,
// spanning the wards' actual range: from the lowest ward (rounded down) in
// the smallest whole-point step that puts the highest ward in the darkest.
export function turnoutBreaks(turnouts) {
  const values = turnouts.filter((t) => t > 0);
  if (!values.length) return TURNOUT_RAMP.map((_, i) => i * 0.05);
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const steps = [0.01, 0.02, 0.03, 0.04, 0.05, 0.1];
  for (const step of steps) {
    const start = Math.floor(lo / step) * step;
    // The last step is open-ended ("56%+"), so the highest ward only has to
    // fall below where an eighth step would start.
    if (start + TURNOUT_RAMP.length * step > hi || step === steps[steps.length - 1]) {
      return TURNOUT_RAMP.map((_, i) => start + i * step);
    }
  }
  return null;
}

// A light-to-dark ramp in one candidate's colour, the same length as
// SHARE_RAMP: tints toward white for small shares, the full colour (then a
// touch darker) for the largest.
export function rampFrom(hex) {
  const rgb = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const mix = (t, toward) => `#${rgb.map((c) => Math.round(c + (toward - c) * t).toString(16).padStart(2, '0')).join('')}`;
  return [0.88, 0.74, 0.58, 0.42, 0.24, 0].map((t) => mix(t, 255)).concat(mix(0.22, 0), mix(0.42, 0));
}

export function shareColor(share, breaks, ramp = SHARE_RAMP) {
  let i = 0;
  while (i + 1 < breaks.length && share >= breaks[i + 1]) i++;
  return ramp[i];
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
