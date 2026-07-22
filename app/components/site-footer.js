import Link from 'next/link';

export default function SiteFooter() {
  return (
    <footer style={{ background: 'var(--panel)', borderTop: '1px solid var(--line)' }}>
      <div className="container mx-auto px-4 max-w-6xl py-6 flex items-center justify-between gap-3 flex-wrap">
        <span className="text-sm" style={{ color: 'var(--ink-3)' }}>
          © {new Date().getFullYear()} Observing the City
        </span>
        <nav className="flex items-center gap-4 sm:gap-5 flex-wrap">
          <Link href="/about" className="dd-link-accent text-sm">
            About
          </Link>
          <Link href="/privacy" className="dd-link-accent text-sm">
            Privacy
          </Link>
          <Link href="/contact" className="dd-link-accent text-sm">
            Contact
          </Link>
        </nav>
      </div>
    </footer>
  );
}
