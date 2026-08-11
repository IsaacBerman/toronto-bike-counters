import Link from 'next/link';

export default function SiteHeader({ current }) {
  // Short labels keep the nav on one line on mobile.
  const navItem = (href, label, shortLabel, key) => {
    const active = current === key;
    return (
      <Link
        href={href}
        className="relative py-1 text-sm font-semibold"
        style={{ color: active ? 'var(--ink)' : 'var(--ink-2)' }}
      >
        <span className="hidden sm:inline">{label}</span>
        <span className="sm:hidden">{shortLabel}</span>
        {active && (
          <span
            className="absolute -bottom-[3px] left-0 right-0 h-[3px]"
            style={{ background: 'var(--accent)' }}
          />
        )}
      </Link>
    );
  };

  return (
    <header style={{ background: 'var(--panel)', borderBottom: '1px solid var(--line)' }}>
      <div className="container mx-auto px-4 max-w-6xl py-2 flex items-center justify-between gap-x-5 gap-y-1 flex-wrap">
        <Link href="/" className="flex items-center gap-2">
          <span className="inline-block h-4 w-4 rounded-sm" style={{ background: 'var(--accent)' }} />
          <span className="dd-title text-base" style={{ color: 'var(--ink)' }}>
            Observing the City
          </span>
        </Link>
        <nav className="flex flex-row flex-wrap items-center gap-x-4 sm:gap-x-5 gap-y-1">
          {navItem('/bike-counters', 'Bicycle Counters', 'Bikes', 'bike-counters')}
          {navItem('/slow-zones', 'TTC Slow Zones', 'Slow Zones', 'slow-zones')}
          {navItem('/transform-toronto', 'Transform Toronto', 'TransformTO', 'transform-toronto')}
          {navItem('/downtown-definer', 'Where is Downtown?', 'Downtown', 'downtown-definer')}
          <a
            href="https://buymeacoffee.com/observingthecity"
            target="_blank"
            rel="noopener noreferrer"
            className="dd-btn dd-btn-accent justify-center"
          >
            Help Keep the Lights On
          </a>
        </nav>
      </div>
    </header>
  );
}
