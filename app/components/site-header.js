'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ChevronDown } from 'lucide-react';

// Five tools no longer fit on one line, so the nav collapses into a menu. The
// trigger shows the page you're on, which keeps the "you are here" cue the
// underlined tab used to give.
const PAGES = [
  { key: 'bike-counters', href: '/bike-counters', label: 'Bicycle Counters' },
  { key: 'slow-zones', href: '/slow-zones', label: 'TTC Slow Zones' },
  { key: 'transform-toronto', href: '/transform-toronto', label: 'Transform Toronto' },
  { key: 'downtown-definer', href: '/downtown-definer', label: 'Where is Downtown?' },
  { key: 'video-counter', href: '/video-counter', label: 'Video Counter' },
];

export default function SiteHeader({ current }) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef(null);
  const currentPage = PAGES.find((page) => page.key === current);

  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event) => {
      if (!menuRef.current?.contains(event.target)) setOpen(false);
    };
    const onKeyDown = (event) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <header style={{ background: 'var(--panel)', borderBottom: '1px solid var(--line)' }}>
      <div className="container mx-auto px-4 max-w-6xl py-2 flex items-center justify-between gap-x-4 gap-y-1 flex-wrap">
        <Link href="/" className="flex items-center gap-2">
          <span className="inline-block h-4 w-4 rounded-sm" style={{ background: 'var(--accent)' }} />
          <span className="dd-title text-base" style={{ color: 'var(--ink)' }}>
            Observing the City
          </span>
        </Link>

        <div className="flex items-center gap-2 sm:gap-3">
          <div className="relative" ref={menuRef}>
            <button
              type="button"
              className="dd-btn dd-btn-ghost"
              aria-haspopup="menu"
              aria-expanded={open}
              onClick={() => setOpen((wasOpen) => !wasOpen)}
            >
              {currentPage ? currentPage.label : 'Explore the tools'}
              <ChevronDown
                size={15}
                style={{
                  transform: open ? 'rotate(180deg)' : 'none',
                  transition: 'transform 0.12s ease',
                }}
              />
            </button>

            {open && (
              <div
                role="menu"
                // Anchored to the trigger's left edge and opening rightward. On
                // mobile the header wraps this group onto its own row at the
                // left, so a right-anchored menu ran off the side of the screen.
                className="dd-panel absolute left-0 z-50 mt-1 py-1 max-w-[calc(100vw-2rem)]"
                style={{ minWidth: '15rem', boxShadow: '0 8px 24px rgba(0,0,0,0.12)' }}
              >
                {PAGES.map((page) => {
                  const active = page.key === current;
                  return (
                    <Link
                      key={page.key}
                      role="menuitem"
                      href={page.href}
                      onClick={() => setOpen(false)}
                      className="block px-3 py-2 text-sm font-semibold hover:bg-[var(--paper)]"
                      style={{ color: active ? 'var(--accent)' : 'var(--ink)' }}
                    >
                      {page.label}
                    </Link>
                  );
                })}
              </div>
            )}
          </div>

          <a
            href="https://buymeacoffee.com/observingthecity"
            target="_blank"
            rel="noopener noreferrer"
            className="dd-btn dd-btn-accent justify-center"
          >
            <span className="hidden sm:inline">Help Keep the Lights On</span>
            <span className="sm:hidden">Help Out</span>
          </a>
        </div>
      </div>
    </header>
  );
}
