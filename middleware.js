import { NextResponse } from 'next/server';

// Protect the admin page and admin API with HTTP Basic Auth. The browser prompts
// for credentials once; enter any username and the ADMIN_PASSWORD you set in the
// environment. Runs on the edge for every matched request.
export function middleware(request) {
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected) {
    return new NextResponse('Admin is not configured (set ADMIN_PASSWORD).', { status: 503 });
  }

  const auth = request.headers.get('authorization');
  if (auth?.startsWith('Basic ')) {
    try {
      const decoded = atob(auth.slice(6)); // "user:pass"
      const password = decoded.slice(decoded.indexOf(':') + 1);
      if (password === expected) {
        return NextResponse.next();
      }
    } catch {
      // fall through to 401
    }
  }

  return new NextResponse('Authentication required', {
    status: 401,
    headers: { 'WWW-Authenticate': 'Basic realm="Observing the City Admin", charset="UTF-8"' },
  });
}

export const config = {
  matcher: ['/admin', '/admin/:path*', '/api/admin', '/api/admin/:path*'],
};
