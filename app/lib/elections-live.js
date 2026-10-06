// Timing for the 2026 election-night results, shared by the API route that
// fetches the City's feed and the page that polls it.

// Polls close at 8 p.m. Eastern on October 26, 2026 (still daylight time;
// clocks change November 1). The City's feed starts updating then.
export const POLLS_CLOSE = Date.parse('2026-10-26T20:00:00-04:00');

// The City republishes about every 60 seconds once counting starts and asks
// that nobody poll faster than that.
export const LIVE_INTERVAL_MS = 60 * 1000;
export const IDLE_INTERVAL_MS = 24 * 60 * 60 * 1000;

// How long until the next check: once a minute from poll close, otherwise
// once a day — but never sleeping past poll close itself.
export function nextCheckDelay(now = Date.now()) {
  if (now >= POLLS_CLOSE) return LIVE_INTERVAL_MS;
  return Math.max(1000, Math.min(IDLE_INTERVAL_MS, POLLS_CLOSE - now));
}

export const isElectionNight = (now = Date.now()) => now >= POLLS_CLOSE;
