import './globals.css';
import localFont from 'next/font/local';
import { Analytics } from '@vercel/analytics/next';
import SiteFooter from './components/site-footer';

// Self-hosted Archivo (variable, latin subset) — next/font/google downloads
// from Google at build time, which intermittently breaks Turbopack builds on
// Vercel ("Can't resolve '@vercel/turbopack-next/internal/font/google/font'").
const archivo = localFont({
  src: './fonts/archivo-latin.woff2',
  weight: '100 900',
  variable: '--font-archivo',
  display: 'swap',
});

export const metadata = {
  metadataBase: new URL('https://www.observingthecity.ca'),
  title: 'Observing the City',
  description: 'Data and community tools exploring how cities move and how people see them',
}

export default function RootLayout({ children }) {
  return (
    <html lang="en" className={archivo.variable}>
       <head>
        <script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-6437776129058819"
     crossorigin="anonymous"></script>
        <link rel="icon" href="/bike.png" type="image/png" sizes="any" />
        <link rel="icon" href="/bike.png" type="image/svg+xml" />
        <link rel="apple-touch-icon" href="/bike.png" />
        <link rel="shortcut icon" href="/bike.png" type="image/x-icon" />
      </head>
      <body className="antialiased">
        {children}
        <SiteFooter />
        {/* Billed per pageview on Pro ($0.03/1k) but only while Analytics is
            enabled in the Vercel dashboard — that toggle is the on/off switch. */}
        <Analytics />
      </body>
    </html>
  )
}
