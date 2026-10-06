import { NextResponse } from 'next/server';
import { nextCheckDelay } from '../../lib/elections-live';

// The City's unofficial election-night results. Its feed refuses cross-origin
// requests, so the page can't read it directly; this route fetches it, keeps
// only the mayor and council races, and hands the result to Vercel's edge
// cache. However many people are watching, each edge region asks the City at
// most once per cache period: a minute from poll close on, a day before that
// (cut short so the zeroed pre-election file never outlives poll close).
//
// Feed format: the City's "Live Results Information for Media" page and its
// technical specification PDF.
const FEED = 'https://mediaresults.toronto.ca/results/unofficialresult.json';
const WARD_FEED = 'https://mediaresults.toronto.ca/results/unofficialresult-wardbyward.json';

export const dynamic = 'force-dynamic';

const num = (v) => Number(v) || 0;

async function getJson(url) {
  const res = await fetch(url, { cache: 'no-store', headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`${url} answered ${res.status}`);
  return res.json();
}

function shape(main, byWard) {
  const offices = main.office ?? [];
  const mayorOffice = offices.find((o) => o.name === 'Mayor');
  const councilOffice = offices.find((o) => o.name === 'Councillor');
  const mayorTotal = mayorOffice?.ward?.[0];
  const wardInfo = new Map();

  const council = (councilOffice?.ward ?? []).map((w) => {
    const ward = {
      num: num(w.num),
      name: w.name,
      polls: num(w.polls),
      pollsReceived: num(w.pollsReceived),
      totalVoters: num(w.totalVoters),
      votes: num(w.votesReceived),
      candidates: (w.candidate ?? []).map((c) => ({ name: c.name, votes: num(c.votesReceived) })),
    };
    wardInfo.set(ward.num, ward);
    return ward;
  });

  // Mayoral votes by ward come from the second file, one entry per candidate
  // with that candidate's count in each ward.
  const mayorWards = new Map();
  const mayorCandidates = (byWard?.office?.candidate ?? []).map((c) => {
    const wards = {};
    for (const w of c.ward ?? []) {
      wards[num(w.num)] = num(w.votesReceived);
      if (!mayorWards.has(num(w.num))) {
        mayorWards.set(num(w.num), {
          num: num(w.num),
          name: w.name,
          polls: num(w.polls),
          pollsReceived: num(w.pollsReceived),
          totalVoters: num(w.totalVoters),
        });
      }
    }
    return { name: c.name, votes: num(c.votesReceived), wards };
  });

  return {
    seq: num(main.seq),
    mayor: {
      polls: num(mayorTotal?.polls),
      pollsReceived: num(mayorTotal?.pollsReceived),
      totalVoters: num(mayorTotal?.totalVoters),
      votes: num(mayorTotal?.votesReceived),
      candidates: mayorCandidates,
      wards: [...mayorWards.values()].sort((a, b) => a.num - b.num),
    },
    council: council.sort((a, b) => a.num - b.num),
  };
}

export async function GET() {
  try {
    const [main, byWard] = await Promise.all([getJson(FEED), getJson(WARD_FEED)]);
    const body = { fetchedAt: new Date().toISOString(), ...shape(main, byWard) };
    const ttl = Math.max(1, Math.floor(nextCheckDelay() / 1000));
    return NextResponse.json(body, {
      headers: { 'Cache-Control': `public, max-age=0, s-maxage=${ttl}, stale-while-revalidate=30` },
    });
  } catch (e) {
    // Not cached, so the next poll tries the City again.
    return NextResponse.json({ error: `Couldn't reach the City's results feed (${e.message}).` }, {
      status: 502,
      headers: { 'Cache-Control': 'no-store' },
    });
  }
}
