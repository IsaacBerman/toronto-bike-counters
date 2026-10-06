// Join the City's poll-by-poll election results to its voting subdivision
// boundaries, for the elections page.
//
// Input:  data/2022-results/2022_Toronto_Poll_By_Poll_Councillor.xlsx
//         data/2023 Councillor Ward 20 Poll by Poll.xlsx (replaces Ward 20)
//         data/voting-subdivisions-2022 - 4326.geojson
//         data/2023 Office of the Mayor (1).xlsx
//         data/voting-subdivisions-2023 - 4326 (1).geojson
//         One sheet per ward: a row of subdivision numbers, then a row per
//         candidate with their votes in each subdivision, then a totals row.
// Output: public/elections/<id>.json for each entry in ELECTIONS, plus
//         public/elections/wards.json (outlines only, for the live results)
//         public/elections/needle-baseline.json (2023 Chow vs closest challenger by ward)
//
// Subdivisions 96-99 have no polygon: 96 is every long-term care and retirement
// home in the ward pooled together (2023 only), 97 is mail-in, 98 and 99 are
// advance polls. They are kept per ward so the ward totals still add up, but
// can't go on the map. In 2023 the 94 polygons for the care homes themselves
// have no results of their own, since their votes went into 96.
//
// Regenerate with `npm run build:elections`.
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { fileURLToPath } from 'url';
import { simplify, union, featureCollection } from '@turf/turf';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const DATA_DIR = path.join(root, 'data');
const OUT_DIR = path.join(root, 'public', 'elections');

const ELECTIONS = [
  {
    id: 'council-2022',
    title: '2022 City Council',
    date: '2022-10-24',
    results: '2022-results/2022_Toronto_Poll_By_Poll_Councillor.xlsx',
    boundaries: 'voting-subdivisions-2022 - 4326.geojson',
    // Ward 20's seat was refilled in a by-election after Gary Crawford left
    // for Queen's Park, so the map shows the race that decided its current
    // councillor. It ran on the 2023 poll boundaries.
    // Source of public/elections/wards.json; 2026 uses the same 25 wards.
    wardsFile: true,
    replaceWards: [
      {
        ward: 20,
        note: 'November 2023 by-election',
        results: '2023 Councillor Ward 20 Poll by Poll.xlsx',
        boundaries: 'voting-subdivisions-2023 - 4326 (1).geojson',
      },
    ],
  },
  {
    id: 'council-2018',
    title: '2018 City Council',
    date: '2018-10-22',
    results: '2018_Toronto_Poll_By_Poll_Councillor.xlsx',
    boundaries: 'voting-subdivisions-2018 - 4326.geojson',
    // The 2018 boundaries tile the city but omit ~500 small polls (median
    // ~100 votes; most likely single apartment buildings), so their location
    // is unknown. They're pooled per ward rather than guessed at.
    allowUnmapped: true,
  },
  {
    id: 'mayor-2023',
    title: '2023 Mayoral By-election',
    date: '2023-06-26',
    results: '2023 Office of the Mayor (1).xlsx',
    // Writes public/elections/needle-baseline.json for the 2026 needle.
    needleBaseline: { candidate: 'Olivia Chow' },
    boundaries: 'voting-subdivisions-2023 - 4326 (1).geojson',
  },
];

const SPECIAL = { 96: 'ltc', 97: 'mail', 98: 'advance', 99: 'advance' };

// The sheets list candidates surname first ("Chow Olivia"). Two-word names
// just swap; past two words the split between surname and given name isn't
// recoverable from the text, so those are spelled out here. A new three-word
// name with no entry falls back to treating the first word as the surname.
const NAME_OVERRIDES = {
  'Di Pasquale Norm': 'Norm Di Pasquale',
  'De Marco John': 'John De Marco',
  'Buxton Potts Robin': 'Robin Buxton Potts',
  "O'Brien Fehr Markus": "Markus O'Brien Fehr",
  'Manalo Dan Cortez': 'Dan Cortez Manalo',
  'Gong Xiao Hua': 'Xiao Hua Gong',
  'Chevalier Romero Danny': 'Danny Chevalier Romero',
  'Singh Partap Dua': 'Partap Dua Singh',
  'Allan Gru Jesse': 'Jesse Allan Gru',
  'Yan Nathalie Xian Yi': 'Nathalie Xian Yi Yan',
  'Di Giorgio Frank': 'Frank Di Giorgio',
  'La Rose Winston': 'Winston La Rose',
  'Carmichael Greb Christin': 'Christin Carmichael Greb',
  'De Santis Danny': 'Danny De Santis',
  'Del Grande David': 'David Del Grande',
  'Tabasi Nejad Saman': 'Saman Tabasi Nejad',
  'Khogali Ali Walied': 'Walied Khogali Ali',
  'Park Chung Jin': 'Chung Jin Park',
  'Nadeem Zamir ul hassan': 'Zamir ul hassan Nadeem',
  'Mamun MD Abdullah Al': 'MD Abdullah Al Mamun',
};

