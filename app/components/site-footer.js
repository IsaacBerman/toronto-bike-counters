export default function SiteFooter() {
  return (
    <footer style={{ background: 'var(--panel)', borderTop: '1px solid var(--line)' }}>
      <div className="container mx-auto px-4 max-w-6xl py-6 flex items-center justify-between gap-3 flex-wrap">
        <span className="text-sm" style={{ color: 'var(--ink-3)' }}>
          © {new Date().getFullYear()} Observing the City
        </span>
        <a href="mailto:observingthecity@gmail.com" className="dd-link-accent text-sm">
          Contact Me
        </a>
      </div>
    </footer>
  );
}
