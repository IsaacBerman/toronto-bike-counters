import { randomUUID, createHash } from 'node:crypto';

export const DEV_IDENTITY_COOKIE = 'dd_dev_identity';

// Tracks which cities this browser has submitted for, so the status endpoint
// (and the client before it even calls it) can answer "not submitted" for the
// common first-visit case without touching the database. The DB stays the
// source of truth: the submissions route still enforces one-per-submitter and
// re-sets this cookie on a 409, which covers cookie loss or a different
// device behind the same IP.
export const SUBMITTED_CITIES_COOKIE = 'dd_submitted';
const SUBMITTED_CITIES_MAX = 30;

export function readSubmittedCities(request) {
  const cookieHeader = request.headers.get('cookie') || '';
  const match = cookieHeader.match(new RegExp(`${SUBMITTED_CITIES_COOKIE}=([^;]+)`));
  if (!match) return [];
  try {
    return decodeURIComponent(match[1]).split('|').filter(Boolean);
  } catch {
    return [];
  }
}

// Cookie value with `slug` appended, capped so the cookie can't grow without
// bound. An evicted slug just means one extra status round-trip (and a 409
// that restores it) if that city is ever revisited.
export function withSubmittedCity(request, slug) {
  const slugs = readSubmittedCities(request).filter((s) => s !== slug);
  slugs.push(slug);
  return slugs.slice(-SUBMITTED_CITIES_MAX).join('|');
}

// Determines the "submitter" for the one-submission-per-city rule.
// In production, this is a salted hash of the real client IP. In local dev
// (`next dev`), it's a random id stored in a cookie instead, so a developer
// can simulate multiple different submitters from the same machine/IP by
// clearing that cookie between submissions.
export function getSubmitterIdentity(request) {
  if (process.env.NODE_ENV === 'production') {
    const forwardedFor = request.headers.get('x-forwarded-for');
    const ip = forwardedFor ? forwardedFor.split(',')[0].trim() : request.headers.get('x-real-ip') || 'unknown';
    const salt = process.env.IP_HASH_SALT || '';
    const hash = createHash('sha256').update(ip + salt).digest('hex');
    return { hash, newCookieValue: null };
  }

  const cookieHeader = request.headers.get('cookie') || '';
  const match = cookieHeader.match(new RegExp(`${DEV_IDENTITY_COOKIE}=([^;]+)`));
  if (match) {
    return { hash: `dev:${match[1]}`, newCookieValue: null };
  }

  const id = randomUUID();
  return { hash: `dev:${id}`, newCookieValue: id };
}
