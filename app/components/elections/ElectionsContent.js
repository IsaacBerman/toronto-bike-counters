'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import dynamic from 'next/dynamic';
import {
  RACES, ELECTIONS, OFFICES, raceFor, applyRaceColors, SLOT_COLORS, INCUMBENT_COLORS, OTHER_COLOR, NO_RESULT_COLOR, MARGIN_BINS, SHARE_RAMP,
  SWING_BINS, SCALE_OPACITY, turnoutBreaks, marginOpacity, shareBreaks, shareColor, rampFrom, swingColor, sum, fmt, pct, pctRound, pollLeader, pollLabel,
} from './results';
import { useLiveResults, liveDatasets } from './live';
import { computeNeedle, Needle, NEEDLE } from './needle';
import { applyIncumbents } from './incumbents';

const ElectionMap = dynamic(() => import('./ElectionMap'), {
  ssr: false,
  loading: () => (
    <div className="w-full rounded flex items-center justify-center" style={{ height: 'min(72vh, 640px)', minHeight: 420, background: 'var(--paper)' }}>
      <p className="text-sm" style={{ color: 'var(--ink-3)' }}>Loading map…</p>
    </div>
  ),
});

const RANK_LABELS = ['Ward winner', 'Runner-up', 'Third place'];
// Council maps coloured by incumbency (2026, and past races with their
// sitting councillors marked): the incumbent stays blue; open seats, with no
// incumbent, show their leader in the last colour.
const INCUMBENT_LABELS = ['Incumbent', 'Top challenger', 'Second challenger', 'Open-seat leader', 'Second incumbent'];
// Legend order: both incumbents together, then challengers.
const INCUMBENT_LEGEND = [0, 4, 1, 2, 3];
const SPECIAL_LABELS = { advance: 'Advance polls', mail: 'Mail-in', ltc: 'Care-home polls', unmapped: 'Election-day polls with no boundary' };

// Election-day votes are reported poll by poll; the rest only by ward.
const VOTE_TYPES = [
  { value: 'day', label: 'Election day' },
  { value: 'advance', label: 'Advance' },
  { value: 'mail', label: 'Mail-in' },
  { value: 'all', label: 'All votes' },
];
// The page heading, one format for every race: "2018 Toronto Mayor Election
// Results", or "... By-election Results" for the 2023-2025 by-elections.
function heading(race) {
  const office = race.office === 'mayor' ? 'Mayor' : 'Council';
  const year = race.election === '2023' && race.office === 'council' ? '2023\u20132025' : race.election;
  return `${year} Toronto ${office} ${race.election === '2023' ? 'By-election' : 'Election'} Results`;
}
const VOTE_NOUN = { day: 'election-day votes', advance: 'advance votes', mail: 'mail-in votes', all: 'votes' };

// A ward's votes of one type, aligned to its ranked candidates.
function wardVotes(ward, type) {
  if (type === 'all') return ward.totals;
  if (type === 'day') {
    // Polls with no boundary (2018) are still election-day votes.
    const special = ['advance', 'mail', 'ltc'].map((k) => ward.special[k]).filter(Boolean);
    return ward.totals.map((t, i) => t - sum(special.map((v) => v[i])));
  }
  return ward.special[type] ?? ward.totals.map(() => 0);
}

const escapeHtml = (s) => String(s).replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);

// Everything derived once per race: who gets which colour, citywide totals for
// the mayor's race, and how much of each ward's vote has no place on the map.
function prepare(data) {
  const isMayor = data.id.startsWith('mayor');
  const cityTotals = new Map();
  // The 44 wards came in pairs sharing a name, so those need their number.
  const names = Object.values(data.wards).map((w) => w.name);
  for (const [w, ward] of Object.entries(data.wards)) {
    ward.title = names.indexOf(ward.name) !== names.lastIndexOf(ward.name) ? `Ward ${w} ${ward.name}` : ward.name;
  }
  // Vote types this race reported: no mail-in before 2022, no advance live.
  const voteTypes = VOTE_TYPES.filter((t) => ['day', 'all'].includes(t.value)
    || Object.values(data.wards).some((w) => w.special?.[t.value]));
  const hasLtc = Boolean(data.polls?.features.some((f) => f.properties.ltc));
  const hasElectors = Object.values(data.wards).every((w) => w.electors > 0);
  for (const ward of Object.values(data.wards)) {
    ward.cand.forEach((c, i) => cityTotals.set(c, (cityTotals.get(c) ?? 0) + ward.totals[i]));
    ward.allVotes = sum(ward.totals);
    ward.offMap = sum(Object.values(ward.special).map(sum));
    ward.unmapped = ward.special.unmapped ? sum(ward.special.unmapped) : 0;
  }
  const cityRanked = [...cityTotals].sort((a, b) => b[1] - a[1]);
  // Colour follows the candidate in the mayor's race (Chow is the same blue in
  // every ward) and the finishing position in council, where every ward is a
  // different race.
  // Pinned candidates (the live needle's two) take the first slots outright.
  const pinned = (data.pinned ?? []).map((name) => data.candidates.indexOf(name)).filter((c) => c >= 0);
  const slotOrder = [...pinned, ...cityRanked.map(([c]) => c).filter((c) => !pinned.includes(c))];
  // A race can bring its own colours (2026: the campaigns'); otherwise slots.
  const palette = data.palette ?? SLOT_COLORS;
  const citySlot = new Map(slotOrder.slice(0, palette.length).map((c, i) => [c, i]));
  const slotOf = (ward, pos) => {
    if (pos < 0) return -1;
    if (data.colorRule === 'incumbent') {
      const wd = data.wards[ward];
      if (!wd.totals[pos]) return -1;
      // Incumbents first (a second one, where merged wards had two, in
      // gold), or in an open seat the leader. Everyone else is ranked
      // by votes (candidates are already in vote order), so the first two
      // others are the closest and second challengers.
      const c = wd.cand[pos];
      const incs = wd.incumbents ?? (wd.incumbent != null ? [wd.incumbent] : []);
      if (incs.length) {
        if (c === incs[0]) return 0;
        if (incs.includes(c)) return 4;
      } else if (pos === 0) {
        return 3;
      }
      const head = incs.length ? incs : [wd.cand[0]];
      const rank = wd.cand.slice(0, pos + 1).filter((x) => !head.includes(x)).length;
      return rank === 1 ? 1 : rank === 2 ? 2 : -1;
    }
    if (isMayor) return citySlot.get(data.wards[ward].cand[pos]) ?? -1;
    return pos < palette.length ? pos : -1;
  };
  const offMap = sum(Object.values(data.wards).map((w) => w.offMap));
  const allVotes = sum(Object.values(data.wards).map((w) => w.allVotes));
  const unmapped = sum(Object.values(data.wards).map((w) => w.unmapped));
  return { isMayor, cityRanked, citySlot, slotOrder, slotOf, palette, offMap, unmapped, allVotes, voteTypes, hasLtc, hasElectors };
}

