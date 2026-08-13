import Link from 'next/link';

export const metadata = {
  title: 'Observing the City',
  description: 'Toronto transportation data dashboards and mapping tools',
};

function ProjectCard({ href, title, blurb }) {
  return (
    <Link
      href={href}
      className="group block dd-panel-ruled p-6 transition-transform hover:-translate-y-0.5"
    >
      <h2 className="dd-title text-2xl mb-2" style={{ color: 'var(--ink)' }}>
        {title}
      </h2>
      <p className="text-sm leading-relaxed mb-4" style={{ color: 'var(--ink-2)' }}>
        {blurb}
      </p>
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
            href="/bike-counters"
            title="Toronto Bicycle Counters"
            blurb="Dashboard showing Toronto permanent bicycle counter data and Bike Share ridership."
          />
          <ProjectCard
            href="/transform-toronto"
            title="TransformTO Tracking"
            blurb="Toronto travel mode share by ward, trip distance and year, from the Transportation Tomorrow Survey."
          />
          <ProjectCard
            href="/slow-zones"
            title="TTC Slow Zones"
            blurb="Daily tracking of TTC subway reduced speed zones."
          />
          <ProjectCard
            href="/downtown-definer"
            title="Where is Downtown?"
            blurb="Map tool for drawing your definition of downtown, aggregated into a heatmap of all submissions."
          />
        </div>
      </div>
    </div>
  );
}
