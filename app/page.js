import Link from 'next/link';
import { ArrowRight, ChartColumn, Map, PenTool, Users, Video } from 'lucide-react';

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
    // Icon only; the label is kept for screen readers and as a hover tooltip.
    <span
      className="inline-flex items-center justify-center rounded-sm"
      style={{
        width: 26,
        height: 26,
        color: 'var(--accent)',
        background: 'color-mix(in srgb, var(--accent) 12%, var(--panel))',
      }}
      title={label}
    >
      <Icon size={15} strokeWidth={2.5} aria-hidden="true" />
      <span className="sr-only">{label}</span>
    </span>
  );
}

// The whole card is the link. On hover it lifts, its top rule and title take
// the accent, and an arrow slides in, so it reads as something to click.
function ProjectCard({ href, title, kind }) {
  return (
    <Link href={href} className="dd-card block dd-panel-ruled p-6">
      <div className="flex items-center justify-between mb-3">
        <KindTag kind={kind} />
        <ArrowRight
          size={20}
          strokeWidth={2.5}
          aria-hidden="true"
          className="dd-card-arrow"
        />
      </div>
      <h2 className="dd-card-title dd-title text-2xl">{title}</h2>
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
