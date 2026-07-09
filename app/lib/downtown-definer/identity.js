import { randomUUID, createHash } from 'node:crypto';

export const DEV_IDENTITY_COOKIE = 'dd_dev_identity';

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
