// Turns the City's live feed (as /api/election-results shapes it) into the
// same structure as the past races' files. Plain JS so the API route can use
// it too.
import { sum, CANDIDATE_COLORS_2026 } from './results';

// Councillors seeking re-election in 2026, by ward: the 2022 winners, plus
// three who won their seats at by-elections since: Parthi Kandavel (Ward 20),
// Rachel Chernos Lin (Ward 15) and Neethan Shan (Ward 25). Wards 4, 11, 14
// and 19 are open seats. The live council map keeps each incumbent in one colour all
// night rather than colouring by whoever is ahead.
const INCUMBENTS_2026 = {
  1: 'Vincent Crisanti',
  2: 'Stephen Holyday',
  3: 'Amber Morley',
  5: 'Frances Nunziata',
  6: 'James Pasternak',
  7: 'Anthony Perruzza',
  8: 'Mike Colle',
  9: 'Alejandra Bravo',
  10: 'Ausma Malik',
  12: 'Josh Matlow',
  13: 'Chris Moise',
  15: 'Rachel Chernos Lin',
  16: 'Jon Burnside',
  17: 'Shelley Carroll',
  18: 'Lily Cheng',
  20: 'Parthi Kandavel',
  21: 'Michael Thompson',
  22: 'Nick Mantas',
  23: 'Jamaal Myers',
  24: 'Paul Ainslie',
  25: 'Neethan Shan',
};

// Ranks candidates by votes, ties alphabetically, as the City's feed does —
// except that an incumbent wins ties, so before any votes are in they're
// listed first.
function rank(list, incumbent) {
  return list
    .map((c, i) => ({ ...c, i }))
    .sort((a, b) => b.votes - a.votes || (b.name === incumbent) - (a.name === incumbent) || a.name.localeCompare(b.name));
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
    const ranked = rank(w.candidates, INCUMBENTS_2026[w.num]);
    const base = councilNames.length;
    councilNames.push(...w.candidates.map((c) => c.name));
    const incumbent = w.candidates.findIndex((c) => c.name === INCUMBENTS_2026[w.num]);
    councilWards[w.num] = {
      incumbent: incumbent >= 0 ? base + incumbent : null,
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
      colorRule: 'incumbent',
      reporting: {
        polls: sum(feed.council.map((w) => w.polls)),
        pollsReceived: sum(feed.council.map((w) => w.pollsReceived)),
      },
    },
  };
}
