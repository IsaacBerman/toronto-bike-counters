import Link from 'next/link';

export const metadata = {
  title: 'Observing the City',
  description: 'Toronto transportation data dashboards and mapping tools',
};

function ProjectCard({ href, title }) {
  return (
    <Link
      href={href}
      className="group block dd-panel-ruled p-6 transition-transform hover:-translate-y-0.5"
    >
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
            title="Toronto Election Results"
          />
          <ProjectCard
            href="/bike-counters"
            title="Toronto Bicycle Counters"
          />
          <ProjectCard
            href="/intersection-counts"
            title="Toronto Intersection Counts"
          />
          <ProjectCard
            href="/transform-toronto"
            title="TransformTO Tracking"
          />
          <ProjectCard
            href="/slow-zones"
            title="TTC Slow Zones"
          />
          <ProjectCard
            href="/vision-zero"
            title="Toronto Vision Zero Dashboard"
          />
          <ProjectCard
            href="/council-boards"
            title="Toronto Council Appointments"
          />
          <ProjectCard
            href="/downtown-definer"
            title="Where is Downtown?"
          />
          <ProjectCard
            href="/where-would-you-live"
            title="Where Would You Live?"
          />
          <ProjectCard
            href="/video-counter"
            title="Video Traffic Counter"
          />
        </div>
      </div>
    </div>
  );
}
