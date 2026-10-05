'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import dynamic from 'next/dynamic';
import {
  RACES, SLOT_COLORS, OTHER_COLOR, NO_RESULT_COLOR, MARGIN_BINS, SHARE_RAMP,
  marginOpacity, shareBreaks, shareColor, sum, fmt, pct, pctRound, pollLeader, pollLabel,
} from './results';

const ElectionMap = dynamic(() => import('./ElectionMap'), {
  ssr: false,
  loading: () => (
    <div className="w-full rounded flex items-center justify-center" style={{ height: 'min(72vh, 640px)', minHeight: 420, background: 'var(--paper)' }}>
      <p className="text-sm" style={{ color: 'var(--ink-3)' }}>Loading map…</p>
    </div>
  ),
});

const RANK_LABELS = ['Ward winner', 'Runner-up', 'Third place'];
const SPECIAL_LABELS = { advance: 'Advance polls', mail: 'Mail-in', ltc: 'Care-home polls' };

const escapeHtml = (s) => String(s).replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);

// Everything derived once per race: who gets which colour, citywide totals for
// the mayor's race, and how much of each ward's vote has no place on the map.
function prepare(data) {
  const isMayor = data.id.startsWith('mayor');
  const cityTotals = new Map();
  for (const ward of Object.values(data.wards)) {
    ward.cand.forEach((c, i) => cityTotals.set(c, (cityTotals.get(c) ?? 0) + ward.totals[i]));
    ward.allVotes = sum(ward.totals);
    ward.offMap = sum(Object.values(ward.special).map(sum));
  }
  const cityRanked = [...cityTotals].sort((a, b) => b[1] - a[1]);
  // Colour follows the candidate in the mayor's race (Chow is the same blue in
  // every ward) and the finishing position in council, where every ward is a
  // different race.
  const citySlot = new Map(cityRanked.slice(0, SLOT_COLORS.length).map(([c], i) => [c, i]));
  const slotOf = (ward, pos) => {
    if (pos < 0) return -1;
    if (isMayor) return citySlot.get(data.wards[ward].cand[pos]) ?? -1;
    return pos < SLOT_COLORS.length ? pos : -1;
  };
  const offMap = sum(Object.values(data.wards).map((w) => w.offMap));
  const allVotes = sum(Object.values(data.wards).map((w) => w.allVotes));
  return { isMayor, cityRanked, slotOf, offMap, allVotes };
}

const colorOfSlot = (slot) => (slot >= 0 ? SLOT_COLORS[slot] : OTHER_COLOR);

