import './globals.css';

export const metadata = {
  title: 'Observing the City',
  description: 'Data and community tools exploring how cities move and how people see them',
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