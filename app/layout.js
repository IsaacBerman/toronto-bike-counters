import './globals.css';

export const metadata = {
  title: 'Toronto Bicycle Counters',
  description: 'Explore bicycle traffic data from permanent counting stations across Toronto',
}

export default function RootLayout({ children }) {
  return (
    <html lang="en">
       <head>
        <link rel="icon" href="/bike.png" type="image/png" sizes="any" />
        <link rel="icon" href="/bike.png" type="image/svg+xml" />
        <link rel="apple-touch-icon" href="/bike.png" />
        <link rel="shortcut icon" href="/bike.png" type="image/x-icon" />
      </head>
      <body className="font-sans antialiased">
        {children}
      </body>
    </html>
  )
}