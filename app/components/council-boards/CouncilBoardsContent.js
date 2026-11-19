'use client';

import { useEffect, useMemo, useState } from 'react';

import data from './data.json';

// data.json is exported from the 2027.ST1.1 appointments adopted on
// November 19, 2026 and the members' preference table (Attachment 1). Survey
// answers come from the TTCriders 2026 survey, the Cycle Toronto 2026
// questionnaire (the five citywide pledges; the ward-only sixth is left out),
// ACORN's 2026 candidate survey and the Toronto Environmental Alliance pledge.

const CATEGORIES = [
  'Executive', 'Standing committees', 'Special committees', 'Corporations', 'City boards',
  'Advisory body',
];

const SURVEYS = {
  ttcriders: {
    short: 'TTCriders',
    label: 'TTCriders 2026 survey',
    url: 'https://www.ttcriders.ca/2026surveyresults',
    questions: [
      'Keep transit decisions local (Bill 98)',
      'Push for provincial and federal operating funding',
      'Push for provincial and federal capital funding',
      'Lower the fare cap to 40 rides a month, or cap weekly',
      'Cheaper transit for post-secondary students',
      'Keep the fare freeze',
      'Plan for phase 3 of the Fair Pass',
      'Complete one RapidTO route in their ward',
      'Vote for RapidTO routes in other wards',
      'Fix subway slow zones faster',
      'Network-wide streetcar reform',
      'Oppose service cuts, add frequency',
      'Fully fund the wayfinding strategy',
      'Protect and expand door-to-door Wheel-Trans',
      'Clear snow at Wheel-Trans, bus and streetcar stops first',
      'Expand the Community Crisis Service on the TTC',
      'Platform edge doors across the subway',
      'More shelters and supportive housing',
    ],
  },
  cycleto: {
    short: 'Cycle TO',
    label: 'Cycle Toronto 2026 questionnaire',
    url: 'https://www.cycleto.ca/2026questionnaire',
    questions: [
      'Preserve the Bloor, Yonge and University bike lanes',
      'Rebuild bike lanes the province removes',
      'Upgrade quick-build lanes to permanent materials',
      'Grow Bike Share and push for One-Fare integration',
      'Keep bike lanes safe and passable year-round',
    ],
  },
  acorn: {
    short: 'ACORN',
    label: 'ACORN 2026 candidate survey',
    url: 'https://acorncanada.org/wp-content/uploads/2026/10/2026-Municipal-Election-Candidate-Survey-Results.pdf',
    questions: [
      'In-unit inspections in RentSafeTO evaluations',
      'A universal work order form landlords must accept',
      'Expand RentSafeTO and raise fees for more inspectors',
      '26\u00b0C maximum indoor temperature bylaw, year-round',
      'Expand the Air Conditioner Assistance Program',
      'Public reporting of heat-related ER visits',
      'Raise the Vacant Homes Tax to 5% and fund MURA',
      'City-run grocery stores',
      'A municipally owned broadband network',
      'Advocate for full rent and vacancy control',
      'Advocate to double OW/ODSP and index to inflation',
      'Advocate for Landlord and Tenant Board reform',
    ],
  },
  tea: {
    short: 'TEA',
    label: 'Toronto Environmental Alliance pledge',
    url: 'https://election.torontoenvironment.org/2026_municipal_candidate_pledge_results',
    questions: [
      '26\u00b0C maximum temperature bylaw for renters',
      'Plant trees in the hottest neighbourhoods',
      'Move the Single-Use Strategy forward',
      'Pause AI data centre approvals pending a framework',
      'New policies to cut building emissions',
    ],
  },
};

// The pledge is all five priorities at once; the mayor answered them in TEA's
// separate mayoral survey. Partially is ACORN's half-commitment.
const ORDER = ['ttcriders', 'cycleto', 'acorn', 'tea'];

// The bodies members ranked, under the names they had when they ranked them.
const PREF_LABELS = {
  Exec: 'Executive Committee (at-large)',
  ECD: 'Economic and Community Development',
  GG: 'General Government',
  IEC: 'Infrastructure and Environment',
  PH: 'Planning and Housing',
};

const MEMBERS = data.members;
const BY_SLUG = Object.fromEntries(Object.entries(MEMBERS).map(([name, m]) => [m.slug, name]));
// Economic and Community Development was split into Economic Development and
// Culture and Community and Social Services, so a seat on either counts.
const PREF_BOARDS = data.boards.filter((b) => b.prefKey).reduce((acc, b) => {
  (acc[b.prefKey] ??= []).push(b);
  return acc;
}, {});

const surname = (name) => {
  const compound = ['Chan McNally', 'Chernos Lin', 'Erskine-Smith'].find((c) => name.endsWith(c));
  return compound ?? name.split(' ').pop();
};
const ROSTER = Object.keys(MEMBERS).sort((a, b) => {
  if (MEMBERS[a].ward === 0) return -1;
  if (MEMBERS[b].ward === 0) return 1;
  return surname(a).localeCompare(surname(b));
});