function givenNameFirst(listed) {
  const name = listed.replace(/\s+/g, ' ').trim();
  if (NAME_OVERRIDES[name]) return NAME_OVERRIDES[name];
  const words = name.split(' ');
  if (words.length > 2) console.warn(`  no override for "${name}", guessing the surname is "${words[0]}"`);
  return words.length < 2 ? name : `${words.slice(1).join(' ')} ${words[0]}`;
}

// ~3 m. Poll boundaries follow streets, so this drops the surveyed-in vertices
// along curves without moving any edge visibly at street zoom.
const SIMPLIFY_TOLERANCE = 0.00003;

// --- Minimal xlsx reader ----------------------------------------------------
// An xlsx is a zip of XML files. Only stored and deflated entries occur in
// practice, which zlib covers; the central directory gives each entry's size
// and offset so nothing has to be streamed.
function readZip(file) {
  const buf = fs.readFileSync(file);
  let eocd = buf.length - 22;
  while (eocd >= 0 && buf.readUInt32LE(eocd) !== 0x06054b50) eocd--;
  if (eocd < 0) throw new Error(`${file}: not a zip`);
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const entries = new Map();
  for (let i = 0; i < count; i++) {
    const method = buf.readUInt16LE(p + 10);
    const size = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    entries.set(name, { method, size, local });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return (name) => {
    const e = entries.get(name);
    if (!e) return null;
    const start = e.local + 30 + buf.readUInt16LE(e.local + 26) + buf.readUInt16LE(e.local + 28);
    const raw = buf.subarray(start, start + e.size);
    return (e.method === 0 ? raw : zlib.inflateRawSync(raw)).toString('utf8');
  };
}

const unescapeXml = (s) =>
  s.replace(/&(lt|gt|amp|quot|apos|#\d+|#x[0-9a-f]+);/gi, (_, e) => {
    if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' ? parseInt(e.slice(2), 16) : Number(e.slice(1)));
    return { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" }[e];
  });

// Concatenates every <t> inside a string item, so rich-text runs come out whole.
const textOf = (xml) => unescapeXml([...xml.matchAll(/<t(?:\s[^>]*)?>([^<]*)<\/t>/g)].map((m) => m[1]).join(''));

function colIndex(ref) {
  let n = 0;
  for (const ch of ref.match(/^[A-Z]+/)[0]) n = n * 26 + ch.charCodeAt(0) - 64;
  return n - 1;
}

// Returns { sheetName: rows[][] } with cells as numbers or strings.
function readWorkbook(file) {
  const get = readZip(file);
  const shared = [...(get('xl/sharedStrings.xml') ?? '').matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => textOf(m[1]));
  const rels = new Map(
    [...get('xl/_rels/workbook.xml.rels').matchAll(/<Relationship\b[^>]*>/g)].map((m) => [
      m[0].match(/Id="([^"]+)"/)[1],
      m[0].match(/Target="([^"]+)"/)[1].replace(/^\/?(xl\/)?/, 'xl/'),
    ])
  );
  const sheets = {};
  for (const m of get('xl/workbook.xml').matchAll(/<sheet\b[^>]*>/g)) {
    const name = unescapeXml(m[0].match(/name="([^"]+)"/)[1]);
    const target = rels.get(m[0].match(/r:id="([^"]+)"/)[1]);
    const rows = [];
    for (const row of get(target).matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
      const cells = [];
      for (const c of row[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const attrs = c[1];
        const body = c[2] ?? '';
        const ref = attrs.match(/r="([A-Z]+)\d+"/)[1];
        const type = attrs.match(/t="([^"]+)"/)?.[1];
        const v = body.match(/<v>([^<]*)<\/v>/)?.[1];
        let value = null;
        if (type === 's') value = shared[Number(v)];
        else if (type === 'inlineStr') value = textOf(body);
        else if (type === 'str') value = v == null ? null : unescapeXml(v);
        else if (v != null) value = Number(v);
        cells[colIndex(ref)] = value;
      }
      rows.push(cells);
    }
    sheets[name] = rows;
  }
  return sheets;
}

// --- Build ------------------------------------------------------------------
const round5 = (coords) =>
  typeof coords[0] === 'number'
    ? [Math.round(coords[0] * 1e5) / 1e5, Math.round(coords[1] * 1e5) / 1e5]
    : coords.map(round5);

