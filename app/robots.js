export default function robots() {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        // The admin page is password-protected and the API routes serve JSON to
        // the pages themselves; neither belongs in an index.
        disallow: ['/admin', '/api/'],
      },
    ],
    sitemap: 'https://www.observingthecity.ca/sitemap.xml',
    host: 'https://www.observingthecity.ca',
  };
}