const seatsOf = (name) => data.boards
  .map((b) => ({ board: b, seat: b.members.find((m) => m.name === name) }))
  .filter((x) => x.seat);

function Photo({ name, size = 64, round = false }) {
  const m = MEMBERS[name];
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`/council-2026/${m.slug}.jpg`}
      alt={name}
      width={size}
      height={round ? size : Math.round(size * 1.25)}
      loading="lazy"
      className={round ? 'block rounded-full object-cover object-top' : 'block object-cover'}
      style={{
        width: size,
        height: round ? size : Math.round(size * 1.25),
        background: 'var(--line)',
        borderRadius: round ? '9999px' : 3,
      }}
    />
  );
}

function RoleTag({ role }) {
  if (!role) return null;
  const isChair = role === 'Chair';
  return (
    <span
      className="inline-block text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-sm"
      style={isChair
        ? { background: 'var(--accent)', color: 'var(--accent-ink)' }
        : { border: '1px solid var(--line)', color: 'var(--ink-2)' }}
    >
      {role}
    </span>
  );
}

function Squares({ answers, survey, size = 10 }) {
  const qs = SURVEYS[survey].questions;
  const list = answers ?? qs.map(() => null);
  const asked = list.filter((a) => a !== 'N/A');
  const yes = asked.filter((a) => a === 'Yes').length;
  const responded = asked.some((a) => a === 'Yes' || a === 'No' || a === 'Abstain' || a === 'Partially');
  const perRow = qs.length > 12 ? 9 : qs.length;
  return (
    <div className="flex items-center gap-2">
      <div className="flex flex-wrap gap-[3px]" style={{ maxWidth: perRow * (size + 3) }}>
        {list.map((a, i) => (
          <span
            key={i}
            title={`${qs[i]}: ${a === 'N/A' ? 'not asked' : a ?? 'No response'}`}
            style={{
              width: size,
              height: size,
              background: a === 'Yes' ? 'var(--accent)' : a === 'No' ? 'var(--ink)'
                : a === 'Partially' ? 'rgba(232,89,12,0.35)' : 'transparent',
              border: ['Yes', 'No', 'Partially'].includes(a) ? 'none' : `1.5px ${a === 'N/A' ? 'dotted' : 'solid'} #cfcdc2`,
            }}
          />
        ))}
      </div>
      <span
        className="text-xs font-bold tabular-nums whitespace-nowrap"
        style={{ color: !responded ? 'var(--ink-3)' : yes === asked.length ? 'var(--accent)' : 'var(--ink)' }}
      >
        {responded ? `${yes}/${asked.length}` : 'No reply'}
      </span>
    </div>
  );
}

function SurveyKey({ survey }) {
  const s = SURVEYS[survey];
  const box = (style) => <span className="inline-block w-2.5 h-2.5 align-middle mr-1" style={style} />;
  return (
    <div className="text-xs flex flex-wrap gap-x-4 gap-y-1 items-center" style={{ color: 'var(--ink-2)' }}>
      <a href={s.url} className="dd-link-accent font-semibold" target="_blank" rel="noreferrer">{s.label}</a>
      <span>{box({ background: 'var(--accent)' })}Yes</span>
      {survey === 'acorn' && <span>{box({ background: 'rgba(232,89,12,0.35)' })}Partially</span>}
      <span>{box({ background: 'var(--ink)' })}No</span>
      <span>{box({ border: '1.5px solid #cfcdc2' })}No response</span>
    </div>
  );
}

function BoardCard({ board, onPick, highlight }) {
  return (
    <section id={board.slug} className="dd-panel-ruled p-4 scroll-mt-20">
      <h3 className="font-extrabold text-lg leading-tight mb-3">{board.name}</h3>
      <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3">
        {board.members.map(({ name, role }) => (
          <li key={name}>
            <button
              type="button"
              onClick={() => onPick(name)}
              className="flex items-center gap-3 text-left w-full rounded p-1 -m-1 cursor-pointer"
              style={{ background: highlight === name ? 'rgba(232,89,12,0.10)' : 'transparent' }}
            >
              <Photo name={name} size={44} round />
              <span className="min-w-0">
                <span className="block font-semibold leading-tight">{name}</span>
                <span className="flex items-center gap-2 mt-0.5 flex-wrap">
                  <RoleTag role={role} />
                </span>
                {board.surveys.map((sv) => (
                  <span key={sv} className="flex items-center gap-1.5 mt-1">
                    {board.surveys.length > 1 && (
                      <span className="text-[10px] font-bold uppercase w-14 shrink-0" style={{ color: 'var(--ink-3)' }}>
                        {SURVEYS[sv].short}
                      </span>
                    )}
                    <Squares answers={MEMBERS[name][sv]} survey={sv} size={8} />
                  </span>
                ))}
              </span>
            </button>
          </li>
        ))}
      </ul>
      {board.surveys.length > 0 && (
        <div className="mt-4 pt-3 space-y-1" style={{ borderTop: '1px solid var(--line)' }}>
          {board.surveys.map((sv) => <SurveyKey key={sv} survey={sv} />)}
        </div>
      )}
    </section>
  );
}

