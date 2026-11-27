import Link from 'next/link';
import { ChartColumn, Map, PenTool, Users, Video } from 'lucide-react';

export const metadata = {
  title: 'Observing the City',
  description: 'Toronto transportation data dashboards and mapping tools',
};

// What kind of page each card opens, shown as a tag above its title.
const KINDS = {
  dashboard: { label: 'Dashboard', Icon: ChartColumn },
  map: { label: 'Interactive map', Icon: Map },
  draw: { label: 'Drawing tool', Icon: PenTool },
  directory: { label: 'Directory', Icon: Users },
  video: { label: 'Video tool', Icon: Video },
};

function KindTag({ kind }) {
  const { label, Icon } = KINDS[kind];
  return (
    <span className="dd-kicker inline-flex items-center gap-1.5 mb-3">
      <span
        className="inline-flex items-center justify-center rounded-sm"
        style={{ width: 22, height: 22, background: 'color-mix(in srgb, var(--accent) 12%, var(--panel))' }}
      >
        <Icon size={13} strokeWidth={2.5} aria-hidden="true" />
      </span>
      {label}
    </span>
  );
}

function ProjectCard({ href, title, kind }) {
  return (
    <Link
      href={href}
      className="group block dd-panel-ruled p-6 transition-transform hover:-translate-y-0.5"
    >
      <KindTag kind={kind} />
      <h2 className="dd-title text-2xl mb-4" style={{ color: 'var(--ink)' }}>
        {title}
      </h2>
      <span
        className="inline-flex items-center gap-1 text-sm font-bold group-hover:gap-2 transition-all"
        style={{ color: 'var(--accent)' }}
      >
        Open →
      </span>
    </Link>
  );
}

export default function Home() {
  return (
    <div className="min-h-screen" style={{ background: 'var(--paper)' }}>
      <div className="container mx-auto px-4 max-w-4xl py-20">
        <div className="flex justify-end mb-8">
          <a
            href="https://buymeacoffee.com/observingthecity"
            target="_blank"
            rel="noopener noreferrer"
            className="dd-btn dd-btn-accent"
          >
            Help Keep the Lights On
          </a>
        </div>
        <div className="mb-14">
          <h1 className="dd-title text-5xl sm:text-6xl mb-5" style={{ color: 'var(--ink)' }}>
            Observing the City
          </h1>
        </div>

        <div className="grid sm:grid-cols-2 gap-5">
          <ProjectCard
            href="/elections"
            kind="map"
            title="Toronto Election Results"
          />
          <ProjectCard
            href="/bike-counters"
            kind="dashboard"
            title="Toronto Bicycle Counters"
          />
          <ProjectCard
            href="/intersection-counts"
            kind="map"
            title="Toronto Intersection Counts"
          />
          <ProjectCard
            href="/transform-toronto"
            kind="dashboard"
            title="TransformTO Tracking"
          />
          <ProjectCard
            href="/slow-zones"
            kind="dashboard"
            title="TTC Slow Zones"
          />
          <ProjectCard
            href="/vision-zero"
            kind="dashboard"
            title="Toronto Vision Zero Dashboard"
          />
          <ProjectCard
            href="/council-boards"
            kind="directory"
            title="Toronto Council Appointments"
          />
          <ProjectCard
            href="/downtown-definer"
            kind="draw"
            title="Where is Downtown?"
          />
          <ProjectCard
            href="/where-would-you-live"
            kind="draw"
            title="Where Would You Live?"
          />
          <ProjectCard
            href="/video-counter"
            kind="video"
            title="Video Traffic Counter"
          />
        </div>
      </div>
    </div>
  );
}
