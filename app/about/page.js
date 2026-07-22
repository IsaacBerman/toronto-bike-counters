import SiteHeader from '../components/site-header';

export const metadata = {
  title: 'About — Observing the City',
  description:
    'Observing the City is an independent project building open-data tools about how Toronto moves and how people see their city. The goal is to bring transparency to data that is usually obfuscated.',
};

export default function AboutPage() {
  return (
    <>
      <SiteHeader />
      <div className="min-h-screen" style={{ background: 'var(--paper)' }}>
        <div className="container mx-auto px-4 max-w-3xl py-12 sm:py-16">
          <p className="dd-kicker mb-3">About</p>
          <h1 className="dd-title text-4xl sm:text-5xl mb-6" style={{ color: 'var(--ink)' }}>
            Observing the City
          </h1>

          <div className="dd-panel-ruled p-6 sm:p-8 space-y-5" style={{ color: 'var(--ink-2)' }}>
            <p className="text-base leading-relaxed">
              <b style={{ color: 'var(--ink)' }}>Observing the City</b> is an independent project that builds free, interactive tools from open urban data — mostly
              about Toronto. The goal is simple: take public datasets that usually sit in
              spreadsheets and portals, and turn them into something anyone can explore in a browser
              to understand how a city actually moves, and how the people who live in it see it.
            </p>

            <div>
              <h2 className="dd-title text-xl mb-2" style={{ color: 'var(--ink)' }}>
                The projects
              </h2>
              <ul className="space-y-3 text-sm leading-relaxed">
                <li>
                  <b style={{ color: 'var(--ink)' }}>Toronto Bicycle Counters</b> — daily and hourly
                  cycling volumes from the City&rsquo;s permanent counting stations and Bike Share
                  Toronto, cleaned and charted over time.
                </li>
                <li>
                  <b style={{ color: 'var(--ink)' }}>Where is Downtown?</b> — a community tool where
                  people draw the boundary of what they consider &ldquo;downtown,&rdquo; which merges
                  into a crowd-sourced heatmap of the fuzzy edges of the city core.
                </li>
                <li>
                  <b style={{ color: 'var(--ink)' }}>TransformTO Tracking</b> — transportation mode
                  share by ward, trip distance and survey year, tracking Toronto&rsquo;s progress
                  toward the TransformTO climate goal of 75% of short work and school trips by
                  walking, cycling or transit by 2030.
                </li>
              </ul>
            </div>

            <div>
              <h2 className="dd-title text-xl mb-2" style={{ color: 'var(--ink)' }}>
                Where the data comes from
              </h2>
              <ul className="space-y-2 text-sm leading-relaxed">
                <li>
                  <b style={{ color: 'var(--ink)' }}>City of Toronto Open Data</b> — cycling counter
                  volumes and ward boundaries.
                </li>
                <li>
                  <b style={{ color: 'var(--ink)' }}>Transportation Tomorrow Survey</b> — the
                  regional travel survey run by the Data Management Group at the University of
                  Toronto, used for mode-share figures.
                </li>
                <li>
                  <b style={{ color: 'var(--ink)' }}>Bike Share Toronto</b> — trip activity via a
                  public data feed.
                </li>
              </ul>
              <p className="text-sm leading-relaxed mt-3">
                Each tool notes its own sources and any processing (for example, older survey wards
                are mapped onto Toronto&rsquo;s current 25-ward model). These are independent
                visualizations and are not affiliated with or endorsed by the City of Toronto, the
                University of Toronto, or any data provider.
              </p>
            </div>

            <div>
              <h2 className="dd-title text-xl mb-2" style={{ color: 'var(--ink)' }}>
                Who makes it
              </h2>
              <p className="text-sm leading-relaxed">
                Observing the City is built and maintained by one independent developer, and is kept
                free and running through advertising and reader support. Questions, corrections and
                ideas are always welcome — see the{' '}
                <a href="/contact" className="dd-link-accent">
                  contact page
                </a>
                .
              </p>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