function MemberDetail({ name, onBoard }) {
  const m = MEMBERS[name];
  const seats = seatsOf(name);
  return (
    <div className="dd-panel-ruled p-5">
      <div className="flex gap-5 items-start">
        <Photo name={name} size={120} />
        <div className="min-w-0">
          <div className="dd-kicker">{m.ward ? `Ward ${m.ward} · ${m.wardName}` : 'Mayor'}</div>
          <h2 className="dd-title text-3xl mt-1">{name}</h2>
        </div>
      </div>

      <h3 className="dd-kicker mt-6 mb-2" style={{ color: 'var(--ink-3)' }}>Seats</h3>
      <ul className="divide-y" style={{ borderColor: 'var(--line)' }}>
        {seats.map(({ board, seat }) => (
          <li key={board.slug} className="py-2 flex items-center justify-between gap-3" style={{ borderColor: 'var(--line)' }}>
            <button type="button" onClick={() => onBoard(board.slug)} className="text-left font-semibold hover:underline cursor-pointer">
              {board.name}
            </button>
            <RoleTag role={seat.role} />
          </li>
        ))}
      </ul>

      {m.choices && (
        <>
          <h3 className="dd-kicker mt-6 mb-2" style={{ color: 'var(--ink-3)' }}>Committees they asked for</h3>
          <ol className="space-y-1.5">
            {m.choices.map((key, i) => {
              const got = (PREF_BOARDS[key] ?? []).some((b) => b.members.some((s) => s.name === name));
              return (
                <li key={key} className="flex items-center gap-3 text-sm">
                  <span className="w-16 font-bold tabular-nums" style={{ color: 'var(--ink-3)' }}>
                    {['1st', '2nd', '3rd'][i]} choice
                  </span>
                  <span
                    className="px-2 py-1 rounded-sm font-semibold"
                    style={got
                      ? { background: 'var(--accent)', color: 'var(--accent-ink)' }
                      : { border: '1.5px solid #cfcdc2', color: 'var(--ink-3)' }}
                  >
                    {PREF_LABELS[key]}
                  </span>
                  <span style={{ color: got ? 'var(--ink-2)' : 'var(--ink-3)' }}>{got ? 'Appointed' : 'Not appointed'}</span>
                </li>
              );
            })}
          </ol>
        </>
      )}

      {ORDER.map((survey) => (
        <div key={survey}>
          <h3 className="dd-kicker mt-6 mb-2" style={{ color: 'var(--ink-3)' }}>{SURVEYS[survey].label}</h3>
          <Squares answers={m[survey]} survey={survey} size={14} />
          {m[survey]?.some((a) => a === 'No') && (
            <ul className="mt-2 text-sm space-y-0.5" style={{ color: 'var(--ink-2)' }}>
              {m[survey].map((a, i) => a === 'No' && (
                <li key={i}><span className="font-bold" style={{ color: 'var(--ink)' }}>No:</span> {SURVEYS[survey].questions[i]}</li>
              ))}
            </ul>
          )}
        </div>
      ))}
    </div>
  );
}

