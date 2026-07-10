import Link from 'next/link';

export default function SiteHeader({ current }) {
  const navItem = (href, label, key) => {
    const active = current === key;
    return (
      <Link
        href={href}
        className="relative py-1 text-sm font-semibold"
        style={{ color: active ? 'var(--ink)' : 'var(--ink-2)' }}
      >
        {label}
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
      <div className="container mx-auto px-4 max-w-6xl py-3 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2">
          <span className="inline-block h-4 w-4 rounded-sm" style={{ background: 'var(--accent)' }} />
          <span className="dd-title text-base" style={{ color: 'var(--ink)' }}>
            Observing the City
          </span>
        </Link>
        <nav className="flex gap-5 items-center">
          {navItem('/bike-counters', 'Bicycle Counters', 'bike-counters')}
          {navItem('/downtown-definer', 'DowntownDefiner', 'downtown-definer')}
        </nav>
      </div>
    </header>
  );
}
