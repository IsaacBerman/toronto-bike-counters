// Turns the City's live feed (as /api/election-results shapes it) into the
// same structure as the past races' files. Plain JS so the API route can use
// it too.
import { sum, CANDIDATE_COLORS_2026 } from './results';

// Ranks candidates by votes, ties alphabetically, as the City's feed does.
function rank(list) {
  return list.map((c, i) => ({ ...c, i })).sort((a, b) => b.votes - a.votes || a.name.localeCompare(b.name));
}

// Turns the live feed into the same shape as the past races' files, so the map
// and panels work unchanged. Every ward is ward-level only: there are no
// poll-by-poll results until the City certifies the election.
export function liveDatasets(feed, outlines) {
  const empty = { type: 'FeatureCollection', features: [] };

  const mayorNames = feed.mayor.candidates.map((c) => c.name);
  const mayorWards = {};
  for (const w of feed.mayor.wards) {
    const ranked = rank(feed.mayor.candidates.map((c) => ({ name: c.name, votes: c.wards[w.num] ?? 0 })));
    mayorWards[w.num] = {
      name: w.name || outlines.wards[w.num],
      cand: ranked.map((c) => c.i),
      totals: ranked.map((c) => c.votes),
      special: {},
      polls: w.polls,
      pollsReceived: w.pollsReceived,
    };
  }

  const councilNames = [];
  const councilWards = {};
  for (const w of feed.council) {
    const ranked = rank(w.candidates);
    const base = councilNames.length;
    councilNames.push(...w.candidates.map((c) => c.name));
    councilWards[w.num] = {
      name: w.name || outlines.wards[w.num],
      cand: ranked.map((c) => base + c.i),
      totals: ranked.map((c) => c.votes),
      special: {},
      polls: w.polls,
      pollsReceived: w.pollsReceived,
    };
  }

  return {
    'mayor-2026': {
      id: 'mayor-2026',
      title: '2026 Mayoral Election',
      live: true,
      // Campaign colours for the leading candidates, whoever is ahead.
      pinned: Object.keys(CANDIDATE_COLORS_2026),
      palette: Object.values(CANDIDATE_COLORS_2026),
      polls: empty,
      wardOutlines: outlines.wardOutlines,
      candidates: mayorNames,
      wards: mayorWards,
      reporting: { polls: feed.mayor.polls, pollsReceived: feed.mayor.pollsReceived },
    },
    'council-2026': {
      id: 'council-2026',
      title: '2026 City Council',
      live: true,
      polls: empty,
      wardOutlines: outlines.wardOutlines,
      candidates: councilNames,
      wards: councilWards,
      reporting: {
        polls: sum(feed.council.map((w) => w.polls)),
        pollsReceived: sum(feed.council.map((w) => w.pollsReceived)),
      },
    },
  };
}