function build(election) {
  const candidates = []; // every name in the race(s), indexed
  const candidateIndex = new Map();
  const wards = {};
  const pollVotes = new Map(); // "ward-sub" -> votes aligned to that ward's cand order
  const hasLtcPoll = new Set(); // wards whose care homes report as subdivision 96

  // Reads every ward sheet in a workbook (or just `onlyWard`'s) into the
  // tables above, replacing anything already there for that ward.
  const readResults = (file, onlyWard) => {
    const sheets = readWorkbook(path.join(DATA_DIR, file));
    for (const [sheetName, rows] of Object.entries(sheets)) {
      const wardMatch = sheetName.match(/^Ward (\d+)$/);
      if (!wardMatch) continue;
      const ward = Number(wardMatch[1]);
      if (onlyWard && ward !== onlyWard) continue;
      for (const key of [...pollVotes.keys()]) if (key.startsWith(`${ward}-`)) pollVotes.delete(key);
      hasLtcPoll.delete(ward);
      const title = String(rows[0][0]).trim();
      const name = title.replace(/^City Ward \d+\s*/, '');
      const header = rows.find((r) => r[0] === 'Subdivision');
      const totalsAt = rows.findIndex((r) => typeof r[0] === 'string' && /Totals$/.test(r[0]));
      // Candidate rows sit between the office label row (just under the header)
      // and the totals row.
      const candRows = rows.slice(rows.indexOf(header) + 2, totalsAt).filter((r) => r[0]);
      const cols = [];
      let totalCol = -1;
      header.forEach((h, j) => {
        if (j === 0 || h == null) return;
        if (h === 'Total') totalCol = j;
        else cols.push([j, Number(h)]);
      });

      // Each ward's candidates ordered by their ward total, so index 0 is the
      // ward's winner and the page can colour by finishing position.
      const ranked = candRows
        .map((r) => ({ name: givenNameFirst(String(r[0])), row: r, total: Number(r[totalCol]) || 0 }))
        .sort((a, b) => b.total - a.total);
      for (const c of ranked) {
        const computed = cols.reduce((s, [j]) => s + (Number(c.row[j]) || 0), 0);
        if (computed !== c.total) throw new Error(`Ward ${ward} ${c.name}: subdivisions sum to ${computed}, sheet total ${c.total}`);
        if (!candidateIndex.has(c.name)) {
          candidateIndex.set(c.name, candidates.length);
          candidates.push(c.name);
        }
      }

      const special = { ltc: [], mail: [], advance: [] };
      for (const key of Object.keys(special)) special[key] = ranked.map(() => 0);
      for (const [j, sub] of cols) {
        const votes = ranked.map((c) => Number(c.row[j]) || 0);
        const kind = SPECIAL[sub];
        if (sub === 96) hasLtcPoll.add(ward);
        if (kind) votes.forEach((v, i) => { special[kind][i] += v; });
        else pollVotes.set(`${ward}-${sub}`, votes);
      }
      for (const key of Object.keys(special)) if (special[key].every((v) => v === 0)) delete special[key];

      wards[ward] = {
        name,
        cand: ranked.map((c) => candidateIndex.get(c.name)),
        totals: ranked.map((c) => c.total),
        special,
      };
    }
  };

  readResults(election.results);
  const replaced = new Map((election.replaceWards ?? []).map((rep) => [rep.ward, rep]));
  for (const rep of replaced.values()) {
    readResults(rep.results, rep.ward);
    wards[rep.ward].note = rep.note;
  }

  // The race's own boundaries, with any replaced ward's polls swapped for the
  // ones its by-election used.
  const wardOf = (f) => Number(f.properties.AREA_LONG_CODE.slice(0, 2));
  const geo = JSON.parse(fs.readFileSync(path.join(DATA_DIR, election.boundaries), 'utf8'));
  geo.features = geo.features.filter((f) => !replaced.has(wardOf(f)));
  for (const rep of replaced.values()) {
    const repGeo = JSON.parse(fs.readFileSync(path.join(DATA_DIR, rep.boundaries), 'utf8'));
    geo.features.push(...repGeo.features.filter((f) => wardOf(f) === rep.ward));
  }

  const features = [];
  let ltcPolys = 0;
  for (const f of geo.features) {
    const code = f.properties.AREA_LONG_CODE;
    const ward = Number(code.slice(0, 2));
    const sub = Number(code.slice(2));
    const votes = pollVotes.get(`${ward}-${sub}`);
    pollVotes.delete(`${ward}-${sub}`);
    if (!votes) ltcPolys++;
    // Trailing zeros dropped: candidates are in ward-total order, so the long
    // tail of a 102-candidate mayoral race is mostly zeros in any one poll.
    let end = votes ? votes.length : 0;
    while (end > 0 && votes[end - 1] === 0) end--;
    const simplified = simplify(f, { tolerance: SIMPLIFY_TOLERANCE, highQuality: false });
    features.push({
      type: 'Feature',
      // A polygon with no result is a care home where the ward's care homes
      // report together (96); otherwise it simply has no result of its own.
      properties: votes
        ? { w: ward, s: sub, v: votes.slice(0, end) }
        : { w: ward, s: sub, ...(hasLtcPoll.has(ward) ? { ltc: 1 } : { none: 1 }) },
      geometry: { type: simplified.geometry.type, coordinates: round5(simplified.geometry.coordinates) },
    });
  }
  // Ward outlines, dissolved from the unsimplified polls so neighbouring
  // simplified edges can't leave slivers inside a ward.
  const byWard = new Map();
  for (const f of geo.features) {
    const ward = Number(f.properties.AREA_LONG_CODE.slice(0, 2));
    if (!byWard.has(ward)) byWard.set(ward, []);
    byWard.get(ward).push(f);
  }
  const wardOutlines = [...byWard].map(([ward, fs]) => {
    const merged = simplify(union(featureCollection(fs)), { tolerance: SIMPLIFY_TOLERANCE * 2, highQuality: false });
    // Outer rings only. The City's polls don't quite tile, so the union is
    // pocked with hairline holes that would otherwise draw as stray outlines.
    const { type, coordinates } = merged.geometry;
    const outer = type === 'Polygon' ? [coordinates[0]] : coordinates.map((poly) => [poly[0]]);
    return {
      type: 'Feature',
      properties: { w: ward },
      geometry: { type, coordinates: round5(outer) },
    };
  });

  if (election.allowUnmapped) {
    for (const [key, votes] of pollVotes) {
      const ward = wards[Number(key.split('-')[0])];
      ward.special.unmapped ??= votes.map(() => 0);
      votes.forEach((v, i) => { ward.special.unmapped[i] += v; });
    }
    if (pollVotes.size) console.log(`  ${pollVotes.size} polls with no boundary, pooled per ward`);
    pollVotes.clear();
  }
  if (pollVotes.size) throw new Error(`${election.id}: results with no boundary: ${[...pollVotes.keys()].join(', ')}`);

  const out = {
    id: election.id,
    title: election.title,
    date: election.date,
    generated: new Date().toISOString().slice(0, 10),
    candidates,
    wards,
    polls: { type: 'FeatureCollection', features },
    wardOutlines: { type: 'FeatureCollection', features: wardOutlines },
  };
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const outFile = path.join(OUT_DIR, `${election.id}.json`);
  fs.writeFileSync(outFile, JSON.stringify(out));
  // The election-night needle measures Chow's margin over her closest
  // challenger in each ward against the same margin in 2023, so it needs her
  // votes, that challenger's, and the ward's total.
  if (election.needleBaseline) {
    const { candidate } = election.needleBaseline;
    const ci = candidates.indexOf(candidate);
    if (ci < 0) throw new Error(`${election.id}: needle candidate not found`);
    const baseline = {};
    for (const [w, ward] of Object.entries(wards)) {
      const pos = ward.cand.indexOf(ci);
      // Ranked by ward total, so the closest challenger is the top non-Chow row.
      const rivalPos = pos === 0 ? 1 : 0;
      baseline[w] = {
        candidate: ward.totals[pos],
        rival: ward.totals[rivalPos],
        rivalName: candidates[ward.cand[rivalPos]],
        total: ward.totals.reduce((t, v) => t + v, 0),
      };
    }
    fs.writeFileSync(path.join(OUT_DIR, 'needle-baseline.json'), JSON.stringify({ candidate, wards: baseline }));
  }
  // The 2026 live results only come by ward, so that tab needs just these.
  if (election.wardsFile) {
    fs.writeFileSync(path.join(OUT_DIR, 'wards.json'), JSON.stringify({
      wards: Object.fromEntries(Object.entries(wards).map(([w, ward]) => [w, ward.name])),
      wardOutlines: out.wardOutlines,
    }));
  }
  console.log(
    `${election.id}: ${Object.keys(wards).length} wards, ${features.length - ltcPolys} polls mapped, `
    + `${ltcPolys} polygons without results, ${(fs.statSync(outFile).size / 1e6).toFixed(2)} MB`
  );
}

for (const election of ELECTIONS) build(election);