export default function CouncilBoardsContent() {
  const [view, setView] = useState('boards');
  const [member, setMember] = useState(null);
  const [board, setBoard] = useState(null);

  // ?member=<slug> opens a councillor; ?board=<slug> filters to one board.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const m = params.get('member');
    const b = params.get('board');
    if (m && BY_SLUG[m]) {
      setMember(BY_SLUG[m]);
      setView('members');
    } else if (b && data.boards.some((x) => x.slug === b)) {
      setBoard(b);
    }
  }, []);

  const syncUrl = (key, value) => {
    const url = new URL(window.location.href);
    url.searchParams.delete('member');
    url.searchParams.delete('board');
    if (value) url.searchParams.set(key, value);
    url.hash = '';
    window.history.replaceState(null, '', url);
  };

  const pick = (name) => {
    setMember(name);
    setView('members');
    syncUrl('member', name ? MEMBERS[name].slug : null);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const pickBoard = (slug) => {
    setBoard(slug);
    setView('boards');
    syncUrl('board', slug);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const switchView = (id) => {
    setView(id);
    if (id === 'boards') syncUrl('board', board);
    else syncUrl('member', member ? MEMBERS[member].slug : null);
  };

  const grouped = useMemo(
    () => CATEGORIES.map((c) => [c, data.boards.filter((b) => b.category === c)]).filter(([, b]) => b.length),
    [],
  );
  const chosenBoard = board ? data.boards.find((b) => b.slug === board) : null;

  const tab = (id, label) => (
    <button
      type="button"
      onClick={() => switchView(id)}
      className={`dd-btn ${view === id ? 'dd-btn-primary' : 'dd-btn-ghost'}`}
      aria-pressed={view === id}
    >
      {label}
    </button>
  );

  return (
    <main className="min-h-screen" style={{ background: 'var(--paper)', color: 'var(--ink)' }}>
      <div className="container mx-auto px-4 max-w-5xl py-8">
        <h1 className="dd-title text-3xl sm:text-4xl">Toronto City Council appointments</h1>

        <div className="flex flex-wrap items-center gap-2 mt-6 mb-6">
          {tab('boards', 'By board')}
          {tab('members', 'By councillor')}
          <div className="w-full sm:w-auto sm:ml-auto">
            {view === 'boards' ? (
              <select
                className="dd-select dd-select-chevron w-full sm:w-80"
                value={board ?? ''}
                onChange={(e) => pickBoard(e.target.value || null)}
                aria-label="Choose a board"
              >
                <option value="">All boards and committees</option>
                {grouped.map(([category, boards]) => (
                  <optgroup key={category} label={category}>
                    {boards.map((b) => <option key={b.slug} value={b.slug}>{b.name}</option>)}
                  </optgroup>
                ))}
              </select>
            ) : (
              <select
                className="dd-select dd-select-chevron w-full sm:w-80"
                value={member ? MEMBERS[member].slug : ''}
                onChange={(e) => pick(e.target.value ? BY_SLUG[e.target.value] : null)}
                aria-label="Choose a councillor"
              >
                <option value="">Choose a member of council</option>
                {ROSTER.map((name) => (
                  <option key={name} value={MEMBERS[name].slug}>
                    {name}{MEMBERS[name].ward ? ` (Ward ${MEMBERS[name].ward})` : ' (Mayor)'}
                  </option>
                ))}
              </select>
            )}
          </div>
        </div>

        {view === 'boards' && chosenBoard && (
          <div className="mb-10">
            <BoardCard board={chosenBoard} onPick={pick} highlight={member} />
            <button type="button" className="dd-btn dd-btn-ghost mt-4" onClick={() => pickBoard(null)}>
              Show all boards
            </button>
          </div>
        )}

        {view === 'boards' && !chosenBoard && grouped.map(([category, boards]) => (
          <div key={category} className="mb-10">
            <h2 className="dd-kicker mb-3" style={{ color: 'var(--ink-3)' }}>{category}</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {boards.map((b) => <BoardCard key={b.slug} board={b} onPick={pick} highlight={member} />)}
            </div>
          </div>
        ))}

        {view === 'members' && (
          <>
            <div className="grid grid-cols-6 sm:grid-cols-9 md:grid-cols-13 gap-2 mb-6">
              {ROSTER.map((name) => (
                <button
                  key={name}
                  type="button"
                  onClick={() => pick(name)}
                  title={name}
                  aria-label={name}
                  className="block rounded-full cursor-pointer justify-self-center p-0 overflow-hidden"
                  style={{
                    width: 52,
                    height: 52,
                    outline: member === name ? '3px solid var(--accent)' : 'none',
                    outlineOffset: 2,
                    opacity: member && member !== name ? 0.55 : 1,
                  }}
                >
                  <Photo name={name} size={52} round />
                </button>
              ))}
            </div>
            {member
              ? <MemberDetail name={member} onBoard={pickBoard} />
              : <p style={{ color: 'var(--ink-2)' }}>Pick a member of council to see their seats.</p>}
          </>
        )}

        <p className="text-xs mt-10" style={{ color: 'var(--ink-3)' }}>
          Sources: <a className="dd-link-accent" href={data.source} target="_blank" rel="noreferrer">2027.ST1.1</a>,
          {' '}<a className="dd-link-accent" href={data.prefsSource} target="_blank" rel="noreferrer">members&rsquo; preferences</a>,
          {' '}<a className="dd-link-accent" href={SURVEYS.ttcriders.url} target="_blank" rel="noreferrer">TTCriders</a>,
          {' '}<a className="dd-link-accent" href={SURVEYS.cycleto.url} target="_blank" rel="noreferrer">Cycle Toronto</a>,
          {' '}<a className="dd-link-accent" href={SURVEYS.acorn.url} target="_blank" rel="noreferrer">ACORN</a>,
          {' '}<a className="dd-link-accent" href={SURVEYS.tea.url} target="_blank" rel="noreferrer">Toronto Environmental Alliance</a>.
        </p>
      </div>
    </main>
  );
}