export default function ElectionsContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialRace = RACES.some((r) => r.id === searchParams.get('race')) ? searchParams.get('race') : RACES[0].id;
  const initialWard = Number(searchParams.get('ward'));

  const [raceId, setRaceId] = useState(initialRace);
  const [cache, setCache] = useState({});
  const [error, setError] = useState(null);
  const [view, setView] = useState('leader'); // 'leader' | 'share'
  // Mayor: a candidate index. Council: a finishing position in each ward.
  const [shareTarget, setShareTarget] = useState({ mayor: null, council: 0 });
  const [selectedWard, setSelectedWard] = useState(Number.isInteger(initialWard) && initialWard >= 1 && initialWard <= 25 ? initialWard : null);
  const [focusWard, setFocusWard] = useState(selectedWard ? { ward: selectedWard } : null);
  const [selectedPoll, setSelectedPoll] = useState(null);

  const data = cache[raceId];

  useEffect(() => {
    if (cache[raceId]) return undefined;
    let cancelled = false;
    fetch(`/elections/${raceId}.json`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((d) => {
        if (cancelled) return;
        d.meta = prepare(d);
        setCache((c) => ({ ...c, [raceId]: d }));
      })
      .catch((e) => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; };
  }, [raceId, cache]);

  useEffect(() => {
    const q = new URLSearchParams({ race: raceId });
    if (selectedWard) q.set('ward', String(selectedWard));
    router.replace(`?${q.toString()}`, { scroll: false });
  }, [raceId, selectedWard, router]);

  const meta = data?.meta;
  const isMayor = raceId.startsWith('mayor');
  const target = isMayor ? (shareTarget.mayor ?? meta?.cityRanked[0]?.[0] ?? 0) : shareTarget.council;

  // A poll's votes, its total, and the position (in its ward's ranking) of the
  // candidate the share view is showing.
  const targetPos = useCallback(
    (ward) => (isMayor ? data.wards[ward].cand.indexOf(target) : target),
    [data, isMayor, target]
  );

  const breaks = useMemo(() => {
    if (!data || view !== 'share') return null;
    const shares = [];
    for (const f of data.polls.features) {
      const p = f.properties;
      if (p.ltc) continue;
      const total = sum(p.v);
      const pos = targetPos(p.w);
      if (total) shares.push(pos >= 0 ? (p.v[pos] ?? 0) / total : 0);
    }
    return shareBreaks(shares);
  }, [data, view, targetPos]);

  const styleFor = useCallback((p) => {
    if (p.ltc) return { fillColor: NO_RESULT_COLOR, fillOpacity: 0.35 };
    const total = sum(p.v);
    if (!total) return { fillColor: NO_RESULT_COLOR, fillOpacity: 0.1 };
    if (view === 'share') {
      const pos = targetPos(p.w);
      const share = pos >= 0 ? (p.v[pos] ?? 0) / total : 0;
      return { fillColor: shareColor(share, breaks), fillOpacity: 0.85 };
    }
    const lead = pollLeader(p.v);
    if (lead < 0) return { fillColor: OTHER_COLOR, fillOpacity: 0.25 };
    return { fillColor: colorOfSlot(meta.slotOf(p.w, lead)), fillOpacity: marginOpacity(p.v[lead] / total) };
  }, [view, targetPos, breaks, meta]);

  const tooltipFor = useCallback((p) => {
    const ward = data.wards[p.w];
    const head = `<div style="font-weight:700">Poll ${pollLabel(p.w, p.s)}</div>
      <div style="opacity:0.7;margin-bottom:4px">Ward ${p.w} ${escapeHtml(ward.name)}</div>`;
    if (p.ltc) {
      return `<div style="font-size:12px;max-width:240px;white-space:normal">${head}Long-term care or retirement home. Its votes were pooled with the ward's other care homes, so there's no result for this building alone.</div>`;
    }
    const total = sum(p.v);
    const order = p.v.map((v, i) => i).sort((a, b) => p.v[b] - p.v[a]);
    const shown = order.slice(0, 3);
    if (view === 'share') {
      const pos = targetPos(p.w);
      if (pos >= 0 && !shown.includes(pos)) shown.push(pos);
    }
    const rows = shown.map((i) => {
      const highlight = view === 'share' && i === targetPos(p.w) ? 'font-weight:700;' : '';
      return `<tr style="${highlight}">
        <td style="padding-right:6px"><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${colorOfSlot(meta.slotOf(p.w, i))}"></span></td>
        <td style="padding-right:8px">${escapeHtml(data.candidates[ward.cand[i]])}</td>
        <td style="text-align:right;font-variant-numeric:tabular-nums">${fmt(p.v[i] ?? 0)}</td>
        <td style="text-align:right;padding-left:8px;opacity:0.65;font-variant-numeric:tabular-nums">${pct(p.v[i] ?? 0, total)}</td>
      </tr>`;
    }).join('');
    return `<div style="font-size:12px">${head}
      ${total ? `<table style="border-collapse:collapse">${rows}</table>` : ''}
      <div style="margin-top:4px;opacity:0.7">${fmt(total)} election-day votes</div></div>`;
  }, [data, meta, view, targetPos]);

  const handleSelectPoll = useCallback((p) => {
    setSelectedPoll(p);
    setSelectedWard(p.w);
  }, []);

  const pickWard = (ward) => {
    setSelectedWard(ward);
    setSelectedPoll((p) => (p && p.w === ward ? p : null));
    setFocusWard({ ward });
  };

  const switchRace = (id) => {
    if (id === raceId) return;
    setRaceId(id);
    setSelectedPoll(null);
    setFocusWard(selectedWard ? { ward: selectedWard } : null);
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

  const race = RACES.find((r) => r.id === raceId);

  return (
    <div className="min-h-screen pt-4 pb-10" style={{ background: 'var(--paper)' }}>
      <div className="container mx-auto px-4 max-w-7xl">
        <div className="mb-4">
          <h1 className="dd-title text-4xl sm:text-5xl mb-2" style={{ color: 'var(--ink)' }}>
            Toronto Poll-by-Poll Results
          </h1>
        </div>

        <div className="mb-4 dd-panel-ruled p-4 flex flex-wrap items-center gap-x-6 gap-y-3">
          <Segmented
            label="Race"
            value={raceId}
            options={RACES.map((r) => ({ value: r.id, label: r.short }))}
            onChange={switchRace}
          />
          <Segmented
            label="Show"
            value={view}
            options={[{ value: 'leader', label: 'Who led' }, { value: 'share', label: 'Vote share' }]}
            onChange={setView}
          />
          {view === 'share' && meta && (
            <div className="flex items-center gap-2">
              <label htmlFor="shareTarget" className="dd-kicker" style={{ color: 'var(--ink-2)' }}>For</label>
              {isMayor ? (
                <select
                  id="shareTarget"
                  className="dd-select"
                  value={target}
                  onChange={(e) => setShareTarget((t) => ({ ...t, mayor: Number(e.target.value) }))}
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

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
          <div className="dd-panel-ruled p-3 sm:p-4 min-w-0">
            {data ? (
              <ElectionMap
                data={data}
                styleFor={styleFor}
                tooltipFor={tooltipFor}
                selectedPoll={selectedPoll}
                selectedWard={selectedWard}
                focusWard={focusWard}
                onSelectPoll={handleSelectPoll}
              />
            ) : (
              <div className="w-full rounded flex items-center justify-center" style={{ height: 'min(72vh, 640px)', minHeight: 420, background: 'var(--paper)' }}>
                <p className="text-sm" style={{ color: 'var(--ink-3)' }}>Loading {race.label} results…</p>
              </div>
            )}
            {data && (
              <Legend
                view={view}
                isMayor={isMayor}
                data={data}
                breaks={breaks}
                targetLabel={isMayor ? data.candidates[target] : RANK_LABELS[target]?.toLowerCase()}
              />
            )}
          </div>

          <div className="flex flex-col gap-4 min-w-0">
            {data && selectedPoll && (
              <PollCard data={data} poll={selectedPoll} onClose={() => setSelectedPoll(null)} />
            )}
            {data && selectedWard && <WardCard data={data} ward={selectedWard} />}
            {data && !selectedWard && (isMayor ? <CityCard data={data} /> : <WardList data={data} onPick={pickWard} />)}
          </div>
        </div>

        <div className="mt-8 dd-panel p-6 text-sm space-y-2" style={{ color: 'var(--ink-2)' }}>
          <p>
            The map shows election-day votes only. Advance, mail-in and long-term-care votes were
            counted at the ward level and can&rsquo;t be placed on a poll. They&rsquo;re included
            in the ward totals.
            {meta && <> In the {race.label.toLowerCase()} they were {pct(meta.offMap, meta.allVotes)} of all votes.</>}
          </p>
          <p>
            Poll-by-poll results and voting subdivision boundaries from the{' '}
            <a href="https://open.toronto.ca/dataset/elections-voting-subdivisions/" target="_blank" rel="noopener noreferrer" className="dd-link-accent">
              City of Toronto Open Data Portal
            </a>
            .
          </p>
        </div>
      </div>
    </div>
  );
}

function Segmented({ label, value, options, onChange }) {
  return (
    <div className="flex items-center gap-2">
      <span className="dd-kicker" style={{ color: 'var(--ink-2)' }}>{label}</span>
      <div className="inline-flex rounded overflow-hidden" style={{ border: '1px solid var(--line)' }} role="group" aria-label={label}>
        {options.map((o) => {
          const on = o.value === value;
          return (
            <button
              key={o.value}
              type="button"
              aria-pressed={on}
              onClick={() => onChange(o.value)}
              className="px-3 py-1.5 text-sm font-semibold transition-colors"
              style={{ background: on ? 'var(--ink)' : 'var(--panel)', color: on ? '#fff' : 'var(--ink-2)' }}
            >
              {o.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

const Swatch = ({ color, opacity = 1 }) => (
  <span className="inline-block shrink-0 rounded-sm" style={{ width: 12, height: 12, background: color, opacity }} />
);

function Legend({ view, isMayor, data, breaks, targetLabel }) {
  if (view === 'share') {
    return (
      <div className="mt-3">
        <p className="dd-kicker mb-1.5" style={{ color: 'var(--ink-2)' }}>
          {isMayor ? `${targetLabel}'s` : `The ${targetLabel}'s`} share of each poll
        </p>
        <div className="flex flex-wrap items-end gap-0.5">
          {SHARE_RAMP.map((c, i) => (
            <div key={c} className="flex flex-col items-start" style={{ width: 52 }}>
              <span className="block w-full" style={{ height: 12, background: c }} />
              <span className="text-xs mt-0.5" style={{ color: 'var(--ink-3)', fontVariantNumeric: 'tabular-nums' }}>
                {i === SHARE_RAMP.length - 1 ? `${pctRound(breaks[i])}+` : pctRound(breaks[i])}
              </span>
            </div>
          ))}
        </div>
      </div>
    );
  }
  const labels = isMayor
    ? data.meta.cityRanked.slice(0, SLOT_COLORS.length).map(([c]) => data.candidates[c])
    : RANK_LABELS;
  return (
    <div className="mt-3 flex flex-wrap gap-x-8 gap-y-3">
      <div>
        <p className="dd-kicker mb-1.5" style={{ color: 'var(--ink-2)' }}>Poll led by</p>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs" style={{ color: 'var(--ink-2)' }}>
          {labels.map((label, i) => (
            <span key={label} className="flex items-center gap-1.5"><Swatch color={SLOT_COLORS[i]} />{label}</span>
          ))}
          <span className="flex items-center gap-1.5"><Swatch color={OTHER_COLOR} />Anyone else</span>
          <span className="flex items-center gap-1.5"><Swatch color={OTHER_COLOR} opacity={0.25} />Tie</span>
          {isMayor && <span className="flex items-center gap-1.5"><Swatch color={NO_RESULT_COLOR} opacity={0.5} />Care home, no separate result</span>}
        </div>
      </div>
      <div>
        <p className="dd-kicker mb-1.5" style={{ color: 'var(--ink-2)' }}>Leader&rsquo;s share</p>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs" style={{ color: 'var(--ink-2)' }}>
          {MARGIN_BINS.map((b) => (
            <span key={b.label} className="flex items-center gap-1.5"><Swatch color="#16150f" opacity={b.opacity} />{b.label}</span>
          ))}
        </div>
      </div>
    </div>
  );
}

// Candidate rows with a bar each, top `limit` then everyone else summed.
function ResultBars({ names, votes, colors, limit = 6 }) {
  const total = sum(votes);
  const order = votes.map((v, i) => i).sort((a, b) => votes[b] - votes[a]);
  const top = order.slice(0, limit);
  const rest = order.slice(limit);
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
    </ul>
  );
}

function wardColors(data, w) {
  return data.wards[w].cand.map((_, pos) => colorOfSlot(data.meta.slotOf(w, pos)));
}

function PollCard({ data, poll, onClose }) {
  const ward = data.wards[poll.w];
  const names = ward.cand.map((c) => data.candidates[c]);
  const votes = ward.cand.map((_, i) => poll.v?.[i] ?? 0);
  return (
    <div className="dd-panel">
      <div className="p-4 flex items-start justify-between gap-3" style={{ borderBottom: '1px solid var(--line)' }}>
        <div>
          <p className="dd-kicker">Poll {pollLabel(poll.w, poll.s)}</p>
          <h2 className="dd-title text-lg mt-1" style={{ color: 'var(--ink)' }}>
            {poll.ltc ? 'Care home' : `${fmt(sum(votes))} election-day votes`}
          </h2>
        </div>
        <button type="button" onClick={onClose} className="text-sm" style={{ color: 'var(--ink-3)' }} aria-label="Close poll">✕</button>
      </div>
      <div className="p-4">
        {poll.ltc ? (
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

function WardCard({ data, ward: w }) {
  const ward = data.wards[w];
  const names = ward.cand.map((c) => data.candidates[c]);
  const onMap = ward.allVotes - ward.offMap;
  return (
    <div className="dd-panel">
      <div className="p-4" style={{ borderBottom: '1px solid var(--line)' }}>
        <p className="dd-kicker">Ward {w}</p>
        <h2 className="dd-title text-lg mt-1" style={{ color: 'var(--ink)' }}>{ward.name}</h2>
        <p className="text-xs mt-1" style={{ color: 'var(--ink-3)' }}>
          {data.meta.isMayor ? 'Mayoral votes cast in this ward' : 'Council race result'} · {fmt(ward.allVotes)} votes
        </p>
      </div>
      <div className="p-4">
        <ResultBars names={names} votes={ward.totals} colors={wardColors(data, w)} />
        <dl className="mt-4 pt-3 text-xs grid grid-cols-[1fr_auto_auto] gap-x-3 gap-y-1" style={{ borderTop: '1px solid var(--line)', color: 'var(--ink-2)' }}>
          <dt>Election-day polls (on map)</dt>
          <dd style={{ fontVariantNumeric: 'tabular-nums' }}>{fmt(onMap)}</dd>
          <dd className="text-right" style={{ color: 'var(--ink-3)', fontVariantNumeric: 'tabular-nums' }}>{pct(onMap, ward.allVotes)}</dd>
          {Object.entries(ward.special).map(([kind, votes]) => (
            <SpecialRow key={kind} label={SPECIAL_LABELS[kind]} votes={sum(votes)} total={ward.allVotes} />
          ))}
        </dl>
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

function CityCard({ data }) {
  const { cityRanked, allVotes } = data.meta;
  const names = cityRanked.map(([c]) => data.candidates[c]);
  const votes = cityRanked.map(([, v]) => v);
  const colors = cityRanked.map((_, i) => colorOfSlot(i < SLOT_COLORS.length ? i : -1));
  return (
    <div className="dd-panel">
      <div className="p-4" style={{ borderBottom: '1px solid var(--line)' }}>
        <p className="dd-kicker">Citywide</p>
        <h2 className="dd-title text-lg mt-1" style={{ color: 'var(--ink)' }}>{data.title}</h2>
        <p className="text-xs mt-1" style={{ color: 'var(--ink-3)' }}>{fmt(allVotes)} votes, {data.candidates.length} candidates</p>
      </div>
      <div className="p-4">
        <ResultBars names={names} votes={votes} colors={colors} limit={8} />
      </div>
    </div>
  );
}

// Council has no citywide result, so the starting panel is the 25 winners.
function WardList({ data, onPick }) {
  return (
    <div className="dd-panel">
      <div className="p-4" style={{ borderBottom: '1px solid var(--line)' }}>
        <p className="dd-kicker">Ward winners</p>
        <h2 className="dd-title text-lg mt-1" style={{ color: 'var(--ink)' }}>{data.title}</h2>
      </div>
      <ul className="divide-y" style={{ borderColor: 'var(--line)' }}>
        {Object.entries(data.wards).map(([w, ward]) => (
          <li key={w}>
            <button
              type="button"
              onClick={() => onPick(Number(w))}
              className="w-full text-left px-4 py-2 text-sm flex justify-between gap-3 hover:bg-[var(--paper)]"
            >
              <span className="min-w-0">
                <span className="block truncate font-semibold" style={{ color: 'var(--ink)' }}>{data.candidates[ward.cand[0]]}</span>
                <span className="block truncate text-xs" style={{ color: 'var(--ink-3)' }}>{w}. {ward.name}</span>
              </span>
              <span className="shrink-0 self-center" style={{ color: 'var(--ink-2)', fontVariantNumeric: 'tabular-nums' }}>
                {pct(ward.totals[0], ward.allVotes)}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
