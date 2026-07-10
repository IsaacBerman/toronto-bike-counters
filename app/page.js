import Link from 'next/link';

export const metadata = {
  title: 'Observing the City',
  description: 'Data and community tools exploring how cities move and how people see them',
};

function ProjectCard({ href, index, title, blurb, tag }) {
  return (
    <Link
      href={href}
      className="group block dd-panel-ruled p-6 transition-transform hover:-translate-y-0.5"
    >
      <div className="flex items-baseline justify-between mb-6">
        <span className="text-sm font-mono font-bold" style={{ color: 'var(--ink-3)' }}>
          {index}
        </span>
        <span className="dd-kicker">{tag}</span>
      </div>
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
            💡 Help Keep the Lights On
          </a>
        </div>
        <div className="mb-14">
          <p className="dd-kicker mb-3">Observing the City</p>
          <h1 className="dd-title text-5xl sm:text-6xl mb-5" style={{ color: 'var(--ink)' }}>
            How cities move,
            <br />
            and how we see them.
          </h1>
          <p className="text-lg max-w-xl leading-relaxed" style={{ color: 'var(--ink-2)' }}>
            A small set of data and community tools about urban life. Pick one below.
          </p>
        </div>

        <div className="grid sm:grid-cols-2 gap-5">
          <ProjectCard
            href="/bike-counters"
            index="01"
            tag="Live data"
            title="Toronto Bicycle Counters"
            blurb="Bicycle traffic from permanent counting stations across Toronto, updated from the city's live feed."
          />
          <ProjectCard
            href="/downtown-definer"
            index="02"
            tag="Community map"
            title="Where is Downtown?"
            blurb="Draw the boundary of what you call &ldquo;downtown&rdquo; and watch it merge into a crowd heatmap."
          />
        </div>
      </div>
    </div>
  );
}
