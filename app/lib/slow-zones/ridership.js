// Estimated riders affected by a slow zone, from the link-level volumes
// derived out of the TTC's published station usage table (see
// scripts/build-link-volumes.mjs for the model and source).
import linkVolumes from './link-volumes.json';
import { spanBetween } from './stations';

// Value of travel time, $/hour — Metrolinx's standard economic parameter
// ($18.79/hr in 2021 dollars, Business Case Manual Volume 2, Table 5.8),
// adjusted to 2026 dollars with Canada CPI (~+18% 2021->2026).
export const VALUE_OF_TIME = 22.2;

// Mean directed link volume (riders/weekday) across the segments a zone
// spans, in the zone's direction of travel. Null when the zone can't be
// resolved onto the network.
export function zoneDailyRiders(zone) {
  const span = spanBetween(zone.line, zone.from_station, zone.to_station);
  const lineVolumes = linkVolumes.volumes[zone.line];
  if (span.length === 0 || !lineVolumes) return null;
  let sum = 0;
  for (const [a, b] of span) {
    sum += lineVolumes[b > a ? 'up' : 'down'][Math.min(a, b)] || 0;
  }
  return Math.round(sum / span.length);
}
