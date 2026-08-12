// Estimates directed link-level ridership (riders/weekday crossing each
// segment between adjacent stations) for TTC Lines 1, 2 and 4, from the TTC's
// published station-level "Subway Ridership 2023-2024" table (typical-weekday
// customers to/from each station platform, Sep 2023 - Aug 2024):
// https://cdn.ttc.ca/-/media/Project/TTC/DevProto/Documents/Home/Transparency-and-accountability/Subway-Ridership-20232024.pdf
//
// Model: station usage U_i counts riders both entering and leaving the
// platform, so boardings B_i = alightings A_i = U_i / 2. Trips are assigned
// with a singly-constrained gravity model with no distance decay:
//
//   T_ij = B_i * A_j / (sum_k A_k - A_i)      for j != i
//
// The directed link volume between stations s and s+1 is the sum of all T_ij
// whose trip crosses that link in that direction. Volumes are written to
// app/lib/slow-zones/link-volumes.json.
//
//   node scripts/build-link-volumes.mjs
//
// Sanity anchor: the busiest measured link on the network is southbound
// through Bloor-Yonge (~28,000 riders in the AM peak hour per TTC's Line 1
// Capacity Enhancement program). With peak hour ~10% of daily, the model's
// Bloor-Yonge -> Wellesley southbound daily volume should land within a
// sensible range of ~200-280k; the script prints it for checking.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

// Station usage in the same order as app/lib/slow-zones/stations.js.
// Line 1 runs Vaughan Metropolitan Centre -> Finch; note the TTC table lists
// Cedarvale under its former name "Eglinton West".
const USAGE = {
  1: [
    20394, // Vaughan Metropolitan Centre
    7649, // Highway 407
    16570, // Pioneer Village
    20447, // York University
    18345, // Finch West
    5618, // Downsview Park
    19495, // Sheppard West
    21579, // Wilson
    19725, // Yorkdale
    19742, // Lawrence West
    5878, // Glencairn
    13982, // Cedarvale (Eglinton West)
    21013, // St Clair West
    11084, // Dupont
    11479, // Spadina
    101128, // St George
    9604, // Museum
    34444, // Queen's Park
    23989, // St Patrick
    19323, // Osgoode
    34576, // St Andrew
    136515, // Union
    35107, // King
    36714, // Queen
    72406, // Dundas
    39137, // College
    17705, // Wellesley
    156643, // Bloor-Yonge
    4875, // Rosedale
    5045, // Summerhill
    27336, // St Clair
    15903, // Davisville
    60814, // Eglinton
    21197, // Lawrence
    20498, // York Mills
    57501, // Sheppard-Yonge
    16699, // North York Centre
    70775, // Finch
  ],
  2: [
    49392, // Kipling
    25023, // Islington
    17337, // Royal York
    6109, // Old Mill
    14953, // Jane
    15838, // Runnymede
    9173, // High Park
    16305, // Keele
    23861, // Dundas West
    17406, // Lansdowne
    26800, // Dufferin
    22109, // Ossington
    11407, // Christie
    30598, // Bathurst
    27601, // Spadina
    108866, // St George
    20980, // Bay
    121531, // Bloor-Yonge
    24689, // Sherbourne
    8943, // Castle Frank
    11720, // Broadview
    6197, // Chester
    34506, // Pape
    6317, // Donlands
    9567, // Greenwood
    13450, // Coxwell
    10803, // Woodbine
    18682, // Main Street
    32276, // Victoria Park
    21843, // Warden
    42881, // Kennedy
  ],
  4: [
    35327, // Sheppard-Yonge
    6205, // Bayview
    3180, // Bessarion
    3988, // Leslie
    28709, // Don Mills
  ],
};

function linkVolumes(usage) {
  const n = usage.length;
  const board = usage.map((u) => u / 2);
  const alight = board;
  const totalAlight = alight.reduce((a, b) => a + b, 0);
  // up = travelling in the direction of increasing station index
  const up = new Array(n - 1).fill(0);
  const down = new Array(n - 1).fill(0);
  for (let i = 0; i < n; i++) {
    const denom = totalAlight - alight[i];
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      const trips = (board[i] * alight[j]) / denom;
      const [lo, hi] = i < j ? [i, j] : [j, i];
      for (let s = lo; s < hi; s++) {
        if (i < j) up[s] += trips;
        else down[s] += trips;
      }
    }
  }
  return {
    up: up.map((v) => Math.round(v)),
    down: down.map((v) => Math.round(v)),
  };
}

const out = {
  source:
    'Estimated from TTC Subway Ridership 2023-2024 (typical-weekday station usage) via a gravity trip-assignment model; see scripts/build-link-volumes.mjs',
  volumes: Object.fromEntries(
    Object.entries(USAGE).map(([line, usage]) => [line, linkVolumes(usage)])
  ),
};

fs.writeFileSync(
  path.join(root, 'app', 'lib', 'slow-zones', 'link-volumes.json'),
  JSON.stringify(out, null, 1)
);

// Diagnostics
for (const [line, usage] of Object.entries(USAGE)) {
  const { up, down } = out.volumes[line];
  const trips = usage.reduce((a, b) => a + b, 0) / 2;
  const maxUp = Math.max(...up);
  const maxDown = Math.max(...down);
  console.log(
    `Line ${line}: ${trips.toLocaleString()} trips/day, busiest link up=${maxUp.toLocaleString()} (seg ${up.indexOf(maxUp)}), down=${maxDown.toLocaleString()} (seg ${down.indexOf(maxDown)})`
  );
}
// Anchor check: Bloor-Yonge (27) -> Wellesley (26) southbound = "down" seg 26 on Line 1
console.log(
  `Anchor: L1 Bloor-Yonge->Wellesley southbound daily = ${out.volumes[1].down[26].toLocaleString()} (TTC measured AM peak ~28k/h; peak hour is typically ~10% of daily)`
);
