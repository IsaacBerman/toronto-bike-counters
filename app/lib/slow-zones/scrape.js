// Scraper for the TTC reduced-speed-zones page. The zone tables are
// server-rendered, so a plain fetch + regex table parse is enough — no
// headless browser. Each table is preceded by a heading naming the line and
// terminus ("Line 1 (Yonge-University) to Finch Station").

const SOURCE_URL = 'https://www.ttc.ca/riding-the-ttc/Updates/Reduced-Speed-Zones';

function stripTags(htmlFragment) {
  return htmlFragment
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#39;|&rsquo;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function parseNumber(text) {
  const n = Number(String(text).replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

// "Northbound St Clair West to Cedarvale (x2)" ->
// { direction, fromStation, toStation, zoneCount }
export function parseLocation(location) {
  const m = location.match(
    /^(Northbound|Southbound|Eastbound|Westbound)\s+(.+?)\s+to\s+(.+?)(?:\s*\(x(\d+)\))?$/i
  );
  if (!m) return { direction: null, fromStation: null, toStation: null, zoneCount: 1 };
  return {
    direction: m[1],
    fromStation: m[2].trim(),
    toStation: m[3].trim(),
    zoneCount: m[4] ? Number(m[4]) : 1,
  };
}

export function parseSlowZonesHtml(html) {
  const asOf = html.match(/(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.? \d{1,2},? \d{1,2}:\d{2}\s*[AP]M/)?.[0] || null;

  // Walk headings and tables in document order so each table inherits the
  // closest preceding "Line N ..." heading.
  const zones = [];
  const parts = html.match(/<h[1-6][^>]*>[\s\S]*?<\/h[1-6]>|<table[\s\S]*?<\/table>/gi) || [];
  let currentLine = null;
  for (const part of parts) {
    if (/^<h/i.test(part)) {
      const text = stripTags(part);
      const lineMatch = text.match(/^Line (\d)/i);
      if (lineMatch) currentLine = Number(lineMatch[1]);
      continue;
    }
    if (!currentLine) continue;
    const rows = part.match(/<tr[\s\S]*?<\/tr>/gi) || [];
    for (const row of rows) {
      const cells = (row.match(/<t[dh][\s\S]*?<\/t[dh]>/gi) || []).map(stripTags);
      if (cells.length < 8 || cells[0] === 'Location') continue;
      const location = cells[0];
      const { direction, fromStation, toStation, zoneCount } = parseLocation(location);
      zones.push({
        line: currentLine,
        location,
        direction,
        fromStation,
        toStation,
        zoneCount,
        defectM: parseNumber(cells[1]),
        distanceM: parseNumber(cells[2]),
        trackPct: parseNumber(cells[3]),
        reducedKmh: parseNumber(cells[4]),
        normalKmh: parseNumber(cells[5]),
        reason: cells[6] || null,
        target: cells[7] || null,
      });
    }
  }
  return { asOf, zones };
}

export async function fetchSlowZones() {
  const res = await fetch(SOURCE_URL, {
    headers: { 'User-Agent': 'observingthecity.ca slow-zone tracker (isaac.berman96@gmail.com)' },
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`TTC page returned ${res.status}`);
  const html = await res.text();
  const parsed = parseSlowZonesHtml(html);
  // An empty result on a 200 is more likely a page redesign than zero slow
  // zones — fail loudly so the ingest run shows an error instead of quietly
  // recording a perfect track day.
  if (parsed.zones.length === 0 && !/no reduced speed zones/i.test(html)) {
    throw new Error('Parsed zero zones — TTC page layout may have changed');
  }
  return parsed;
}
