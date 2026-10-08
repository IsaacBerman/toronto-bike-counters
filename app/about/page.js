import SiteHeader from '../components/site-header';

export const metadata = {
  title: 'About | Observing the City',
  description:
    'Observing the City is a one-person project that turns Toronto open data into maps and dashboards anyone can use.',
};

export default function AboutPage() {
  return (
    <>
      <SiteHeader />
      <div className="min-h-screen" style={{ background: 'var(--paper)' }}>
        <div className="container mx-auto px-4 max-w-3xl pt-4 pb-12 sm:pb-16">
          <p className="dd-kicker mb-3">About</p>
          <h1 className="dd-title text-4xl sm:text-5xl mb-6" style={{ color: 'var(--ink)' }}>
            Observing the City
          </h1>

          <div className="dd-panel-ruled p-6 sm:p-8 space-y-5" style={{ color: 'var(--ink-2)' }}>
            <p className="text-base leading-relaxed">
             Observing the City was born out of my desire to make opaque data more accessible to the public. There is so much open data hidden in government portals and APIs. It only sees the light of day when a report is requested by the government, and then it gets buried as a PDF in a committee agenda. I set out to change that.
            </p>

            <p className="text-sm leading-relaxed">
              The cycling numbers come from the City of Toronto&rsquo;s{' '}
              <a
                href="https://open.toronto.ca/dataset/permanent-bicycle-counters/"
                target="_blank"
                rel="noopener noreferrer"
                className="dd-link-accent"
              >
                permanent bicycle counters
              </a>
              , which also supplies the ward boundaries used on the maps. The mode-share figures are
              from the{' '}
              <a
                href="http://www.transportationtomorrow.on.ca/"
                target="_blank"
                rel="noopener noreferrer"
                className="dd-link-accent"
              >
                Transportation Tomorrow Survey
              </a>
              , a regional travel survey run by the Data Management Group at the University of
              Toronto. Bike Share trip activity comes from the system&rsquo;s public{' '}
              <a
                href="https://gbfs.org/"
                target="_blank"
                rel="noopener noreferrer"
                className="dd-link-accent"
              >
                GBFS feed
              </a>
              . Each tool notes its own sources and whatever processing was involved. Older survey
              wards get mapped onto the current 25-ward model, for instance. None of this is
              affiliated with or endorsed by the City of Toronto, the University of Toronto, or
              anyone else who publishes the data.
            </p>

            <p className="text-sm leading-relaxed">
              I run the site myself and pay for the hosting, with some help from readers. If you
              spot a mistake or know a dataset that should be on here, email me. The{' '}
              <a href="/contact" className="dd-link-accent">
                contact page
              </a>{' '}
              has my email.
            </p>
          </div>
        </div>
      </div>
    </>
  );
}