const colorOfSlot = (slot, palette = SLOT_COLORS) => (slot >= 0 ? palette[slot] : OTHER_COLOR);

export default function ElectionsContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  // The 2026 mayoral race leads unless a link asks for another.
  const initialRace = RACES.some((r) => r.id === searchParams.get('race'))
    ? searchParams.get('race')
    : 'mayor-2026';
  const initialWard = Number(searchParams.get('ward'));
  const initialWards = RACES.find((r) => r.id === initialRace).wards;
  const initialVotes = VOTE_TYPES.some((t) => t.value === searchParams.get('votes')) ? searchParams.get('votes') : 'day';
  const initialWardLevel = searchParams.get('by') === 'ward';

  const [raceId, setRaceId] = useState(initialRace);
  const race = RACES.find((r) => r.id === raceId);
  const [cache, setCache] = useState({});
  const [error, setError] = useState(null);
  const [viewPick, setView] = useState('leader'); // 'leader' | 'share' | 'swing' | 'turnout'
  const [votesPick, setVotes] = useState(initialVotes);
  // A race marked live reads the City's election-night feed: ward totals
  // only, with no split by how people voted. None is live between elections.
  const isLive = Boolean(race.live);
  const live = useLiveResults(isLive);
  const outlines = cache.wards;
  const liveData = useMemo(() => {
    if (!live.feed || !outlines) return null;
    const sets = liveDatasets(live.feed, outlines);
    for (const d of Object.values(sets)) d.meta = prepare(d);
    return sets;
  }, [live.feed, outlines]);
  // Past races can be shown ward by ward instead of poll by poll.
  const [wardLevel, setWardLevel] = useState(initialWardLevel);
  const data = isLive ? liveData?.[raceId] : cache[raceId];
  // Swing only exists for 2026's mayor, which has a 2023 to swing from;
  // turnout only where the City gave each ward's electors (2026, from its
  // election-night feed; the boundary files' counts are off for 2022 and 2023).
  const view = (viewPick === 'swing' && raceId !== 'mayor-2026')
    || (viewPick === 'turnout' && !data?.meta.hasElectors) ? 'leader' : viewPick;
  // Both compare whole wards on all their votes.
  const wardOnlyView = view === 'swing' || view === 'turnout';
  // A vote type this race didn't have (mail-in before 2022) reads as election day.
  const votes = isLive || wardOnlyView ? 'all'
    : !data || data.meta.voteTypes.some((t) => t.value === votesPick) ? votesPick : 'day';
  const byWard = votes !== 'day' || wardLevel;
  // Mayor: a candidate index, per race (each has its own candidate list).
  // Council: a finishing position in each ward.
  const [shareTarget, setShareTarget] = useState({ council: 0 });
  const [selectedWard, setSelectedWard] = useState(Number.isInteger(initialWard) && initialWard >= 1 && initialWard <= initialWards ? initialWard : null);
  const [focusWard, setFocusWard] = useState(selectedWard ? { ward: selectedWard } : null);
  const [selectedPoll, setSelectedPoll] = useState(null);


  // The needle compares Chow's ward margins on election night with her 2023
  // ones. Live, it reads the feed; afterwards, the feed as it stood at the end
  // of the count (night-2026.json), kept as an archive.
  const showNeedle = raceId === 'mayor-2026';
  const baseline = cache['needle-baseline'];
  const night = isLive ? live.feed : cache['night-2026'];
  useEffect(() => {
    if (!showNeedle) return undefined;
    const wanted = ['needle-baseline', ...(isLive ? [] : ['night-2026', 'wards'])].filter((f) => !cache[f]);
    if (!wanted.length) return undefined;
    let cancelled = false;
    for (const f of wanted) {
      fetch(`/elections/${f}.json`)
        .then((r) => (r.ok ? r.json() : null))
        .then((b) => { if (b && !cancelled) setCache((c) => ({ ...c, [f]: b })); })
        .catch(() => {});
    }
    return () => { cancelled = true; };
  }, [showNeedle, isLive, cache]);
  const nightMayor = useMemo(
    () => (isLive ? liveData?.['mayor-2026'] : night && outlines ? liveDatasets(night, outlines)['mayor-2026'] : null),
    [isLive, liveData, night, outlines]
  );
  const needle = useMemo(
    () => (showNeedle && baseline && nightMayor ? computeNeedle(baseline, nightMayor) : null),
    [showNeedle, baseline, nightMayor]
  );

  // A live race needs only the ward outlines; every other race its own file.
  const fileId = isLive ? 'wards' : raceId;
  useEffect(() => {
    if (cache[fileId]) return undefined;
    let cancelled = false;
    fetch(`/elections/${fileId}.json`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((d) => {
        if (cancelled) return;
        if (d.id) {
          applyIncumbents(d, INCUMBENT_COLORS);
          applyRaceColors(d);
          d.meta = prepare(d);
        }
        setCache((c) => ({ ...c, [fileId]: d }));
      })
      .catch((e) => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; };
  }, [fileId, cache]);

  useEffect(() => {
    const q = new URLSearchParams({ race: raceId });
    if (votes !== 'day' && !isLive && !wardOnlyView) q.set('votes', votes);
    if (wardLevel && !isLive && votes === 'day') q.set('by', 'ward');
    if (selectedWard) q.set('ward', String(selectedWard));
    router.replace(`?${q.toString()}`, { scroll: false });
  }, [raceId, selectedWard, votes, wardLevel, isLive, wardOnlyView, router]);

  const meta = data?.meta;
  const isMayor = raceId.startsWith('mayor');
  const target = isMayor ? (shareTarget[raceId] ?? meta?.cityRanked[0]?.[0] ?? 0) : shareTarget.council;

  // A poll's votes, its total, and the position (in its ward's ranking) of the
  // candidate the share view is showing.
  const targetPos = useCallback(
    (ward) => (isMayor ? data.wards[ward].cand.indexOf(target) : target),
    [data, isMayor, target]
  );

  // Share-view breaks come from whatever is on the map: polls, or wards.
  const breaks = useMemo(() => {
    if (!data || view !== 'share') return null;
    const units = byWard
      ? Object.entries(data.wards).map(([w, ward]) => [Number(w), wardVotes(ward, votes)])
      : data.polls.features.filter((f) => !f.properties.ltc).map((f) => [f.properties.w, f.properties.v]);
    const shares = [];
    for (const [w, v] of units) {
      const total = sum(v);
      const pos = targetPos(w);
      if (total) shares.push(pos >= 0 ? (v[pos] ?? 0) / total : 0);
    }
    return shareBreaks(shares);
  }, [data, view, targetPos, byWard, votes]);

  // The share view shades in the chosen candidate's own colour: the mayoral
  // candidates' map colours, or a council finishing position's. Anyone
  // without one (and 2026 council, coloured by incumbency) falls back to blue.
  const shareRamp = useMemo(() => {
    if (!meta || view !== 'share') return SHARE_RAMP;
    const color = isMayor
      ? (meta.citySlot.has(target) ? meta.palette[meta.citySlot.get(target)] : null)
      : (data.colorRule ? null : SLOT_COLORS[target]);
    return color ? rampFrom(color) : SHARE_RAMP;
  }, [meta, view, isMayor, target, data]);

  // The fill for a set of votes (a poll's, or a ward's of one type) in ward `w`.
  const fillFor = useCallback((w, v) => {
    const total = sum(v);
    if (!total) return { fillColor: NO_RESULT_COLOR, fillOpacity: 0.1 };
    if (view === 'share') {
      const pos = targetPos(w);
      const share = pos >= 0 ? (v[pos] ?? 0) / total : 0;
      return { fillColor: shareColor(share, breaks, shareRamp), fillOpacity: SCALE_OPACITY };
    }
    const lead = pollLeader(v);
    if (lead < 0) return { fillColor: OTHER_COLOR, fillOpacity: 0.25 };
    return { fillColor: colorOfSlot(meta.slotOf(w, lead), meta.palette), fillOpacity: marginOpacity(v[lead] / total) };
  }, [view, targetPos, breaks, meta, shareRamp]);

  const styleFor = useCallback(
    (p) => (p.ltc || p.none ? { fillColor: NO_RESULT_COLOR, fillOpacity: 0.35 } : fillFor(p.w, p.v)),
    [fillFor]
  );

  // Chow's margin over her closest challenger in a ward now (the needle's
  // challenger) against her 2023 margin over her closest challenger there,
  // both as shares of all votes cast. A plain comparison: the needle's own
  // ward swings net out an advance-vote gap it learns, which helps it project
  // but, once the count was complete, distorted the swing itself.
  const wardSwing = useCallback((w) => {
    const ward = data?.wards[w];
    const base = baseline?.wards[w];
    const total = ward ? sum(ward.totals) : 0;
    if (!total || !base?.total) return null;
    const rivalNow = needle?.challenger ?? NEEDLE.b;
    const votesOf = (name) => ward.totals[ward.cand.indexOf(data.candidates.indexOf(name))] ?? 0;
    const now = (votesOf(NEEDLE.a) - votesOf(rivalNow)) / total;
    const then = (base.candidate - base.rival) / base.total;
    return { now, then, swing: now - then, rivalThen: base.rivalName ?? 'Bailão', rivalNow };
  }, [data, baseline, needle]);

  const tBreaks = useMemo(() => (data && view === 'turnout'
    ? turnoutBreaks(Object.values(data.wards).map((w) => (w.electors ? sum(w.totals) / w.electors : 0)))
    : null), [data, view]);

  const wardStyleFor = useCallback((w) => {
    if (view === 'turnout') {
      const ward = data.wards[w];
      const votesCast = sum(ward.totals);
      return ward.electors && votesCast
        ? { fillColor: shareColor(votesCast / ward.electors, tBreaks), fillOpacity: SCALE_OPACITY }
        : { fillColor: NO_RESULT_COLOR, fillOpacity: 0.1 };
    }
    if (view === 'swing') {
      const s = wardSwing(w);
      return s ? { fillColor: swingColor(s.swing), fillOpacity: SCALE_OPACITY } : { fillColor: NO_RESULT_COLOR, fillOpacity: 0.1 };
    }
    return fillFor(w, wardVotes(data.wards[w], votes));
  }, [view, wardSwing, fillFor, data, votes, tBreaks]);

  // Top three in a set of votes, plus the share view's candidate if they're
  // further down.
  const resultRows = useCallback((w, v) => {
    const ward = data.wards[w];
    const total = sum(v);
    const shown = v.map((_, i) => i).sort((a, b) => v[b] - v[a]).slice(0, 3);
    const pos = view === 'share' ? targetPos(w) : -1;
    if (pos >= 0 && !shown.includes(pos)) shown.push(pos);
    const rows = shown.map((i) => `<tr style="${i === pos ? 'font-weight:700;' : ''}">
        <td style="padding-right:6px"><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${colorOfSlot(meta.slotOf(w, i), meta.palette)}"></span></td>
        <td style="padding-right:8px">${escapeHtml(data.candidates[ward.cand[i]])}</td>
        <td style="text-align:right;font-variant-numeric:tabular-nums">${fmt(v[i] ?? 0)}</td>
        <td style="text-align:right;padding-left:8px;opacity:0.65;font-variant-numeric:tabular-nums">${pct(v[i] ?? 0, total)}</td>
      </tr>`).join('');
    return total ? `<table style="border-collapse:collapse">${rows}</table>` : '';
  }, [data, meta, view, targetPos]);

  const tooltipFor = useCallback((p) => {
    const ward = data.wards[p.w];
    const head = `<div style="font-weight:700">Poll ${pollLabel(p.w, p.s)}</div>
      <div style="opacity:0.7;margin-bottom:4px">Ward ${p.w} ${escapeHtml(ward.name)}${ward.note ? ` · ${escapeHtml(ward.note)}` : ''}</div>`;
    if (p.none) {
      return `<div style="font-size:12px;max-width:240px;white-space:normal">${head}The City reported no result for this poll.</div>`;
    }
    if (p.ltc) {
      return `<div style="font-size:12px;max-width:240px;white-space:normal">${head}Long-term care or retirement home. Its votes were pooled with the ward's other care homes, so there's no result for this building alone.</div>`;
    }
    return `<div style="font-size:12px">${head}${resultRows(p.w, p.v)}
      <div style="margin-top:4px;opacity:0.7">${fmt(sum(p.v))} election-day votes</div></div>`;
  }, [data, resultRows]);

  const wardTooltipFor = useCallback((w) => {
    const ward = data.wards[w];
    // Live races: how much of the ward is in.
    const reporting = ward.polls > 0
      ? `<div style="opacity:0.7">${fmt(ward.pollsReceived)} of ${fmt(ward.polls)} polls reporting</div>`
      : '';
    if (view === 'turnout') {
      const votesCast = sum(ward.totals);
      const done = !data.live || (ward.polls > 0 && ward.pollsReceived >= ward.polls);
      return `<div style="font-size:12px">
        <div style="font-weight:700;margin-bottom:4px">${escapeHtml(ward.title)}</div>
        ${ward.electors ? `<div><b>${pct(votesCast, ward.electors)}</b> turnout${done ? '' : ' so far'}</div>
        <div style="opacity:0.7">${fmt(votesCast)} of ${fmt(ward.electors)} eligible voters</div>` : '<div style="opacity:0.7">No elector count</div>'}
        ${reporting}
      </div>`;
    }
    if (view === 'swing') {
      const s = wardSwing(w);
      const sgn = (x) => `${x >= 0 ? '+' : '−'}${Math.abs(x * 100).toFixed(1)}`;
      const last = (name) => escapeHtml(name.split(' ').slice(-1)[0]);
      return `<div style="font-size:12px">
        <div style="font-weight:700;margin-bottom:4px">${escapeHtml(data.wards[w].title)}</div>
        ${s ? `<table style="border-collapse:collapse;font-variant-numeric:tabular-nums">
          <tr><td style="padding-right:10px">Chow over ${last(s.rivalNow)}, now</td><td style="text-align:right">${sgn(s.now)}</td></tr>
          <tr><td style="padding-right:10px">Chow over ${last(s.rivalThen)}, 2023</td><td style="text-align:right">${sgn(s.then)}</td></tr>
          <tr style="font-weight:700"><td style="padding-right:10px">Swing ${s.swing >= 0 ? 'toward' : 'away from'} Chow</td><td style="text-align:right">${Math.abs(s.swing * 100).toFixed(1)} pts</td></tr>
        </table>` : '<div style="opacity:0.7">No results yet</div>'}
        ${reporting}
      </div>`;
    }
    const v = wardVotes(data.wards[w], votes);
    return `<div style="font-size:12px">
      <div style="font-weight:700">${escapeHtml(data.wards[w].title)}</div>
      ${data.wards[w].note ? `<div style="opacity:0.7">${escapeHtml(data.wards[w].note)}</div>` : ''}
      <div style="margin-bottom:4px"></div>
      ${resultRows(w, v)}
      <div style="margin-top:4px;opacity:0.7">${fmt(sum(v))} ${VOTE_NOUN[votes]}</div>${reporting}</div>`;
  }, [data, votes, resultRows, view, wardSwing]);

  // Clicking the selected ward (or poll, below) again clears the selection.
  const handleSelectWard = useCallback((w) => {
    setSelectedWard((cur) => (cur === w ? null : w));
    setSelectedPoll(null);
  }, []);

  const switchVotes = (type) => {
    setVotes(type);
    if (type !== 'day') setSelectedPoll(null);
  };

  const handleSelectPoll = useCallback((p) => {
    const same = selectedPoll && selectedPoll.w === p.w && selectedPoll.s === p.s;
    setSelectedPoll(same ? null : p);
    setSelectedWard(same ? null : p.w);
  }, [selectedPoll]);

  const pickWard = (ward) => {
    setSelectedWard(ward);
    setSelectedPoll((p) => (p && p.w === ward ? p : null));
    setFocusWard({ ward });
  };

  const switchRace = (id) => {
    if (id === raceId) return;
    // Ward numbers mean different places in the 44- and 25-ward cities.
    const keepWard = RACES.find((r) => r.id === id).wards === race.wards ? selectedWard : null;
    setRaceId(id);
    setSelectedWard(keepWard);
    setSelectedPoll(null);
    setFocusWard(keepWard ? { ward: keepWard } : null);
  };
  // Every election has both races; this falls back to mayor if one doesn't.
  const pickElection = (election) => switchRace((raceFor(election, race.office) ?? raceFor(election, 'mayor')).id);
  const pickOffice = (office) => {
    const r = raceFor(race.election, office);
    if (r) switchRace(r.id);
  };

  if (error) {
    return (
      <div className="min-h-screen pt-10" style={{ background: 'var(--paper)' }}>
        <div className="container mx-auto px-4 max-w-7xl">
          <div className="dd-panel p-6">
            <p style={{ color: 'var(--ink-2)' }}>Could not load the election results ({error}).</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen pt-4 pb-10" style={{ background: 'var(--paper)' }}>
      <div className="container mx-auto px-4 max-w-7xl">
        <div className="mb-4">
          <h1 className="dd-title text-4xl sm:text-5xl mb-2" style={{ color: 'var(--ink)' }}>
            {heading(race)}
          </h1>
        </div>

        <div className="mb-4 dd-panel-ruled p-4 flex flex-wrap items-center gap-x-6 gap-y-3">
          <div className="flex items-center gap-2">
            <label htmlFor="electionSelect" className="dd-kicker" style={{ color: 'var(--ink-2)' }}>Election</label>
            <select
              id="electionSelect"
              className="dd-select"
              value={race.election}
              onChange={(e) => pickElection(e.target.value)}
            >
              {ELECTIONS.map((e) => <option key={e.id} value={e.id}>{e.label}</option>)}
            </select>
          </div>
          <Segmented
            label="Race"
            value={race.office}
            options={OFFICES.map((o) => ({ ...o, disabled: !raceFor(race.election, o.value) }))}
            onChange={pickOffice}
          />
          <Segmented
            label="Show"
            value={view}
            options={[
              { value: 'leader', label: 'Lead' },
              { value: 'share', label: 'Share' },
              ...(raceId === 'mayor-2026' ? [{ value: 'swing', label: 'Swing' }] : []),
              ...(meta?.hasElectors ? [{ value: 'turnout', label: 'Turnout' }] : []),
            ]}
            onChange={setView}
          />
          {!isLive && !wardOnlyView && <Segmented label="Votes" value={votes} options={meta?.voteTypes ?? VOTE_TYPES} onChange={switchVotes} />}
          {!isLive && !wardOnlyView && (
            // Advance and mail-in votes only exist by ward, so the box reads
            // ticked for those. Ticking it shows every vote by ward; unticking
            // goes back to the election-day poll map.
            <label className="flex items-center gap-2 text-sm font-semibold select-none" style={{ color: 'var(--ink-2)' }}>
              <input
                type="checkbox"
                className="h-4 w-4"
                style={{ accentColor: 'var(--ink)' }}
                checked={byWard}
                onChange={(e) => {
                  setWardLevel(e.target.checked);
                  setVotes(e.target.checked ? 'all' : 'day');
                  setSelectedPoll(null);
                }}
              />
              By ward
            </label>
          )}
          {view === 'share' && meta && (
            <div className="flex items-center gap-2">
              <label htmlFor="shareTarget" className="dd-kicker" style={{ color: 'var(--ink-2)' }}>For</label>
              {isMayor ? (
                <select
                  id="shareTarget"
                  className="dd-select"
                  value={target}
                  onChange={(e) => setShareTarget((t) => ({ ...t, [raceId]: Number(e.target.value) }))}
                >
                  {meta.cityRanked.map(([c, votes]) => (
                    <option key={c} value={c}>{data.candidates[c]} ({pct(votes, meta.allVotes)})</option>
                  ))}
                </select>
              ) : (
                <select
                  id="shareTarget"
                  className="dd-select"
                  value={target}
                  onChange={(e) => setShareTarget((t) => ({ ...t, council: Number(e.target.value) }))}
                >
                  {RANK_LABELS.map((label, i) => <option key={i} value={i}>{label}</option>)}
                </select>
              )}
            </div>
          )}
          <div className="flex items-center gap-2">
            <label htmlFor="wardSelect" className="dd-kicker" style={{ color: 'var(--ink-2)' }}>Ward</label>
            <select
              id="wardSelect"
              className="dd-select"
              value={selectedWard ?? ''}
              onChange={(e) => (e.target.value ? pickWard(Number(e.target.value)) : (setSelectedWard(null), setSelectedPoll(null), setFocusWard({ ward: null })))}
            >
              <option value="">Whole city</option>
              {data && Object.entries(data.wards).map(([w, ward]) => (
                <option key={w} value={w}>{w}. {ward.name}</option>
              ))}
            </select>
          </div>
        </div>

        {/* On election night, LiveStatus (from ./live) goes here: polls
            reporting, the headline totals and when the feed last updated. */}

        <div className="grid gap-4 items-start lg:grid-cols-[minmax(0,1fr)_340px]">
          <div className="dd-panel-ruled p-3 sm:p-4 min-w-0">
            {/* The key floats over the map's top-left corner, beside the zoom
                buttons. */}
            <div className="relative">
            {data ? (
              <ElectionMap
                data={data}
                styleFor={styleFor}
                tooltipFor={tooltipFor}
                selectedPoll={selectedPoll}
                selectedWard={selectedWard}
                focusWard={focusWard}
                onSelectPoll={handleSelectPoll}
                byWard={byWard}
                wardStyleFor={wardStyleFor}
                wardTooltipFor={wardTooltipFor}
                onSelectWard={handleSelectWard}
              />
            ) : (
              <div className="w-full rounded flex items-center justify-center" style={{ height: 'min(72vh, 640px)', minHeight: 420, background: 'var(--paper)' }}>
                <p className="text-sm" style={{ color: 'var(--ink-3)' }}>
                  {isLive && live.error && !live.feed
                    ? 'Couldn\u2019t reach the City\u2019s results feed. Trying again in a minute.'
                    : `Loading ${race.label} results…`}
                </p>
              </div>
            )}
            {data && (
              <div
                className="absolute top-2.5 left-12 z-[1000] rounded p-2.5 text-xs"
                style={{
                  maxWidth: 'calc(100% - 3.75rem)',
                  background: 'color-mix(in srgb, var(--panel) 92%, transparent)',
                  border: '1px solid var(--line)',
                  boxShadow: '0 1px 3px rgba(22, 21, 15, 0.12)',
                }}
              >
                <Legend
                  view={view}
                  byWard={byWard}
                  isMayor={isMayor}
                  data={data}
                  breaks={breaks}
                  tBreaks={tBreaks}
                  ramp={shareRamp}
                />
              </div>
            )}
            </div>
          </div>

          {/* The results head the right column; election night's dial sits
              below them, folded away as an archive. */}
          <div className="flex flex-col gap-4 min-w-0">
            {data && selectedPoll && (
              <PollCard data={data} poll={selectedPoll} onClose={() => setSelectedPoll(null)} />
            )}
            {data?.wards[selectedWard] && <WardCard data={data} ward={selectedWard} votes={votes} />}
            {data && !selectedWard && (isMayor
              ? <CityCard data={data} votes={votes} />
              : <WardList data={data} votes={votes} onPick={pickWard} />)}
            {showNeedle && needle && (
              <Needle archived={!isLive} needle={needle} history={night?.needleHistory} seq={night?.seq} reporting={nightMayor?.reporting} />
            )}
          </div>
        </div>

        <div className="mt-8 dd-panel p-6 text-sm space-y-2" style={{ color: 'var(--ink-2)' }}>
          {isLive ? (
            <p>
              Unofficial results from the City of Toronto&rsquo;s election-night feed.
            </p>
          ) : (
            <p></p>
          )}
          <p>
            Poll-by-poll results and voting subdivision boundaries from the{' '}
            <a href="https://open.toronto.ca/dataset/elections-voting-subdivisions/" target="_blank" rel="noopener noreferrer" className="dd-link-accent">
              City of Toronto Open Data Portal
            </a>
            {race.election === '2026' ? (
              <>
                , except the 2026 boundaries, from the City&rsquo;s{' '}
                <a href="https://gis.toronto.ca/arcgis/rest/services/cot_geospatial6/MapServer/10" target="_blank" rel="noopener noreferrer" className="dd-link-accent">
                  map server
                </a>
                . Turnout uses the eligible voters the City reported on election night.
              </>
            ) : '.'}
          </p>
        </div>
      </div>
    </div>
  );
}

function Segmented({ label, value, options, onChange }) {
  return (
    <div className="flex items-center gap-2 min-w-0 max-w-full">
      <span className="dd-kicker shrink-0" style={{ color: 'var(--ink-2)' }}>{label}</span>
      {/* Wraps onto a second row on narrow screens rather than running off the page. */}
      <div className="flex flex-wrap min-w-0 rounded overflow-hidden" style={{ border: '1px solid var(--line)' }} role="group" aria-label={label}>
        {options.map((o) => {
          const on = o.value === value;
          return (
            <button
              key={o.value}
              type="button"
              aria-pressed={on}
              disabled={o.disabled}
              onClick={() => onChange(o.value)}
              className="px-3 py-1.5 text-sm font-semibold transition-colors whitespace-nowrap disabled:cursor-not-allowed"
              style={{
                background: on ? 'var(--ink)' : 'var(--panel)',
                color: on ? '#fff' : o.disabled ? 'var(--ink-3)' : 'var(--ink-2)',
                opacity: o.disabled ? 0.5 : 1,
              }}
            >
              {o.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

const Swatch = ({ color, opacity = 1, width = 14 }) => (
  <span className="inline-block shrink-0 rounded-sm" style={{ width, height: 12, background: color, opacity }} />
);

// A light-to-dark ramp with a value under each step.
function RampKey({ colors, labels, width = 34 }) {
  return (
    <div className="flex items-end gap-0.5">
      {colors.map((c, i) => (
        <div key={i} className="flex flex-col items-start" style={{ width }}>
          <span className="block w-full rounded-sm" style={{ height: 12, background: c, opacity: SCALE_OPACITY }} />
          <span className="mt-0.5" style={{ color: 'var(--ink-3)', fontVariantNumeric: 'tabular-nums' }}>{labels[i]}</span>
        </div>
      ))}
    </div>
  );
}

function Legend({ view, byWard, isMayor, data, breaks, tBreaks, ramp }) {
  if (data.live && !data.meta.allVotes) {
    return <p style={{ color: 'var(--ink-3)' }}>Wards fill in as results are counted.</p>;
  }
  const rampLabels = (b) => b.map((x, i) => (i === b.length - 1 ? `${pctRound(x)}+` : pctRound(x)));
  if (view === 'turnout') {
    return <RampKey colors={SHARE_RAMP} labels={rampLabels(tBreaks)} />;
  }
  if (view === 'swing') {
    return (
      <>
        <RampKey colors={SWING_BINS.map((b) => b.color)} labels={SWING_BINS.map((b) => b.label)} width={30} />
        <div className="flex justify-between mt-0.5" style={{ width: 32 * 7 - 2, color: 'var(--ink-2)' }}>
          <span>&larr; From Chow</span>
          <span style={{ color: 'var(--ink-3)' }}>vs 2023</span>
          <span>To Chow &rarr;</span>
        </div>
      </>
    );
  }
  if (view === 'share') {
    return <RampKey colors={ramp} labels={rampLabels(breaks)} />;
  }
  // [slot, label] pairs. Where a ward had two incumbents (2018), they're the
  // top and second incumbents; elsewhere just "Incumbent".
  const twoIncumbents = Object.values(data.wards).some((w) => (w.incumbents?.length ?? 0) > 1);
  // Only the entries that occur: the by-elections had no incumbents.
  const anyIncumbent = Object.values(data.wards).some((w) => w.incumbent != null);
  const anyOpen = Object.values(data.wards).some((w) => w.incumbent == null);
  const labels = isMayor
    ? data.meta.slotOrder.slice(0, data.meta.palette.length).map((c, i) => [i, data.candidates[c]])
    : data.colorRule === 'incumbent'
      ? INCUMBENT_LEGEND.filter((i) => (i !== 4 || twoIncumbents) && (i !== 0 || anyIncumbent) && (i !== 3 || anyOpen))
        .map((i) => [i, i === 0 && twoIncumbents ? 'Top incumbent' : INCUMBENT_LABELS[i]])
      : RANK_LABELS.map((label, i) => [i, label]);
  const rows = [...labels.map(([i, label]) => [label, data.meta.palette[i]]), ['Anyone else', OTHER_COLOR]];
  // Each row is its own colour at the four depths the map uses for how big
  // the leader's share was.
  return (
    <>
      <table className="border-collapse" style={{ color: 'var(--ink-2)' }}>
        <thead>
          <tr>
            <th className="font-normal text-left pr-2" style={{ color: 'var(--ink-3)' }}>Leader&rsquo;s share, %</th>
            {MARGIN_BINS.map((b) => (
              <th key={b.label} className="font-normal text-left px-px" style={{ color: 'var(--ink-3)', fontVariantNumeric: 'tabular-nums' }}>{b.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(([label, color]) => (
            <tr key={label}>
              <td className="pr-2 py-px whitespace-nowrap">{label}</td>
              {MARGIN_BINS.map((b) => (
                <td key={b.label} className="px-px py-px"><Swatch color={color} opacity={b.opacity} width={22} /></td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {data.meta.hasLtc && !byWard && (
        <p className="flex items-center gap-1.5 mt-1.5" style={{ color: 'var(--ink-2)' }}>
          <Swatch color={NO_RESULT_COLOR} opacity={0.5} />Care home, no separate result
        </p>
      )}
    </>
  );
}

// Candidate rows with a bar each, top `limit` then everyone else summed.
// Clicking the "others" row lists every candidate. `always` (an index) is
// listed even if it falls outside the top, so an incumbent never disappears
// into "others".
function ResultBars({ names, votes, colors, limit = 6, always = -1 }) {
  const [expanded, setExpanded] = useState(false);
  const total = sum(votes);
  const order = votes.map((v, i) => i).sort((a, b) => votes[b] - votes[a]);
  const top = expanded ? order : order.slice(0, limit);
  if (always >= 0 && !top.includes(always)) top.push(always);
  const rest = order.filter((i) => !top.includes(i));
  const restVotes = sum(rest.map((i) => votes[i]));
  const max = Math.max(1, ...top.map((i) => votes[i]), restVotes);
  const row = (key, name, v, color) => (
    <li key={key} className="text-sm">
      <div className="flex justify-between gap-3">
        <span className="truncate" style={{ color: 'var(--ink)' }}>{name}</span>
        <span className="shrink-0" style={{ color: 'var(--ink-2)', fontVariantNumeric: 'tabular-nums' }}>
          {fmt(v)} <span className="inline-block w-12 text-right" style={{ color: 'var(--ink-3)' }}>{pct(v, total)}</span>
        </span>
      </div>
      <div className="mt-1 h-1.5 rounded-sm" style={{ background: 'var(--paper)' }}>
        <div className="h-full rounded-sm" style={{ width: `${(v / max) * 100}%`, background: color }} />
      </div>
    </li>
  );
  return (
    <ul className="space-y-2.5">
      {top.map((i) => row(i, names[i], votes[i], colors[i]))}
      {rest.length > 0 && row('rest', `${rest.length} others`, restVotes, OTHER_COLOR)}
      {(rest.length > 0 || expanded) && (
        <li>
          <button type="button" onClick={() => setExpanded((e) => !e)} className="dd-link-accent text-sm">
            {expanded ? 'Show top candidates only' : `Show all ${votes.length} candidates`}
          </button>
        </li>
      )}
    </ul>
  );
}

function wardColors(data, w) {
  return data.wards[w].cand.map((_, pos) => colorOfSlot(data.meta.slotOf(w, pos), data.meta.palette));
}

function PollCard({ data, poll, onClose }) {
  const ward = data.wards[poll.w];
  const names = ward.cand.map((c) => data.candidates[c]);
  const votes = ward.cand.map((_, i) => poll.v?.[i] ?? 0);
  return (
    <div className="dd-panel">
      <div className="p-4 flex items-start justify-between gap-3" style={{ borderBottom: '1px solid var(--line)' }}>
        <div>
          <h2 className="dd-title text-lg" style={{ color: 'var(--ink)' }}>Poll {pollLabel(poll.w, poll.s)}</h2>
          <p className="text-xs mt-1" style={{ color: 'var(--ink-3)' }}>
            {poll.ltc ? 'Care home' : poll.none ? 'No result' : `${fmt(sum(votes))} election-day votes`}
          </p>
        </div>
        <button type="button" onClick={onClose} className="text-sm" style={{ color: 'var(--ink-3)' }} aria-label="Close poll">✕</button>
      </div>
      <div className="p-4">
        {poll.none ? (
          <p className="text-sm" style={{ color: 'var(--ink-2)' }}>The City reported no result for this poll.</p>
        ) : poll.ltc ? (
          <p className="text-sm" style={{ color: 'var(--ink-2)' }}>
            Votes from long-term care and retirement homes were pooled across each ward and
            reported as one result, so this building has none of its own. They&rsquo;re in the
            ward totals below.
          </p>
        ) : (
          <ResultBars names={names} votes={votes} colors={wardColors(data, poll.w)} />
        )}
      </div>
    </div>
  );
}

function WardCard({ data, ward: w, votes }) {
  const ward = data.wards[w];
  const shown = wardVotes(ward, votes);
  const names = ward.cand.map((c) => `${data.candidates[c]}${(ward.incumbents ?? []).includes(c) ? ' (incumbent)' : ''}`);
  const onMap = ward.allVotes - ward.offMap;
  return (
    <div className="dd-panel">
      <div className="p-4" style={{ borderBottom: '1px solid var(--line)' }}>
        <h2 className="dd-title text-lg" style={{ color: 'var(--ink)' }}>{ward.title}</h2>
        <p className="text-xs mt-1" style={{ color: 'var(--ink-3)' }}>
          {data.live
            ? `${fmt(ward.pollsReceived)} of ${fmt(ward.polls)} polls reporting · ${fmt(ward.allVotes)} votes${ward.electors ? ` · ${pct(ward.allVotes, ward.electors)} turnout` : ''}`
            : votes === 'all'
            ? `${data.meta.isMayor ? 'Mayoral votes cast in this ward' : ward.note ?? 'Council race result'} · ${fmt(ward.allVotes)} votes`
            : `${fmt(sum(shown))} ${VOTE_NOUN[votes]} of ${fmt(ward.allVotes)}`}
          {ward.note && votes !== 'all' && ` · ${ward.note}`}
        </p>
      </div>
      <div className="p-4">
        <ResultBars names={names} votes={shown} colors={wardColors(data, w)} always={ward.incumbent != null ? ward.cand.indexOf(ward.incumbent) : -1} />
        {!data.live && <dl className="mt-4 pt-3 text-xs grid grid-cols-[1fr_auto_auto] gap-x-3 gap-y-1" style={{ borderTop: '1px solid var(--line)', color: 'var(--ink-2)' }}>
          <dt>{ward.unmapped ? 'Election-day polls on map' : 'Election-day polls'}</dt>
          <dd style={{ fontVariantNumeric: 'tabular-nums' }}>{fmt(onMap)}</dd>
          <dd className="text-right" style={{ color: 'var(--ink-3)', fontVariantNumeric: 'tabular-nums' }}>{pct(onMap, ward.allVotes)}</dd>
          {Object.entries(ward.special).map(([kind, votes]) => (
            <SpecialRow key={kind} label={SPECIAL_LABELS[kind]} votes={sum(votes)} total={ward.allVotes} />
          ))}
        </dl>}
      </div>
    </div>
  );
}

function SpecialRow({ label, votes, total }) {
  return (
    <>
      <dt>{label}</dt>
      <dd style={{ fontVariantNumeric: 'tabular-nums' }}>{fmt(votes)}</dd>
      <dd className="text-right" style={{ color: 'var(--ink-3)', fontVariantNumeric: 'tabular-nums' }}>{pct(votes, total)}</dd>
    </>
  );
}

// Citywide turnout so far, when every ward has an elector count.
function cityTurnout(data, votesCast) {
  const wards = Object.values(data.wards);
  const electors = sum(wards.map((w) => w.electors ?? 0));
  return electors && wards.every((w) => w.electors) ? ` · ${pct(votesCast, electors)} turnout` : '';
}

function CityCard({ data, votes: type }) {
  const { cityRanked, allVotes } = data.meta;
  const names = cityRanked.map(([c]) => data.candidates[c]);
  const byCandidate = new Map();
  for (const ward of Object.values(data.wards)) {
    wardVotes(ward, type).forEach((v, i) => byCandidate.set(ward.cand[i], (byCandidate.get(ward.cand[i]) ?? 0) + v));
  }
  const votes = cityRanked.map(([c]) => byCandidate.get(c) ?? 0);
  const colors = cityRanked.map(([c]) => colorOfSlot(data.meta.citySlot.get(c) ?? -1, data.meta.palette));
  return (
    <div className="dd-panel">
      <div className="p-4" style={{ borderBottom: '1px solid var(--line)' }}>
        <h2 className="dd-title text-lg" style={{ color: 'var(--ink)' }}>{data.title}</h2>
        <p className="text-xs mt-1" style={{ color: 'var(--ink-3)' }}>
          {data.live
            ? `${fmt(data.reporting.pollsReceived)} of ${fmt(data.reporting.polls)} polls reporting · ${fmt(allVotes)} votes${cityTurnout(data, allVotes)}`
            : type === 'all'
            ? `${fmt(allVotes)} votes, ${data.candidates.length} candidates`
            : `${fmt(sum(votes))} ${VOTE_NOUN[type]} of ${fmt(allVotes)}`}
        </p>
      </div>
      <div className="p-4">
        <ResultBars names={names} votes={votes} colors={colors} limit={8} />
      </div>
    </div>
  );
}

// Council has no citywide result, so the starting panel is the 25 winners.
function WardList({ data, votes, onPick }) {
  return (
    <div className="dd-panel">
      <div className="p-4" style={{ borderBottom: '1px solid var(--line)' }}>
        <h2 className="dd-title text-lg" style={{ color: 'var(--ink)' }}>{data.title}</h2>
        <p className="text-xs mt-1" style={{ color: 'var(--ink-3)' }}>
          {data.live ? 'Leading in each ward' : votes === 'all' ? 'Ward winners' : `Who led each ward's ${VOTE_NOUN[votes]}`}
        </p>
      </div>
      <ul className="divide-y" style={{ borderColor: 'var(--line)' }}>
        {Object.entries(data.wards).map(([w, ward]) => {
          const v = wardVotes(ward, votes);
          const lead = Math.max(0, pollLeader(v));
          const counted = sum(v) > 0;
          return (
          <li key={w}>
            <button
              type="button"
              onClick={() => onPick(Number(w))}
              className="w-full text-left px-4 py-2 text-sm flex justify-between gap-3 hover:bg-[var(--paper)]"
            >
              <span className="min-w-0">
                <span className="block truncate font-semibold" style={{ color: counted ? 'var(--ink)' : 'var(--ink-3)' }}>
                  {counted ? data.candidates[ward.cand[lead]] : 'No results yet'}
                </span>
                <span className="block truncate text-xs" style={{ color: 'var(--ink-3)' }}>{w}. {ward.name}{ward.note && ` · ${ward.note}`}</span>
              </span>
              <span className="shrink-0 self-center" style={{ color: 'var(--ink-2)', fontVariantNumeric: 'tabular-nums' }}>
                {counted ? pct(v[lead] ?? 0, sum(v)) : ''}
              </span>
            </button>
          </li>
          );
        })}
      </ul>
    </div>
  );
}
