import './globals.css';
import { Archivo } from 'next/font/google';
import SiteFooter from './components/site-footer';

const archivo = Archivo({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800'],
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
        <link rel="icon" href="/bike.png" type="image/png" sizes="any" />
        <link rel="icon" href="/bike.png" type="image/svg+xml" />
        <link rel="apple-touch-icon" href="/bike.png" />
        <link rel="shortcut icon" href="/bike.png" type="image/x-icon" />
      </head>
      <body className="antialiased">
        {children}
        <SiteFooter />
      </body>
    </html>
  )
}
