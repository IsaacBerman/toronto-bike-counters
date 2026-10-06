// The election-night needle's estimate, kept free of React so the results API
// route can run it too (to record how it moved over the night).

// Chow, and the challenger shown until results say otherwise. Chow keeps the
// first slot colour and Bradford the second on the live map.
export const NEEDLE = { a: 'Olivia Chow', b: 'Brad Bradford', aShort: 'Chow', bShort: 'Bradford' };

export const surname = (name) => name.split(' ').slice(-1)[0];

// Standard normal CDF (Abramowitz & Stegun 7.1.26, error < 1.5e-7).
function phi(z) {
  const t = 1 / (1 + 0.3275911 * Math.abs(z) / Math.SQRT2);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-(z * z) / 2);
  return z >= 0 ? (1 + y) / 2 : (1 - y) / 2;
}

/**
 * Chow's chance of winning, from how her margin over her closest challenger in
 * the wards counted so far compares with her margin over her closest
 * challenger there in 2023 (Bailão, in every ward). Margins are shares of all
 * votes cast in the ward.
 *
 * The 2026 challenger is whoever is closest to Chow citywide right now —
 * that's who she has to beat. In wards that have reported, the swing is her
 * margin over that challenger minus her 2023 margin. The votes still to come
 * in each ward are projected at its 2023 margin plus the vote-weighted
 * citywide swing (a partly counted ward leans on its own count in proportion
 * to how much is in). The projected citywide margin, with uncertainty that
 * shrinks as the count fills in, gives the probability.
 *
 * Returns null when Chow isn't in the feed, and { waiting: true } before any
 * votes are in.
 */
export function computeNeedle(baseline, data) {
  const ai = data.candidates.indexOf(NEEDLE.a);
  if (ai < 0) return null;

  // Citywide totals, to find who is closest to Chow.
  const city = new Map();
  for (const ward of Object.values(data.wards)) {
    ward.cand.forEach((c, i) => city.set(c, (city.get(c) ?? 0) + ward.totals[i]));
  }
  let ci = data.candidates.indexOf(NEEDLE.b);
  let best = -1;
  for (const [c, v] of city) {
    if (c !== ai && v > best) { best = v; ci = c; }
  }
  if (!(best > 0)) {
    const fallback = data.candidates.indexOf(NEEDLE.b) >= 0 ? NEEDLE.b : null;
    return { waiting: true, challenger: fallback };
  }
  const challenger = data.candidates[ci];

  const wards = Object.entries(baseline.wards).map(([w, base]) => {
    const m23 = base.total ? (base.candidate - base.rival) / base.total : 0;
    const live = data.wards[w];
    const a = live ? live.totals[live.cand.indexOf(ai)] ?? 0 : 0;
    const b = live ? live.totals[live.cand.indexOf(ci)] ?? 0 : 0;
    const n = live ? live.totals.reduce((s, v) => s + v, 0) : 0;
    // Share of the ward counted: polls in, or — when votes have arrived with no
    // polls marked in, as advance votes do — those votes against 2023's.
    const pollsShare = live?.polls ? live.pollsReceived / live.polls : 0;
    const g = n > 0 ? Math.min(1, pollsShare > 0 ? pollsShare : Math.min(0.9, n / Math.max(1, base.total))) : 0;
    return { total23: base.total, m23, d: a - b, n, g };
  });

  const reported = wards.filter((w) => w.n > 0);
  const counted = reported.reduce((s, w) => s + w.n, 0);
  const swing = reported.reduce((s, w) => s + w.n * (w.d / w.n - w.m23), 0) / counted;
  const swingVar = reported.reduce((s, w) => s + w.n * (w.d / w.n - w.m23 - swing) ** 2, 0) / counted;
  // Turnout so far relative to 2023, for sizing wards that haven't reported.
  const turnout = reported.reduce((s, w) => s + w.n / w.g, 0) / reported.reduce((s, w) => s + w.total23, 0);

  let margin = 0;
  let total = 0;
  let leftInReported = 0;
  let leftInUnreported = 0;
  for (const w of wards) {
    const expected = w.n > 0 ? w.n / w.g : w.total23 * turnout;
    const remaining = Math.max(0, expected - w.n);
    const rate = w.n > 0 ? w.g * (w.d / w.n) + (1 - w.g) * (w.m23 + swing) : w.m23 + swing;
    margin += w.d + remaining * rate;
    total += w.n + remaining;
    if (w.n > 0) leftInReported += remaining;
    else leftInUnreported += remaining;
  }
  const projected = margin / total;
  const share = Math.min(1, counted / total);

  // Two sources of doubt, each scaled by how much of the vote it covers:
  //  - uncounted polls in wards already reporting may not vote like the
  //    counted ones (5 points of margin);
  //  - wards not yet reporting depend on the swing, which is uncertain while
  //    few wards are in (8 points with none, narrowing as wards report), plus
  //    how much wards have differed from one another.
  const k = reported.length;
  const unreportedWards = wards.length - k;
  const swingDoubt = Math.sqrt(0.08 ** 2 / (1 + k / 3) + swingVar / Math.max(1, unreportedWards));
  const allIn = data.reporting?.polls > 0 && data.reporting.pollsReceived >= data.reporting.polls;
  const sigma = allIn
    ? 0.0005
    : Math.hypot(0.05 * (leftInReported / total), swingDoubt * (leftInUnreported / total)) + 0.002;

  return {
    waiting: false,
    challenger,
    p: phi(projected / sigma),
    projected,
    swing,
    share,
    wardsReporting: k,
    allIn,
  };
}
