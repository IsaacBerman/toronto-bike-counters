// Sitting councillors on past council ballots, by ward, so those maps can be
// coloured like 2026's: incumbent, closest and second challengers, or an open
// seat's leader. 2018 merged 44 wards into 25, so ten wards pitted two
// incumbents against each other; the one with more votes is the incumbent's
// blue, the other a second blue. 2022's Ward 20 is the 2023 by-election (an
// open seat), and in Ward 23 Cynthia Lai died before the vote and her votes
// weren't counted, so it is open too.
// Source: Wikipedia's 2018 and 2022 Toronto municipal election results.
export const PAST_INCUMBENTS = {
  'council-2018': {
    1: ['Michael Ford', 'Vincent Crisanti'],
    2: ['Stephen Holyday', 'John Campbell'],
    3: ['Mark Grimes'],
    4: ['Gord Perks'],
    5: ['Frances Nunziata', 'Frank Di Giorgio'],
    6: ['James Pasternak', 'Maria Augimeri'],
    7: ['Anthony Perruzza', 'Giorgio Mammoliti'],
    8: ['Christin Carmichael Greb'],
    9: ['Ana Bailão'],
    10: ['Joe Cressy'],
    11: ['Mike Layton'],
    12: ['Josh Matlow', 'Joe Mihevc'],
    13: ['Kristyn Wong-Tam', 'Lucy Troisi'],
    14: ['Paula Fletcher', 'Mary Fragedakis'],
    15: ['Jaye Robinson', 'Jon Burnside'],
    16: ['Denzil Minnan-Wong'],
    17: ['Shelley Carroll'],
    18: ['John Filion'],
    20: ['Gary Crawford', 'Michelle Holland-Berardinetti'],
    21: ['Michael Thompson'],
    22: ['Jim Karygiannis', 'Norm Kelly'],
    24: ['Paul Ainslie'],
    25: ['Neethan Shan'],
  },
  'council-2022': {
    2: ['Stephen Holyday'],
    3: ['Mark Grimes'],
    4: ['Gord Perks'],
    5: ['Frances Nunziata'],
    6: ['James Pasternak'],
    7: ['Anthony Perruzza'],
    8: ['Mike Colle'],
    12: ['Josh Matlow'],
    14: ['Paula Fletcher'],
    15: ['Jaye Robinson'],
    17: ['Shelley Carroll'],
    19: ['Brad Bradford'],
    21: ['Michael Thompson'],
    22: ['Nick Mantas'],
    24: ['Paul Ainslie'],
    25: ['Jennifer McKelvie'],
  },
};

// Marks a past race's incumbents in place: `incumbents` lists every sitting
// councillor on the ward's ballot, most votes first (candidates are already
// ranked by votes); `incumbent` is the first.
export function applyIncumbents(data, palette) {
  const byWard = PAST_INCUMBENTS[data.id];
  if (!byWard) return;
  data.colorRule = 'incumbent';
  data.palette = palette;
  for (const [w, ward] of Object.entries(data.wards)) {
    const names = byWard[w] ?? [];
    ward.incumbents = ward.cand.filter((c) => names.includes(data.candidates[c]));
    ward.incumbent = ward.incumbents[0] ?? null;
  }
}
