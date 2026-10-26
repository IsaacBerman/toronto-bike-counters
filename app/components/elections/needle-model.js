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
  // The three leading candidates' shares of the votes counted so far, for the
  // vote-share chart.
  const cityTotal = [...city.values()].reduce((s, v) => s + v, 0);
  const topShares = [...city].sort((x, y) => y[1] - x[1]).slice(0, 3)
    .map(([c, v]) => [data.candidates[c], v / cityTotal]);

  // Each ward's count mixes two kinds of votes: the regular election-day
  // polls, and four special polls (two advance, mail-in, care homes) that
  // report as large lump sums. The feed only says how many of a ward's polls
  // are in, not which, and the order isn't guaranteed (election day came
  // first in 2023). The special polls are big — a 2026 advance poll holds
  // thousands of votes where an election-day poll holds hundreds — so vote
  // totals hint at the mix, but turnout is unknown too and trades off against
  // it. And the order is citywide: guess it wrong in one ward and it's wrong
  // in all 25.
  //
  // So the night is read three ways — election day first, the lumps first,
  // or polls arriving in no particular order — each fitted with its own
  // turnout. The needle blends them by how well each explains the counts, so
  // when they disagree it shows that rather than picking one.
  //
  // How the special polls vote is not borrowed from 2023, when Chow's margin
  // among advance voters ran 36 points ahead of election day: that was one
  // by-election's campaign, and 2026's advance electorate is bigger and
  // differently spread (advance voting grew most where Chow was weakest). A
  // ward's lumps are projected at its own election-day result, plus a
  // citywide advance-vs-election-day gap that starts at zero — with ±25
  // points of doubt, wide enough to take in a 2023-sized gap — and is learned
  // from the count as lumps report in some wards and not others.
  const SPECIAL_POLLS = 4;
  const GAP_PRIOR = 0.25;
  const marginOf = (c, r, t) => (t > 0 ? (c - r) / t : 0);
  const logChoose = (nn, kk) => lgamma(nn + 1) - lgamma(kk + 1) - lgamma(nn - kk + 1);

  const wards = Object.entries(baseline.wards).map(([w, base]) => {
    const early = base.early ?? { candidate: 0, rival: 0, total: 0 };
    const dayT = base.total - early.total;
    const mDay = marginOf(base.candidate - early.candidate, base.rival - early.rival, dayT);
    const live = data.wards[w];

    // The special polls' sizes: two advance polls (half the ward's advance
    // vote each), mail-in, care homes. 2026's advance vote is known before
    // the night (`advanceExpected`, from the City's advance turnout), so
    // it's used as is; the rest scale 2023's sizes by turnout. Each is
    // [size, fixed].
    const sp = base.special ?? { advance: early, mail: { total: 0 }, ltc: { total: 0 } };
    const adv = live?.advanceExpected > 0 ? [live.advanceExpected / 2, true] : [sp.advance.total / 2, false];
    const specials = [adv, adv, [sp.mail.total, false], [sp.ltc.total, false]];

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
      const part = (inMix) => specials.reduce((acc, [size, fixed], i) => {
        if (Boolean(m.mask & (1 << i)) === inMix) acc[fixed ? 1 : 0] += size;
        return acc;
      }, [0, 0]);
      // Special votes counted and still out, as [scales with turnout, fixed].
      [m.inScaled, m.inFixed] = part(true);
      [m.outScaled, m.outFixed] = part(false);
    }
    const allSpScaled = specials.reduce((s, [size, fixed]) => s + (fixed ? 0 : size), 0);
    const allSpFixed = specials.reduce((s, [size, fixed]) => s + (fixed ? size : 0), 0);
    return { w, dayT, mDay, d: a - b, n, y: n > 0 ? (a - b) / n - mDay : 0, mixes, allSpScaled, allSpFixed };
  });
  const reported = wards.filter((w) => w.n > 0);
  const counted = reported.reduce((s, w) => s + w.n, 0);
  const allIn = data.reporting?.polls > 0 && data.reporting.pollsReceived >= data.reporting.polls;

  // What a mix would add up to at a given turnout (relative to 2023), and
  // how much of that would be special-poll votes.
  const votesOf = (w, m, t) => t * (m.fDay * w.dayT + m.inScaled) + m.inFixed;
  const specialShare = (w, m, t) => {
    const v = votesOf(w, m, t);
    return v > 0 ? (t * m.inScaled + m.inFixed) / v : 0;
  };

  // Turnout relative to 2023: prior centred on 2023's (±30%); each ward may
  // stray ±15% from the citywide figure.
  const TURNOUTS = Array.from({ length: 23 }, (_, i) => 0.6 + i * 0.05);
  const PRIOR_SPREAD = 0.3;
  const WARD_SPREAD = 0.15;
  const fitOf = (n, votes) => (votes > 0 ? Math.exp(-(Math.log(n / votes) ** 2) / (2 * WARD_SPREAD ** 2)) : 1e-12);

  function reading(key) {
    // Turnout, given this reading.
    const logPost = TURNOUTS.map((t) => {
      let lp = -(Math.log(t) ** 2) / (2 * PRIOR_SPREAD ** 2);
      for (const w of reported) lp += Math.log(w.mixes.reduce((s, m) => s + m.q[key] * fitOf(w.n, votesOf(w, m, t)), 0) + 1e-300);
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
        ? m.q[key] * TURNOUTS.reduce((s, t, i) => s + post[i] * fitOf(w.n, votesOf(w, m, t)), 0)
        : 1));
      const total = ws.reduce((s, v) => s + v, 0) || 1;
      weights.set(w, ws.map((v) => v / total));
    }
    const phiOf = (w) => w.mixes.reduce((s, m, i) => s + weights.get(w)[i] * specialShare(w, m, turnout), 0);

    // The advance-vs-election-day gap. Each counted ward's margin, against
    // its 2023 election day, is a citywide swing plus the gap times the share
    // of its count that's special polls; wards with different shares tell the
    // two apart. Fitted with the gap pulled toward zero, so until the count
    // can show otherwise it stays at zero with its full ±25 points of doubt.
    const NOISE = 0.06;
    const mean = counted / Math.max(1, reported.length);
    let s0 = 0; let s1 = 0; let s2 = 0; let t0 = 0; let t1 = 0;
    for (const w of reported) {
      const om = Math.min(3, w.n / mean);
      const f = phiOf(w);
      s0 += om; s1 += om * f; s2 += om * f * f; t0 += om * w.y; t1 += om * f * w.y;
    }
    const ridge = (NOISE / GAP_PRIOR) ** 2;
    const det = s0 * (s2 + ridge) - s1 * s1;
    const gap = det > 0 ? (s0 * t1 - s1 * t0) / det : 0;
    const gapDoubt = det > 0 ? Math.min(GAP_PRIOR, NOISE * Math.sqrt(s0 / det)) : GAP_PRIOR;

    // Ward swings, net of the gap.
    for (const w of wards) for (const m of w.mixes) m.swing = w.n > 0 ? w.y - gap * specialShare(w, m, turnout) : 0;
    const wardSwing = (w) => w.mixes.reduce((s, m, i) => s + weights.get(w)[i] * m.swing, 0);
    const swing = reported.reduce((s, w) => s + w.n * wardSwing(w), 0) / counted;
    const swingVar = reported.reduce((s, w) => s + w.n * (wardSwing(w) - swing) ** 2, 0) / counted;

    let margin = 0;
    let total = 0;
    let leftInReported = 0;
    let leftInUnreported = 0;
    let leftSpecial = 0;
    let leftDayAll = 0;
    let mixVar = 0;
    for (const w of wards) {
      const ws = weights.get(w);
      const wardTotal = turnout * (w.dayT + w.allSpScaled) + w.allSpFixed;
      let wm = 0;
      const outcomes = w.mixes.map((m, i) => {
        const leftDay = (1 - m.fDay) * w.dayT * turnout;
        const leftSp = turnout * m.outScaled + m.outFixed;
        // A ward's own swing counts in proportion to how much of it is in.
        const g = w.n > 0 ? Math.min(1, votesOf(w, m, turnout) / Math.max(1, wardTotal)) : 0;
        const s = g * m.swing + (1 - g) * swing;
        const mm = w.d + leftDay * (w.mDay + s) + leftSp * (w.mDay + s + gap);
        wm += ws[i] * mm;
        total += ws[i] * (w.n + leftDay + leftSp);
        leftSpecial += ws[i] * leftSp;
        leftDayAll += ws[i] * leftDay;
        if (w.n > 0) leftInReported += ws[i] * leftDay;
        else leftInUnreported += ws[i] * (leftDay + leftSp);
        return mm;
      });
      mixVar += w.mixes.reduce((s, m, i) => s + ws[i] * (outcomes[i] - wm) ** 2, 0);
      margin += wm;
    }

    // Doubt, each part scaled by how much of the vote it covers:
    //  - uncounted election-day polls in wards already reporting may not vote
    //    like the counted ones (5 points of margin);
    //  - the advance-vs-election-day gap is uncertain (±25 points until the
    //    count narrows it), and it cuts both ways: the uncounted lumps lean by
    //    it, and the swing read from counted lumps is net of it — so when the
    //    count is mostly one kind of vote, the swing is as unsure as the gap;
    //  - wards not yet reporting depend on the swing, which is uncertain while
    //    few wards are in (8 points with none, narrowing as wards report), plus
    //    how much wards have differed from one another;
    //  - within this reading, not knowing exactly which polls are in;
    //  - the polls counted first may not be typical of the rest — the
    //    quickest to report are often smaller or from particular areas — so
    //    the swing seen early is itself shaky (10 points with nothing counted,
    //    fading as the count fills in).
    // The share of what's been counted that is special-poll votes.
    const countedSpecial = reported.reduce((s, w) => s + w.n * phiOf(w), 0) / counted;
    const k = reported.length;
    const swingDoubt = Math.sqrt(0.08 ** 2 / (1 + k / 3) + swingVar / Math.max(1, wards.length - k));
    const sigma = allIn
      ? 0.0005
      : Math.hypot(
        0.05 * (leftInReported / total),
        gapDoubt * Math.abs((1 - countedSpecial) * leftSpecial - countedSpecial * leftDayAll) / total,
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
      gap,
      share: Math.min(1, counted / total),
      wardSwings: Object.fromEntries(reported.map((w) => [w.w, {
        then: w.mDay + gap * phiOf(w),
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
    // How much better (+) or worse Chow is doing among advance, mail-in and
    // care-home voters than on election day, as learned so far.
    advanceGap: blend((r) => r.gap),
    share: blend((r) => r.share),
    topShares,
    wardsReporting: reported.length,
    allIn,
    // Per ward, for the swing map: Chow's margin now, what her 2023
    // election-day margin implies for the kind of votes counted, and the
    // difference.
    wardSwings: Object.fromEntries(reported.map((w) => [w.w, {
      now: w.d / w.n,
      then: blend((r) => r.wardSwings[w.w].then),
      swing: blend((r) => r.wardSwings[w.w].swing),
    }])),
  };
}
