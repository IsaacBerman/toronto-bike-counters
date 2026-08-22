import { randomUUID, createHash } from 'node:crypto';

// One anonymous identity per browser: a random id minted server-side on first
// contact and stored in a long-lived cookie. This replaces the old IP-hash
// identity — shared or rotating IPs (Apple Private Relay, CGNAT, VPNs) both
// collided different people onto one "submitter" and split one person across
// several, so a submitter behind Private Relay could be shown someone else's
// map as their own. The IP no longer identifies anyone; it only feeds a
// coarse per-IP rate limit in the submissions route.
export const IDENTITY_COOKIE = 'dd_identity';

// Tracks which cities this browser has submitted for, so the status endpoint
// (and the client before it even calls it) can answer "not submitted" for the
// common first-visit case without touching the database. The DB stays the
// source of truth: the submissions route still enforces one-per-submitter and
// re-sets this cookie on a 409, which covers cookie loss.
export const SUBMITTED_CITIES_COOKIE = 'dd_submitted';
// Same idea for "Where would you live?": its own list, so submitting there
// never makes the downtown page think you've drawn a downtown (and vice versa).
// The identity cookie above is deliberately shared — it's one anonymous
// browser id, not a per-tool one.
export const LIVE_SUBMITTED_CITIES_COOKIE = 'wl_submitted';
const SUBMITTED_CITIES_MAX = 30;

export function readSubmittedCitiesFor(request, cookieName) {
  const cookieHeader = request.headers.get('cookie') || '';
  const match = cookieHeader.match(new RegExp(`(?:^|; )${cookieName}=([^;]+)`));
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
export function withSubmittedCityFor(request, cookieName, slug) {
  const slugs = readSubmittedCitiesFor(request, cookieName).filter((s) => s !== slug);
  slugs.push(slug);
  return slugs.slice(-SUBMITTED_CITIES_MAX).join('|');
}

export function readSubmittedCities(request) {
  return readSubmittedCitiesFor(request, SUBMITTED_CITIES_COOKIE);
}

export function withSubmittedCity(request, slug) {
  return withSubmittedCityFor(request, SUBMITTED_CITIES_COOKIE, slug);
}

function hashValue(value) {
  const salt = process.env.IP_HASH_SALT || '';
  return createHash('sha256').update(value + salt).digest('hex');
}

// Determines the "submitter" for the one-submission-per-city rule: the salted
// hash of the browser's identity cookie. When the cookie is missing a fresh id
// is minted and returned as `newCookieValue` for the route to set. Clearing
// cookies therefore creates a new submitter — an accepted trade-off; the
// per-IP rate limit is the abuse brake.
export function getSubmitterIdentity(request) {
  const cookieHeader = request.headers.get('cookie') || '';
  const match = cookieHeader.match(new RegExp(`${IDENTITY_COOKIE}=([^;]+)`));
  if (match) {
    return { hash: hashValue(match[1]), newCookieValue: null };
  }
  const id = randomUUID();
  return { hash: hashValue(id), newCookieValue: id };
}

// Salted hash of the client IP. Not an identity — only the key for the very
// generous per-IP submission rate limit.
export function getClientIpHash(request) {
  const forwardedFor = request.headers.get('x-forwarded-for');
  const ip = forwardedFor
    ? forwardedFor.split(',')[0].trim()
    : request.headers.get('x-real-ip') || 'unknown';
  return hashValue(ip);
}
