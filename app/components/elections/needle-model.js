// The election-night needle's estimate, kept free of React so the results API
// route can run it too (to record how it moved over the night).

// Chow, and the challenger shown until results say otherwise. Chow keeps the
// first slot colour and Bradford the second on the live map.
export const NEEDLE = { a: 'Olivia Chow', b: 'Brad Bradford', aShort: 'Chow', bShort: 'Bradford' };

export const surname = (name) => name.split(' ').slice(-1)[0];

// log Γ(x) (Lanczos), for counting how polls could be drawn.
function lgamma(x) {
  const g = [676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059,
    12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
  let a = 0.99999999999980993;
  const t = x + 6.5;
  for (let i = 0; i < 8; i++) a += g[i] / (x + i);
  return 0.5 * Math.log(2 * Math.PI) + (x - 0.5) * Math.log(t) - t + Math.log(a);
}

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
 * margin over that challenger minus her 2023 margin in the same kind of
 * votes — election-day polls against 2023's election day, the advance,
 * mail-in and care-home lumps against 2023's, with the mix of the two in each
 * ward's count inferred from its size (see below). The votes still to come
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

  // Each ward's count mixes two kinds of votes with very different 2023
  // baselines: the regular election-day polls, and four special polls (two
  // advance, mail-in, care homes) that report as large lump sums and leaned
  // far more to Chow. The feed only says how many of a ward's polls are in,
  // not which, and the order isn't guaranteed (election day came first in
  // 2023). The special polls are big — an advance poll holds thousands of
  // votes where an election-day poll holds hundreds — so vote totals hint at
  // the mix, but turnout is unknown too and trades off against it. And the
  // order is citywide: guess it wrong in one ward and it's wrong in all 25.
  //
  // So the night is read three ways — election day first, the lumps first,
  // or polls arriving in no particular order — each fitted with its own
  // turnout. The needle blends them by how well each explains the counts, so
  // when they disagree it shows that rather than picking one.
  const SPECIAL_POLLS = 4;
  const marginOf = (c, r, t) => (t > 0 ? (c - r) / t : 0);
  const logChoose = (nn, kk) => lgamma(nn + 1) - lgamma(kk + 1) - lgamma(nn - kk + 1);

  const wards = Object.entries(baseline.wards).map(([w, base]) => {
    const early = base.early ?? { candidate: 0, rival: 0, total: 0 };
    const dayT = base.total - early.total;
    const mDay = marginOf(base.candidate - early.candidate, base.rival - early.rival, dayT);
    // The special polls with their 2023 sizes and leans: two advance polls
    // (half the ward's advance vote each), mail-in, care homes.
    const sp = base.special ?? { advance: early, mail: { candidate: 0, rival: 0, total: 0 }, ltc: { candidate: 0, rival: 0, total: 0 } };
    const half = (x) => ({ candidate: x.candidate / 2, rival: x.rival / 2, total: x.total / 2 });
    const specials = [half(sp.advance), half(sp.advance), sp.mail, sp.ltc].map((x) => ({ d: x.candidate - x.rival, t: x.total }));

    const live = data.wards[w];
    const a = live ? live.totals[live.cand.indexOf(ai)] ?? 0 : 0;
    const b = live ? live.totals[live.cand.indexOf(ci)] ?? 0 : 0;
    const n = live ? live.totals.reduce((s, v) => s + v, 0) : 0;
    const polls = live?.polls ?? 0;
    const special = polls > SPECIAL_POLLS ? SPECIAL_POLLS : 0;
    const regular = polls - special;
    const received = live?.pollsReceived ?? 0;

    // Every possible mix: which special polls are in (a bitmask over the
    // four) and what share of the regular polls, with how likely it is under
    // each reading of the night before the totals weigh in.
    const bits = (mask) => [0, 1, 2, 3].filter((i) => mask & (1 << i)).length;
    const subsetsOf = (k) => (k === 0 ? [0] : Array.from({ length: 16 }, (_, m) => m).filter((m) => bits(m) === k));
    let mixes = [{ fDay: 0, mask: 0, q: { day: 1, early: 1, random: 1 } }];
    if (n > 0 && received > 0 && regular > 0) {
      mixes = [];
      const kMin = Math.max(0, received - regular);
      const kMax = Math.min(received, special);
      for (let k = kMin; k <= kMax; k++) {
        const random = Math.exp(logChoose(special, k) + logChoose(regular, received - k) - logChoose(polls, received));
        const subsets = subsetsOf(k);
        for (const mask of subsets) {
          mixes.push({
            fDay: (received - k) / regular,
            mask,
            q: {
              day: k === kMin ? 1 / subsets.length : 0,
              early: k === kMax ? 1 / subsets.length : 0,
              random: random / subsets.length,
            },
          });
        }
      }
    } else if (n > 0) {
      // Votes with no polls marked in: could be either kind.
      mixes = [
        { fDay: Math.min(0.9, n / Math.max(1, dayT)), mask: 0, q: { day: 1, early: 0, random: 0.5 } },
        { fDay: 0, mask: 15, q: { day: 0, early: 1, random: 0.5 } },
      ];
    }
    for (const m of mixes) {
      const inSp = specials.filter((_, i) => m.mask & (1 << i));
      m.was = m.fDay * dayT + inSp.reduce((s, x) => s + x.t, 0);
      m.expected = m.was > 0 ? (m.fDay * dayT * mDay + inSp.reduce((s, x) => s + x.d, 0)) / m.was : mDay;
      m.swing = n > 0 ? (a - b) / n - m.expected : 0;
      // The specials still out: their 2023 votes and Chow's margin in them.
      const outSp = specials.filter((_, i) => !(m.mask & (1 << i)));
      m.earlyLeftT = outSp.reduce((s, x) => s + x.t, 0);
      m.earlyLeftD = outSp.reduce((s, x) => s + x.d, 0);
    }
    return { w, dayT, earlyT: early.total, mDay, d: a - b, n, mixes };
  });
  const reported = wards.filter((w) => w.n > 0);
  const counted = reported.reduce((s, w) => s + w.n, 0);
  const allIn = data.reporting?.polls > 0 && data.reporting.pollsReceived >= data.reporting.polls;

  // Turnout relative to 2023: prior centred on 2023's (±30%); each ward may
  // stray ±15% from the citywide figure.
  const TURNOUTS = Array.from({ length: 23 }, (_, i) => 0.6 + i * 0.05);
  const PRIOR_SPREAD = 0.3;
  const WARD_SPREAD = 0.15;
  const fitOf = (n, was, t) => (was > 0 ? Math.exp(-(Math.log(n / (was * t)) ** 2) / (2 * WARD_SPREAD ** 2)) : 1e-12);

  function reading(key) {
    // Turnout, given this reading.
    const logPost = TURNOUTS.map((t) => {
      let lp = -(Math.log(t) ** 2) / (2 * PRIOR_SPREAD ** 2);
      for (const w of reported) lp += Math.log(w.mixes.reduce((s, m) => s + m.q[key] * fitOf(w.n, m.was, t), 0) + 1e-300);
      return lp;
    });
    const top = Math.max(...logPost);
    const post = logPost.map((lp) => Math.exp(lp - top));
    const postSum = post.reduce((s, v) => s + v, 0);
    const evidence = top + Math.log(postSum);
    const turnout = TURNOUTS.reduce((s, t, i) => s + t * post[i], 0) / postSum;

    // Each ward's mixes, weighed.
    const weights = new Map();
    for (const w of wards) {
      const ws = w.mixes.map((m) => (w.n > 0
        ? m.q[key] * TURNOUTS.reduce((s, t, i) => s + post[i] * fitOf(w.n, m.was, t), 0)
        : 1));
      const total = ws.reduce((s, v) => s + v, 0) || 1;
      weights.set(w, ws.map((v) => v / total));
    }
    const wardSwing = (w) => w.mixes.reduce((s, m, i) => s + weights.get(w)[i] * m.swing, 0);
    const swing = reported.reduce((s, w) => s + w.n * wardSwing(w), 0) / counted;
    const swingVar = reported.reduce((s, w) => s + w.n * (wardSwing(w) - swing) ** 2, 0) / counted;

    let margin = 0;
    let total = 0;
    let leftInReported = 0;
    let leftInUnreported = 0;
    let leftEarly = 0;
    let mixVar = 0;
    for (const w of wards) {
      const ws = weights.get(w);
      let wm = 0;
      const outcomes = w.mixes.map((m, i) => {
        const leftDay = (1 - m.fDay) * w.dayT * turnout;
        const leftE = m.earlyLeftT * turnout;
        // A ward's own swing counts in proportion to how much of it is in.
        const g = w.n > 0 ? Math.min(1, m.was / Math.max(1, w.dayT + w.earlyT)) : 0;
        const s = g * m.swing + (1 - g) * swing;
        const mm = w.d + leftDay * (w.mDay + s) + turnout * m.earlyLeftD + leftE * s;
        wm += ws[i] * mm;
        total += ws[i] * (w.n + leftDay + leftE);
        leftEarly += ws[i] * leftE;
        if (w.n > 0) leftInReported += ws[i] * leftDay;
        else leftInUnreported += ws[i] * (leftDay + leftE);
        return mm;
      });
      mixVar += w.mixes.reduce((s, m, i) => s + ws[i] * (outcomes[i] - wm) ** 2, 0);
      margin += wm;
    }

    // Doubt, each part scaled by how much of the vote it covers:
    //  - uncounted election-day polls in wards already reporting may not vote
    //    like the counted ones (5 points of margin);
    //  - the advance, mail-in and care-home lumps may swing differently from
    //    election day (10 points; in 2023 Chow's margin in them was about 36
    //    points better than on election day: +32.8 against −3.3);
    //  - wards not yet reporting depend on the swing, which is uncertain while
    //    few wards are in (8 points with none, narrowing as wards report), plus
    //    how much wards have differed from one another;
    //  - within this reading, not knowing exactly which polls are in;
    //  - the polls counted first may not be typical of the rest — the
    //    quickest to report are often smaller or from particular areas — so
    //    the swing seen early is itself shaky (10 points with nothing counted,
    //    fading as the count fills in).
    const k = reported.length;
    const swingDoubt = Math.sqrt(0.08 ** 2 / (1 + k / 3) + swingVar / Math.max(1, wards.length - k));
    const sigma = allIn
      ? 0.0005
      : Math.hypot(
        0.05 * (leftInReported / total),
        0.1 * (leftEarly / total),
        swingDoubt * (leftInUnreported / total),
        Math.sqrt(mixVar) / total,
        0.1 * (1 - counted / total),
      ) + 0.002;
    const projected = margin / total;
    return {
      evidence,
      projected,
      p: phi(projected / sigma),
      swing,
      share: Math.min(1, counted / total),
      wardSwings: Object.fromEntries(reported.map((w) => [w.w, {
        then: w.mixes.reduce((s, m, i) => s + weights.get(w)[i] * m.expected, 0),
        swing: wardSwing(w),
      }])),
    };
  }

  // Blend the three readings by how well each explains the counts.
  const readings = ['day', 'early', 'random'].map(reading);
  const topEvidence = Math.max(...readings.map((r) => r.evidence));
  const like = readings.map((r) => Math.exp(r.evidence - topEvidence));
  const likeSum = like.reduce((s, v) => s + v, 0);
  const blend = (f) => readings.reduce((s, r, i) => s + (like[i] / likeSum) * f(r), 0);

  return {
    waiting: false,
    challenger,
    p: blend((r) => r.p),
    projected: blend((r) => r.projected),
    swing: blend((r) => r.swing),
    share: blend((r) => r.share),
    wardsReporting: reported.length,
    allIn,
    // Per ward, for the swing map: Chow's margin now, her 2023 margin in the
    // same kind of votes (as best the mix can be told), and the difference.
    wardSwings: Object.fromEntries(reported.map((w) => [w.w, {
      now: w.d / w.n,
      then: blend((r) => r.wardSwings[w.w].then),
      swing: blend((r) => r.wardSwings[w.w].swing),
    }])),
  };
}
