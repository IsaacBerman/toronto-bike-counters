import Link from 'next/link';

export default function SiteHeader({ current }) {
  return (
    <div className="bg-white border-b border-gray-100">
      <div className="container mx-auto px-4 max-w-7xl py-3 flex items-center justify-between">
        <Link href="/" className="font-bold text-gray-900 tracking-tight hover:text-blue-600">
          Observing the City
        </Link>
        <nav className="flex gap-4 text-sm font-medium">
          <Link
            href="/bike-counters"
            className={current === 'bike-counters' ? 'text-blue-600' : 'text-gray-600 hover:text-blue-600'}
          >
            Bicycle Counters
          </Link>
          <Link
            href="/downtown-definer"
            className={current === 'downtown-definer' ? 'text-blue-600' : 'text-gray-600 hover:text-blue-600'}
          >
            DowntownDefiner
          </Link>
        </nav>
      </div>
    </div>
  );
}
